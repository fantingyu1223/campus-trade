/**
 * order.validator.ts —— 订单入参字段校验（9001 聚合式拦截）
 *
 * @module PIM-BC-04 交易订单
 * @rule CIM-R-10 付款前风险明示守卫落点：validateCreateOrder（online_pay 且未确认 → 9001）
 * @rule CIM-R-14 交易方式仅意向声明：trade_mode 由请求体最终确认（offline_meet/online_pay 均可）
 * @api §5.2 #30 POST /orders
 * @ac F13-AC2 付款前强制确认风险提示，未确认不得付款
 */
// BusinessError 自 service 导入（循环安全：service → validator 仅值引用 BusinessError 类本身）
import { BusinessError } from './order.service';
import { ERROR_CODES } from '@contract/index';
import type { CreateOrderInput, TradeModeValue } from './dto/order.dto';

const TRADE_MODE_VALUES: readonly string[] = ['offline_meet', 'online_pay'];

const asBody = (raw: unknown): Record<string, unknown> => {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) {
    throw new BusinessError(ERROR_CODES.PARAM_VALIDATION_FAILED, '缺少必填字段：请求体');
  }
  return raw as Record<string, unknown>;
};

const toBigInt = (v: unknown, field: string): bigint => {
  if (typeof v !== 'string' && typeof v !== 'number') {
    throw new BusinessError(ERROR_CODES.PARAM_VALIDATION_FAILED, `缺少必填字段：${field}`);
  }
  try {
    const n = BigInt(v);
    if (n <= BigInt(0)) throw new Error();
    return n;
  } catch {
    throw new BusinessError(ERROR_CODES.PARAM_VALIDATION_FAILED, `${field} 非法`);
  }
};

const toDate = (v: unknown, field: string): Date => {
  if (typeof v !== 'string') {
    throw new BusinessError(ERROR_CODES.PARAM_VALIDATION_FAILED, `${field} 非法`);
  }
  const d = new Date(v);
  if (Number.isNaN(d.getTime())) {
    throw new BusinessError(ERROR_CODES.PARAM_VALIDATION_FAILED, `${field} 非法`);
  }
  return d;
};

/**
 * #30 创建订单入参校验。
 * trade_mode 缺省 'online_pay'（锁单防超卖主链路）；
 * @rule CIM-R-10 / @ac F13-AC2：online_pay 必须 risk_confirmed===true，否则 9001 拦截
 * （明示三要素：平台不托管资金/取消拒收规则/平台可协调但无法强制退款，前端弹层确认后回传）。
 */
export function validateCreateOrder(raw: unknown): CreateOrderInput {
  const body = asBody(raw);

  const productId = toBigInt(body.product_id, 'product_id');

  const tradeModeRaw = body.trade_mode === undefined ? 'online_pay' : body.trade_mode;
  if (typeof tradeModeRaw !== 'string' || !TRADE_MODE_VALUES.includes(tradeModeRaw)) {
    throw new BusinessError(ERROR_CODES.PARAM_VALIDATION_FAILED, 'trade_mode 非法');
  }
  const tradeMode = tradeModeRaw as TradeModeValue;

  const meetTime =
    body.meet_time === undefined || body.meet_time === null ? null : toDate(body.meet_time, 'meet_time');

  const riskConfirmed = body.risk_confirmed === true;
  if (tradeMode === 'online_pay' && !riskConfirmed) {
    // @rule CIM-R-10：未确认风险明示三要素不得付款/建单（与 F13-AC2、N8 联动）
    throw new BusinessError(
      ERROR_CODES.PARAM_VALIDATION_FAILED,
      '线上支付须先确认风险提示：平台不托管资金，务必当面验货后再确认收货',
    );
  }

  const intentId =
    body.intent_id === undefined || body.intent_id === null ? null : toBigInt(body.intent_id, 'intent_id');

  return { productId, tradeMode, meetTime, riskConfirmed, intentId };
}
