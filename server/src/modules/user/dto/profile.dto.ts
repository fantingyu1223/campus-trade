/**
 * user/dto/profile.dto.ts —— 个人/商家主页公开档案 DTO（契约 §5.2 user #46）。
 *
 * @module PIM-BC-01 身份与准入
 * @model PIM-AG-02 用户档案聚合（PublicProfile）
 * @api §5.2 #46 GET /users/{id}，@ac F2-AC1 / F2-AC2
 *
 * 纪律（PIM-AG-02 不变量 / N6）：本 DTO 为公开主页的唯一出站结构，
 * 仅含白名单公开字段；学号、资质材料、openid、real_name 等实名与凭证字段
 * 一律不得加入本文件。
 */
import { UserIdentityType } from '@contract/index';

/** 主页商品列表项（在售/已售共用；@table product → PIM-AG-03，user 模块仅同 schema 只读投影） */
export interface ProfileProductItem {
  id: string;
  title: string;
  /** Decimal 转字符串，避免浮点精度问题 */
  price: string;
  status: string;
  /** ISO 8601；未上架过（理论不发生）为 null */
  published_at: string | null;
  /** ISO 8601；仅已售列表存在 */
  sold_at?: string | null;
}

/**
 * 公开档案 user 字段组（§4.1 user 档案字段组的公开子集）。
 * 实名信息（student_no/license/real_name/openid）不出站（N6）。
 */
export interface PublicUserProfile {
  id: string;
  nickname: string;
  avatar: string;
  bio: string;
  /** 身份标识：guest/student/staff/merchant（F2-AC1 身份标识） */
  role: UserIdentityType;
  /**
   * 「认证商家」标识（F2-AC2 / F33 全链路亮标）。
   * 由 identity_type 派生，不可关闭（@rule CIM-R-28）。
   */
  is_merchant: boolean;
  school_id: string | null;
  school_name: string | null;
  /** 信用分占位（F4 为 P2，未落地前恒为 null） */
  credit_score: null;
  /** 注册时间（ISO 8601） */
  join_at: string;
}

/** 评价摘要占位（F17 评价模块落地前返回空摘要） */
export interface ReviewSummaryPlaceholder {
  avg_rating: null;
  total: 0;
}

/** §5.2 #46 响应 data 结构 */
export interface UserProfileResponse {
  user: PublicUserProfile;
  on_sale_count: number;
  sold_count: number;
  on_sale_list: ProfileProductItem[];
  sold_list: ProfileProductItem[];
  review_summary: ReviewSummaryPlaceholder;
}

/**
 * PATCH /users/me 请求体（资料编辑，全部可选但至少一项）。
 * @api 补充接口 PATCH /users/me（我的页面设置区·资料编辑）
 */
export interface UpdateProfileRequest {
  nickname?: string;
  bio?: string;
  avatar_url?: string;
  /** 匿名展示开关（N6：开启后公开档案与商品卖家信息展示为「匿名用户」） */
  is_anonymous?: boolean;
}

/**
 * PATCH /users/me 响应 data：更新后的本人档案（本人视角，不脱敏、不含实名字段）。
 * 与公开档案区分：本人可见真实 nickname/avatar 与 is_anonymous 开关状态。
 */
export interface UpdateProfileResponse {
  id: string;
  nickname: string;
  avatar: string;
  bio: string;
  is_anonymous: boolean;
  role: UserIdentityType;
  school_id: string | null;
  /** 注册时间（ISO 8601） */
  join_at: string;
}
