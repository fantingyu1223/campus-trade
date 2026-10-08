/**
 * user/user.controller.ts —— user 模块 HTTP 入口（模块自含，§3.1）。
 *
 * @module PIM-BC-01 身份与准入
 * @api §5.2 #46 GET /users/{id}，@ac F2-AC1 / F2-AC2；补充接口 PATCH /users/me（资料编辑）
 *
 * 纪律：主页公开可浏览（N1 / F2-AC2），getProfile 不挂 JwtAuthGuard；
 * PATCH /users/me 为本人写操作，挂 JwtAuthGuard（守卫与包络写法参照 product.controller）。
 * 参数校验失败抛 BusinessError(9001)，不透传 service。
 */
import { Body, Controller, Get, Param, Patch, Req, UseGuards } from '@nestjs/common';
import { ApiResponse, ERROR_CODES } from '@contract/index';
import { JwtAuthGuard } from '@infra/auth/jwt.guard';
import { UpdateProfileResponse, UserProfileResponse } from './dto/profile.dto';
import { BusinessError, UserService, ok } from './user.service';
import { validateUserIdParam } from './user.validator';

/** 认证上下文（JWT 载荷写入 req.user；id 为 string，需转 BigInt） */
interface AuthedRequest {
  user?: { id: string };
}

@Controller('users')
export class UserController {
  constructor(private readonly userService: UserService) {}

  /**
   * PATCH /users/me —— 本人资料编辑（昵称/简介/头像/匿名开关）。
   * @api 补充接口 PATCH /users/me（我的页面设置区·资料编辑；N6 匿名保护写侧入口）
   * 路由声明先于 ':id' 字面量冲突规避（不同方法不冲突，此处仅按模块惯例排序）。
   */
  @Patch('me')
  @UseGuards(JwtAuthGuard)
  async updateMe(
    @Body() body: unknown,
    @Req() req: AuthedRequest,
  ): Promise<ApiResponse<UpdateProfileResponse>> {
    if (!req.user) {
      throw new BusinessError(ERROR_CODES.AUTH_TOKEN_INVALID, '未登录或登录已过期');
    }
    const profile = await this.userService.updateMyProfile(BigInt(req.user.id), body);
    return ok(profile);
  }

  /**
   * GET /users/:id —— 个人/商家主页公开档案（游客可访问，N1）。
   * @api §5.2 #46
   */
  @Get(':id')
  async getProfile(@Param('id') id: string): Promise<ApiResponse<UserProfileResponse>> {
    const validId = validateUserIdParam(id);
    const profile = await this.userService.getPublicProfile(validId);
    return ok(profile);
  }
}
