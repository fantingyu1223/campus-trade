/**
 * chat.controller.ts —— 会话与消息控制器
 *
 * @module PIM-BC-03 沟通与协商
 * @model PIM-AG-05 会话与消息聚合
 * @api §5.2 #25-27 + POST /conversations（发起会话）+ POST /conversations/:id/read（已读回执）
 * @rule CIM-R-01 已认证（实名）方可发起会话（create 叠加 VerifiedGuard）
 *
 * 类级 JwtAuthGuard：全部端点需登录；POST /conversations 再叠加 VerifiedGuard。
 * req.user.uid（string）转 { id: BigInt } 上下文；uid 缺失 → 1001。
 */
import {
  Body,
  Controller,
  Get,
  Param,
  Post,
  Query,
  Req,
  UseGuards,
} from '@nestjs/common';
import { ERROR_CODES } from '@contract/index';
import { JwtAuthGuard } from '@infra/auth/jwt.guard';
import { VerifiedGuard } from '@infra/auth/verified.guard';
import {
  BusinessError,
  ChatUserContext,
  ConversationService,
} from './conversation.service';
import { MessageService } from './message.service';
import type {
  ConversationListResult,
  CreateConversationResult,
  MarkReadResult,
  MessageListResult,
  SendMessageResult,
} from './dto/message.dto';

interface ApiResponse<T> {
  code: number;
  message: string;
  data: T;
}

/** 认证请求（JWT 载荷写入 req.user；uid 为 string，需转 BigInt） */
interface AuthedRequest {
  user?: { uid?: string };
}

/** req.user.uid 转服务层上下文；uid 缺失 → 1001 */
const userFromReq = (req: AuthedRequest): ChatUserContext => {
  const uid = req.user?.uid;
  if (!uid) {
    throw new BusinessError(ERROR_CODES.AUTH_TOKEN_INVALID, '未登录或登录已过期');
  }
  return { id: BigInt(uid) };
};

@Controller('conversations')
@UseGuards(JwtAuthGuard)
export class ChatController {
  constructor(
    private readonly conversationService: ConversationService,
    private readonly messageService: MessageService,
  ) {}

  /** @api POST /conversations 发起会话（需实名，@rule CIM-R-01） */
  @Post()
  @UseGuards(VerifiedGuard)
  async create(
    @Body() body: unknown,
    @Req() req: AuthedRequest,
  ): Promise<ApiResponse<CreateConversationResult>> {
    const data = await this.conversationService.createConversation(userFromReq(req), body);
    return { code: 0, message: 'ok', data };
  }

  /** @api §5.2 #25 GET /conversations 会话列表 */
  @Get()
  async list(@Req() req: AuthedRequest): Promise<ApiResponse<ConversationListResult>> {
    const data = await this.conversationService.listConversations(userFromReq(req));
    return { code: 0, message: 'ok', data };
  }

  /** @api §5.2 #26 GET /conversations/:id/messages 游标分页 */
  @Get(':id/messages')
  async listMessages(
    @Param('id') id: string,
    @Query() query: unknown,
    @Req() req: AuthedRequest,
  ): Promise<ApiResponse<MessageListResult>> {
    const data = await this.messageService.listMessages(userFromReq(req), id, query);
    return { code: 0, message: 'ok', data };
  }

  /** @api §5.2 #27 POST /conversations/:id/messages 发消息 */
  @Post(':id/messages')
  async sendMessage(
    @Param('id') id: string,
    @Body() body: unknown,
    @Req() req: AuthedRequest,
  ): Promise<ApiResponse<SendMessageResult>> {
    const data = await this.messageService.sendMessage(userFromReq(req), id, body);
    return { code: 0, message: 'ok', data };
  }

  /** @api POST /conversations/:id/read 已读回执 */
  @Post(':id/read')
  async markRead(
    @Param('id') id: string,
    @Req() req: AuthedRequest,
  ): Promise<ApiResponse<MarkReadResult>> {
    const data = await this.conversationService.markRead(userFromReq(req), id);
    return { code: 0, message: 'ok', data };
  }
}
