/**
 * review.controller.ts —— 交易评价控制器
 *
 * @module PIM-BC-05 交易评价
 * @api §5.2 #38 POST /reviews、#39 GET /users/{id}/reviews（统一响应包络 §5.1）
 * 备注：#39 契约原始形态为 GET /reviews?user_id=，经 T-209 任务口径落为
 * GET /users/{id}/reviews（RESTful 资源归属，游客可读），已同步接口变更说明。
 */
import { Body, Controller, Get, Param, Post, Query, Req, UseGuards } from '@nestjs/common';
import { ERROR_CODES } from '@contract/index';
import { JwtAuthGuard } from '@infra/auth/jwt.guard';
import { BusinessError, ReviewService } from './review.service';
import type { PublicReviewListResult, SubmitReviewResult } from './dto/review.dto';

interface ApiResponse<T> {
  code: number;
  message: string;
  data: T;
}

/** 认证上下文（JWT 载荷写入 req.user；uid 为 string，需转 BigInt） */
interface AuthedRequest {
  user?: { uid?: string; id?: string };
}

/** 登录守卫：uid??id 缺失 → 1001 */
const requireReviewer = (req: AuthedRequest): bigint => {
  const uid = req.user?.uid ?? req.user?.id;
  if (!uid) {
    throw new BusinessError(ERROR_CODES.AUTH_TOKEN_INVALID, '未登录或登录已过期');
  }
  return BigInt(uid);
};

/** 路径参数用户 ID：非法 → 9001 */
const parseUserId = (raw: string): bigint => {
  try {
    const id = BigInt(raw);
    if (id <= BigInt(0)) throw new Error();
    return id;
  } catch {
    throw new BusinessError(ERROR_CODES.PARAM_VALIDATION_FAILED, 'id 非法');
  }
};

@Controller()
export class ReviewController {
  constructor(private readonly reviewService: ReviewService) {}

  /** @api §5.2 #38 POST /reviews（需登录，买卖双方其一） */
  @Post('reviews')
  @UseGuards(JwtAuthGuard)
  async submit(@Body() body: unknown, @Req() req: AuthedRequest): Promise<ApiResponse<SubmitReviewResult>> {
    const reviewerId = requireReviewer(req);
    const data = await this.reviewService.submitReview(reviewerId, body);
    return { code: 0, message: 'ok', data };
  }

  /** @api §5.2 #39 GET /users/{id}/reviews（游客可读：不做登录守卫） */
  @Get('users/:id/reviews')
  async listPublic(
    @Param('id') id: string,
    @Query() query: unknown,
  ): Promise<ApiResponse<PublicReviewListResult>> {
    const data = await this.reviewService.listPublicReviews(parseUserId(id), query);
    return { code: 0, message: 'ok', data };
  }
}
