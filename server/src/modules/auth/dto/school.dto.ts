/**
 * @module PIM-BC-01
 * @model PIM-AG-01
 * @api §5.2 #5/#6
 * 高校名单 DTO：学校列表查询/响应、名单外加入申请提交/响应与进度查询响应。
 * 对齐 API 契约；id/school_id 以 string 输出（BigInt 序列化为字符串）。
 */

/** 学校列表查询参数（validator 归一化后） */
export interface SchoolListQuery {
  keyword?: string;
  page: number;
  pageSize: number;
}

/** §5.2 #5 列表项（契约 list[{id, name, city}]，附带 short_name 供认证页展示） */
export interface SchoolListItem {
  id: string;
  name: string;
  short_name: string;
  city: string | null;
}

/** §5.1 统一分页结构 */
export interface SchoolListResponse {
  page: number;
  pageSize: number;
  total: number;
  list: SchoolListItem[];
}

/** §5.2 #6 加入申请请求（契约字段 school_id、evidence[]） */
export interface SchoolJoinRequest {
  school_id: string;
  evidence?: string[];
  reason?: string;
  student_no?: string;
}

/** §5.2 #6 加入申请响应（契约字段 apply_id、status） */
export interface SchoolJoinResponse {
  apply_id: string;
  status: 'pending';
  submitted_at: string;
}

/** 进度查询列表项（含 school_name 回显，对应任务"关联 school 名称"口径） */
export interface JoinApplicationItem {
  id: string;
  school_id: string;
  school_name: string | null;
  status: 'pending' | 'approved' | 'rejected';
  reject_reason: string | null;
  submitted_at: string;
  reviewed_at: string | null;
}

export interface JoinStatusResponse {
  list: JoinApplicationItem[];
}
