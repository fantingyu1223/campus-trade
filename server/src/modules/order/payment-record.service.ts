/**
 * payment-record.service.ts —— 支付留痕服务（§6 支付对策 B）
 *
 * @module PIM-BC-04 交易订单
 * @rule §6 对策 B：平台不经手资金，线下扫码当面付（offline_scan），
 *       payment_record 仅作留痕/对账，不触发任何资金流转
 * @api §5.2 #30 POST /orders（建单时随事务落 payment_record）
 */
import { Injectable } from '@nestjs/common';

/** payment_record 落库载荷（channel/status/amount 三要素，金额快照字符串原样保存） */
export interface PaymentRecordPayload {
  channel: 'offline_scan';
  status: 'pending';
  amount: string;
}

@Injectable()
export class PaymentRecordService {
  /**
   * §6 对策 B：构造线下扫码留痕载荷。
   * 平台不托管资金、不生成支付单，只记录 channel=offline_scan + status=pending，
   * 实际付款由买卖双方当面扫码完成，后续状态由确认收货/申诉流程推进。
   */
  buildOfflineScanPayload(amount: string): PaymentRecordPayload {
    return { channel: 'offline_scan', status: 'pending', amount };
  }
}
