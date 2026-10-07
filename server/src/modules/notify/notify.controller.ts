/**
 * notify/notify.controller.ts —— notify 模块 HTTP 入口（模块自含，§3.1）。
 *
 * @module PIM-BC-06 触达支撑
 * @api §5.2 #44 GET /notifications、#45 POST /notifications/read
 *
 * 纪律：全部端点需登录（JwtAuthGuard），uid 取自 req.user.uid；
 * 统一响应包络 {code:0,message:'ok',data}；校验失败由 service 抛 BusinessError(9001)。
 */
import { Body, Controller, Get, Post, Query, Req, UseGuards } from '@nestjs/common';
import { ApiResponse } from '@contract/index';
import { JwtAuthGuard } from '@infra/auth/jwt.guard';
import { NotificationListResult, MarkReadResult, NotificationRawQuery } from './dto/notify.dto';
import { NotifyQueryService } from './notify-query.service';

/** 成功包络：data 恒非空（code=0 分支收窄，便于调用方直接访问 data 字段） */
type OkResponse<T> = ApiResponse<T> & { code: 0; message: 'ok'; data: T };

@Controller('notifications')
@UseGuards(JwtAuthGuard)
export class NotifyController {
  constructor(private readonly query: NotifyQueryService) {}

  /** @api §5.2 #44 GET /notifications 本人通知列表（倒序分页 + unread_count） */
  @Get()
  async list(
    @Req() req: { user: { uid: string } },
    @Query() query: NotificationRawQuery,
  ): Promise<OkResponse<NotificationListResult>> {
    return { code: 0, message: 'ok', data: await this.query.list(req.user.uid, query) };
  }

  /** @api §5.2 #45 POST /notifications/read 批量/全部标记已读 */
  @Post('read')
  async markRead(
    @Req() req: { user: { uid: string } },
    @Body() body: unknown,
  ): Promise<OkResponse<MarkReadResult>> {
    return { code: 0, message: 'ok', data: await this.query.markRead(req.user.uid, body) };
  }
}
