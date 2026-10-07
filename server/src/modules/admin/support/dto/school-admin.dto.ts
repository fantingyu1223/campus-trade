/**
 * @module PIM-BC-06
 * @api §5.3 school #68-73
 * 后台高校名单配置 DTO：请求体与查询参数类型声明（仅类型，无逻辑）。
 */

/** #69 POST /admin/v1/schools 请求体 */
export interface SchoolCreateRequest {
  name: string;
  short_name?: string;
  email_suffix?: string;
  city?: string;
  remark?: string;
}

/** #70 PUT /admin/v1/schools/{id} 请求体（全可选，但至少一项） */
export interface SchoolUpdateRequest {
  name?: string;
  short_name?: string;
  email_suffix?: string;
  city?: string;
  remark?: string;
}

/** #71 DELETE /admin/v1/schools/{id} 请求体（软删除二次确认） */
export interface SchoolDisableRequest {
  confirm?: boolean;
}

/** #73 POST /admin/v1/school-join-requests/{id}/handle 请求体 */
export interface HandleJoinRequest {
  action: 'approve' | 'reject';
  note?: string;
}

/** #68 GET /admin/v1/schools 查询参数（归一化后） */
export interface SchoolListQuery {
  keyword?: string;
  status?: 'active' | 'disabled';
  page: number;
  pageSize: number;
}

/** #72 GET /admin/v1/school-join-requests 查询参数（归一化后） */
export interface JoinRequestListQuery {
  status?: 'pending' | 'approved' | 'rejected';
  page: number;
  pageSize: number;
}
