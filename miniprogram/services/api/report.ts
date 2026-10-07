/**
 * services/api/report.ts —— report 举报分组接口封装（F18，用户侧）。
 * @api §5.2 report 分组（#40 POST /reports 提交举报 / #41 GET /reports/mine 我的举报列表）
 * 复用 auth.ts 导出的通用 request；统一响应包络由 request 解析。
 * @module PIM-BC-05 评价与治理
 *
 * 匿名保护（F18-AC2 / §4.21）：API 输出层必须剥离 reporter_id，任何响应不输出举报人身份。
 * 枚举对齐 types/contract.ts：ReportTargetType / ReportCategory。
 * 契约偏离说明：#40 表中字段名为 type/desc/evidence[]，本封装按契约表透传；
 * 枚举取值以 types/contract.ts（server contract 同步层）为准（fraud/prohibited/false_desc/other）。
 */
import { request } from './auth';
import { ReportTargetType, ReportCategory, ReportStatus, ReportResult } from '../../types/contract';

// ---------- 类型定义（对齐 §5.2 #40-41 + §4.21 report 表） ----------
/** 提交举报请求（#40） */
export interface SubmitReportPayload {
  /** 举报对象类型：product/user/chat（merchant 归并 user 入口，见 contract ReportTargetType） */
  target_type: ReportTargetType;
  target_id: number;
  /** 举报分类：fraud/prohibited/false_desc/other（契约字段名 type） */
  type: ReportCategory;
  /** 补充描述（≤500 字） */
  desc: string;
  /** 凭证图（≤9 张，图/聊天截图 URL 或临时路径，接口就绪后走上传换 URL） */
  evidence?: string[];
}

/** 提交举报响应（#40） */
export interface SubmitReportResult {
  report_id: number;
  status: ReportStatus.PENDING;
}

/** 我的举报列表项（#41） */
export interface MyReportItem {
  report_id: number;
  target_type: ReportTargetType;
  type: ReportCategory;
  status: ReportStatus;
  result?: ReportResult;
  created_at: string;
}

export interface MyReportListResult {
  list: MyReportItem[];
  has_more: boolean;
}

// ---------- #40 POST /reports 提交举报 ----------
export function submitReport(payload: SubmitReportPayload): Promise<SubmitReportResult> {
  return request<SubmitReportResult>({
    url: '/reports',
    method: 'POST',
    data: payload as unknown as Record<string, unknown>,
  });
}

// ---------- #41 GET /reports/mine 我的举报列表 ----------
export function listMyReports(page = 1, pageSize = 20): Promise<MyReportListResult> {
  return request<MyReportListResult>({
    url: '/reports/mine',
    method: 'GET',
    data: { page, pageSize },
  });
}
