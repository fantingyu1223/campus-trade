/**
 * dto/report.dto.ts —— 举报模块自含 DTO 声明（§3.1 自给自足，仅限声明不写逻辑）
 *
 * @module PIM-BC-05 举报
 * @model PIM-AG-08 举报聚合
 * @api §5.2 #40 POST /reports + @ac F18-AC1
 */

/** 举报对象类型（T-301 口径：product/user/order/want_buy/message，越界 9001） */
export type ReportTargetType = 'product' | 'user' | 'order' | 'want_buy' | 'message';

/** 举报分类（fraud 诈骗 / prohibited 违禁品 / false_desc 描述不实 / other 其他） */
export type ReportCategory = 'fraud' | 'prohibited' | 'false_desc' | 'other';

/** SLA 分级（urgent 4h / high 24h / normal 48h，为 T-302 处置队列铺垫） */
export type SlaLevel = 'urgent' | 'high' | 'normal';

/** #40 提交举报：校验后的规范化入参（category/content/evidence_urls 为规范字段名） */
export interface SubmitReportInput {
  targetType: ReportTargetType;
  targetId: bigint;
  category: ReportCategory;
  /** 举报补充说明（非空，≤500 字） */
  content: string;
  /** 凭证图 URL 数组（≤9 张，可空数组） */
  evidenceUrls: string[];
}

/** #40 提交举报响应（CIM-R-20：仅 report_id+status，绝不含 reporter 身份字段） */
export interface SubmitReportResult {
  report_id: string;
  status: 'pending';
}
