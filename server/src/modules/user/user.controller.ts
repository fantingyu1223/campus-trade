/**
 * user/user.controller.ts —— user 模块 HTTP 入口（模块自含，§3.1）。
 *
 * @module PIM-BC-01 身份与准入
 * @api §5.2 #46 GET /users/{id}，@ac F2-AC1 / F2-AC2
 *
 * 纪律：主页公开可浏览（N1 / F2-AC2），getProfile 不挂 JwtAuthGuard；
 * 参数校验失败抛 BusinessError(9001)，不透传 service。
 */
import { Controller, Get, Param } from '@nestjs/common';
import { ApiResponse } from '@contract/index';
import { UserProfileResponse } from './dto/profile.dto';
import { UserService, ok } from './user.service';
import { validateUserIdParam } from './user.validator';

@Controller('users')
export class UserController {
  constructor(private readonly userService: UserService) {}

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
