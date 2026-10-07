/**
 * @module PIM-BC-01
 * @model PIM-AG-01
 * @rule CIM-R-34
 * @api F26 POST /account/cancel；GET /account/cancel/status
 *
 * 账号注销与资料删除领域服务。
 *
 * AG-01 已注销终态不变量：注销终态「不可逆、不可再登录」——
 * 注销一经写入（user.status='cancelled'）即不可撤销，且 wxLogin 对已注销
 * 用户一律拦截（见 auth.service.ts），不得复活。
 *
 * CIM-R-34 留痕口径：注销仅匿名化个人资料（昵称/头像/脱敏实名），
 * 历史订单、评价、聊天等业务留痕保留，不在此删改。
 *
 * MVP 临时口径（T-307 任务注明）：在途校验仅覆盖在途订单 + 未结申诉两项，
 * 深度在途校验项（如求购/会话/举报等在途态）延后。
 */
import { Injectable } from '@nestjs/common';
import {
  AppealStatus,
  ERROR_CODES,
  OrderStatus,
  UserStatus,
} from '@contract/index';
import { PrismaService } from '@infra/prisma.service';
import { BusinessError } from './auth.service';
import {
  AccountCancelRequest,
  AccountCancelResponse,
  AccountCancelStatusResponse,
} from './dto/account-cancel.dto';

/** 在途订单状态（注销拦截项） */
const PENDING_ORDER_STATUSES: OrderStatus[] = [
  OrderStatus.PENDING_DELIVERY,
  OrderStatus.PENDING_CONFIRM,
  OrderStatus.APPEALING,
];

/** 未结申诉状态（注销拦截项） */
const PENDING_APPEAL_STATUSES: AppealStatus[] = [
  AppealStatus.PENDING,
  AppealStatus.PROCESSING,
];

@Injectable()
export class AccountCancelService {
  constructor(private readonly prisma: PrismaService) {}

  /**
   * @api F26-AC1 POST /account/cancel
   * @rule CIM-R-34
   * 注销流程：二次确认（confirm!==true → 9001）→ 用户存在性（1001）
   * → 终态幂等（已 cancelled 直接返回，不再写入）
   * → 在途校验（在途订单/未结申诉 → 9001，随 error.data 携带在途事项清单）
   * → 商品自动下架 + 账号注销与资料匿名化。
   */
  async cancel(uid: string, input: AccountCancelRequest): Promise<AccountCancelResponse> {
    // F26-AC1「发起注销并确认」：未二次确认直接 9001，不查询在途也不写入
    if (input?.confirm !== true) {
      throw new BusinessError(9001, '注销须二次确认（confirm=true）');
    }

    const userId = BigInt(uid);
    const user = await this.prisma.user.findUnique({ where: { id: userId } });
    if (!user) {
      throw new BusinessError(1001, '用户不存在');
    }

    // AG-01 终态幂等：已注销账号重复申请不再写入，直接返回已注销状态（不可逆）
    if (user.status === UserStatus.CANCELLED) {
      return {
        status: 'cancelled',
        cancelled_at: user.cancelled_at ? user.cancelled_at.toISOString() : null,
      };
    }

    // 在途校验（MVP 临时口径：仅在途订单 + 未结申诉；深度在途校验延后）
    const [pendingOrders, pendingAppeals] = await Promise.all([
      this.prisma.tradeOrder.findMany({
        where: {
          OR: [{ buyer_id: userId }, { seller_id: userId }],
          status: { in: PENDING_ORDER_STATUSES },
        },
      }),
      this.prisma.appeal.findMany({
        where: {
          appellant_id: userId,
          status: { in: PENDING_APPEAL_STATUSES },
        },
      }),
    ]);

    if (pendingOrders.length > 0 || pendingAppeals.length > 0) {
      // 9001（MVP 临时口径，任务注明）：携带在途事项清单，提示须先完结后再注销
      throw new BusinessError(9001, '存在在途订单或未结申诉，须先完结后再注销', {
        pending_orders: pendingOrders.map((o: { id: bigint; order_no: string; status: string }) => ({
          order_id: o.id.toString(),
          order_no: o.order_no,
          status: o.status,
        })),
        pending_appeals: pendingAppeals.map(
          (a: { id: bigint; appeal_type: string; status: string }) => ({
            appeal_id: a.id.toString(),
            appeal_type: a.appeal_type,
            status: a.status,
          }),
        ),
      });
    }

    const now = new Date();

    // 跨 schema 写入：auth 模块代写 product 域——注销名下在售商品自动下架
    await this.prisma.product.updateMany({
      where: { seller_id: userId, status: 'on_sale' },
      data: { status: 'off_sale', off_sale_at: now },
    });

    // 注销写入：终态 cancelled + 资料匿名化（CIM-R-34：仅匿名化，历史留痕保留）
    const updated = await this.prisma.user.update({
      where: { id: userId },
      data: {
        status: UserStatus.CANCELLED,
        cancelled_at: now,
        logout_requested_at: user.logout_requested_at ?? now,
        nickname: '已注销用户',
        avatar_url: '',
        real_name_masked: null,
      },
    });

    return {
      status: 'cancelled',
      cancelled_at: updated.cancelled_at ? updated.cancelled_at.toISOString() : now.toISOString(),
    };
  }

  /**
   * @api F26 GET /account/cancel/status
   * 注销状态查询：用户不存在 → 1001。
   */
  async getStatus(uid: string): Promise<AccountCancelStatusResponse> {
    const user = await this.prisma.user.findUnique({ where: { id: BigInt(uid) } });
    if (!user) {
      throw new BusinessError(1001, '用户不存在');
    }
    return {
      status: user.status,
      cancelled_at: user.cancelled_at ? user.cancelled_at.toISOString() : null,
      logout_requested_at: user.logout_requested_at
        ? user.logout_requested_at.toISOString()
        : null,
    };
  }
}
