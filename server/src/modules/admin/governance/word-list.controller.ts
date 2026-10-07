/**
 * word-list.controller.ts —— 词表配置 HTTP 入口（§5.3 #82-86 具体化，A9 词表配置页）
 *
 * @module PIM-BC-06
 * @api §5.3 #82-86（configs type=word_list 的具体化，对齐 admin-web/src/api/word-list.ts）
 *
 * 路由：GET /admin/v1/word-lists、POST /word-lists、PUT /word-lists/:id、
 * POST /word-lists/:id/toggle、GET /word-lists/:id/history。
 * 读接口 auditor/admin 均可；写接口仅超管 admin（assertSuperAdmin，auditor → 6001）。
 */
import { Body, Controller, Get, Param, Post, Put, Query, Req, UseGuards } from '@nestjs/common';
import { AdminJwtGuard } from '@infra/auth/admin-jwt.guard';
import { WordListService } from './word-list.service';
import { assertSuperAdmin, validateWordIdParam } from './word-list.validator';

interface AdminRequest {
  admin: { admin_id: string; role: string };
}

@Controller('admin/v1')
@UseGuards(AdminJwtGuard)
export class WordListController {
  constructor(private readonly wordList: WordListService) {}

  /** 词表分页列表（type 过滤） */
  @Get('word-lists')
  async list(@Query() q: unknown) {
    return { code: 0, message: 'ok', data: await this.wordList.list(q) };
  }

  /** 变更历史（置于 :id 之前无冲突：GET word-lists/:id/history） */
  @Get('word-lists/:id/history')
  async history(@Param('id') id: string) {
    return { code: 0, message: 'ok', data: await this.wordList.history(validateWordIdParam(id)) };
  }

  /** 新增词条（仅 admin） */
  @Post('word-lists')
  async create(@Req() req: AdminRequest, @Body() body: unknown) {
    assertSuperAdmin(req.admin.role);
    return { code: 0, message: 'ok', data: await this.wordList.create(req.admin.admin_id, body) };
  }

  /** 修改词条（仅 admin） */
  @Put('word-lists/:id')
  async update(@Req() req: AdminRequest, @Param('id') id: string, @Body() body: unknown) {
    assertSuperAdmin(req.admin.role);
    return {
      code: 0,
      message: 'ok',
      data: await this.wordList.update(req.admin.admin_id, validateWordIdParam(id), body),
    };
  }

  /** 启用/停用（仅 admin；保存后刷新词表快照） */
  @Post('word-lists/:id/toggle')
  async toggle(@Req() req: AdminRequest, @Param('id') id: string) {
    assertSuperAdmin(req.admin.role);
    return {
      code: 0,
      message: 'ok',
      data: await this.wordList.toggle(req.admin.admin_id, validateWordIdParam(id)),
    };
  }
}
