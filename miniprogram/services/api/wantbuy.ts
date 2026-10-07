/**
 * services/api/wantbuy.ts —— want-buy 求购分组接口封装（F9）。
 * @api §5.2 want-buy 分组（#20 POST /want-buys 发布 / #21 POST /want-buys/{id}/renew 续期 /
 *      #22 POST /want-buys/{id}/close 关闭 / #23 POST /want-buys/{id}/bought 标记已买到 /
 *      #24 GET /want-buys 列表 scope=all/mine）
 * 复用 auth.ts 导出的通用 request；统一响应包络由 request 解析。
 * @module PIM-BC-02 求购与撮合
 *
 * 契约偏离说明（待契约修订确认）：
 * 1. 续期天数：#21 表内写「延长 7 天」，后端 T-201 已按「续期重置 30 天」临时口径实现，
 *    前端 U19 按 30 天口径展示（发布页提示「有效期 30 天，可续期」）。
 * 2. 预期价位区间：#20 仅有 max_price，U19/U22 需要区间展示，扩展 min_price 字段。
 * 3. 成色：#20 无成色字段，发布表单扩展 condition 字段（与商品成色枚举一致）。
 */
import { request } from './auth';

// ---------- 类型定义（对齐 §5.2 #20-24；min_price/condition 见头注释偏离 2/3） ----------
export type WantBuyStatus = 'active' | 'closed' | 'bought' | 'expired';

/** 求购条目（#24 列表项） */
export interface WantBuyItem {
  id: number;
  category_id: number;
  category_name?: string;
  title: string;
  desc?: string;
  min_price?: number;
  max_price: number;
  condition?: string;
  images?: string[];
  status: WantBuyStatus;
  expire_at: string;
  created_at: string;
}

export interface WantBuyListResult {
  list: WantBuyItem[];
  has_more: boolean;
}

/** 发布求购请求（#20；expire_days 默认 30，见头注释偏离 1） */
export interface PublishWantBuyPayload {
  title: string;
  desc?: string;
  min_price?: number;
  max_price: number;
  category_id: number;
  condition?: string;
  images?: string[];
  expire_days?: number;
}

// ---------- #20 POST /want-buys 发布求购 ----------
export function publishWantBuy(payload: PublishWantBuyPayload): Promise<{ id: number; expire_at: string }> {
  return request<{ id: number; expire_at: string }>({
    url: '/want-buys',
    method: 'POST',
    data: payload as unknown as Record<string, unknown>,
  });
}

// ---------- #24 GET /want-buys 列表（scope=all/mine） ----------
export function listWantBuys(
  scope: 'all' | 'mine' = 'all',
  page = 1,
  pageSize = 20,
): Promise<WantBuyListResult> {
  return request<WantBuyListResult>({
    url: '/want-buys',
    method: 'GET',
    data: { scope, page, pageSize },
  });
}

// ---------- #21 POST /want-buys/{id}/renew 续期（重置 30 天，见头注释偏离 1） ----------
export function renewWantBuy(id: number): Promise<{ expire_at: string }> {
  return request<{ expire_at: string }>({ url: `/want-buys/${id}/renew`, method: 'POST' });
}

// ---------- #22 POST /want-buys/{id}/close 主动关闭（终态） ----------
export function closeWantBuy(id: number): Promise<{ status: WantBuyStatus }> {
  return request<{ status: WantBuyStatus }>({ url: `/want-buys/${id}/close`, method: 'POST' });
}

// ---------- #23 POST /want-buys/{id}/bought 标记已买到（终态） ----------
export function boughtWantBuy(id: number): Promise<{ status: WantBuyStatus }> {
  return request<{ status: WantBuyStatus }>({ url: `/want-buys/${id}/bought`, method: 'POST' });
}
