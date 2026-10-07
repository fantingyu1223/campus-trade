/**
 * intent.controller.ts —— 交易意向卡片控制器
 *
 * @module PIM-BC-03 沟通与协商
 * @model PIM-AG-05 交易意向卡片聚合（TradeIntentCard）
 * @api §5.2 #28 POST /conversations/:id/intents + #29 POST /intents/:id/respond
 * @ac F14-AC1 双方确认后卡片置「双方已确认」；任一方未确认前为待确认
 *
 * 类级 JwtAuthGuard：两端点均需登录。req.user.uid（string）转 BigInt 上下文；
 * uid 缺失 → 1001。
 * 注：本控制器尚未注册进 ChatModule（T-205 隔离约定不改动既有模块文件），
 * 注册动作留待集成批次处理（见交接遗留问题）。
 */
import { Body, Controller, Param, Post, Req, UseGuards } from '@nestjs/common';
import { ERROR_CODES } from '@contract/index';
import { JwtAuthGuard } from '@infra/auth/jwt.guard';
import { BusinessError, ChatUserContext } from './conversation.service';
import { IntentService } from './intent.service';
import type { CreateIntentResult, RespondIntentResult } from './dto/intent.dto';

interface ApiResponse<T> {
  code: number;
  message: string;
  data: T;
}

/** 认证请求（JWT 载荷写入 req.user；uid 为 string，需转 BigInt） */
interface AuthedRequest {
  user?: { uid?: string };
}

/** req.user.uid 转服务层上下文；uid 缺失 → 1001（与 chat.controller.ts 口径一致） */
const userFromReq = (req: AuthedRequest): ChatUserContext => {
  const uid = req.user?.uid;
  if (!uid) {
    throw new BusinessError(ERROR_CODES.AUTH_TOKEN_INVALID, '未登录或登录已过期');
  }
  return { id: BigInt(uid) };
};

@Controller()
@UseGuards(JwtAuthGuard)
export class IntentController {
  constructor(private readonly intentService: IntentService) {}

  /** @api §5.2 #28 POST /conversations/:id/intents 发起意向卡片（F14-AC1） */
  @Post('conversations/:id/intents')
  async create(
    @Param('id') id: string,
    @Body() body: unknown,
    @Req() req: AuthedRequest,
  ): Promise<ApiResponse<CreateIntentResult>> {
    const data = await this.intentService.createIntent(userFromReq(req), id, body);
    return { code: 0, message: 'ok', data };
  }

  /** @api §5.2 #29 POST /intents/:id/respond 响应意向卡片（accept/reject） */
  @Post('intents/:id/respond')
  async respond(
    @Param('id') id: string,
    @Body() body: unknown,
    @Req() req: AuthedRequest,
  ): Promise<ApiResponse<RespondIntentResult>> {
    const data = await this.intentService.respond(userFromReq(req), id, body);
    return { code: 0, message: 'ok', data };
  }
}
