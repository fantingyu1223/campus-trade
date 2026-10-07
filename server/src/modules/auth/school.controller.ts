/**
 * @module PIM-BC-01
 * @model PIM-AG-01
 * @api §5.2 #5 GET /schools（游客可读）；§5.2 #6 POST /schools/join（登录）；
 *      GET /schools/join/status（进度查询，契约外新增，已声明，对齐 verify/status 模式）
 * @ac F36-AC1
 * 高校名单控制器：统一返回 {code:0, message:'ok', data}。
 */
import { Body, Controller, Get, Post, Query, Req, UseGuards } from '@nestjs/common';
import { JwtAuthGuard } from '@infra/auth/jwt.guard';
import { SchoolService } from './school.service';
import {
  JoinStatusResponse,
  SchoolJoinResponse,
  SchoolListResponse,
} from './dto/school.dto';

interface ApiResponse<T> {
  code: number;
  message: string;
  data: T;
}

@Controller('schools')
export class SchoolController {
  constructor(private readonly school: SchoolService) {}

  /** @api §5.2 #5 GET /schools @ac F36-AC1 游客可读（无守卫） */
  @Get()
  async list(@Query() query: unknown): Promise<ApiResponse<SchoolListResponse>> {
    return { code: 0, message: 'ok', data: await this.school.list(query) };
  }

  /** @api §5.2 #6 POST /schools/join @ac F36-AC1 需登录 */
  @Post('join')
  @UseGuards(JwtAuthGuard)
  async join(
    @Req() req: { user: { uid: string } },
    @Body() body: unknown,
  ): Promise<ApiResponse<SchoolJoinResponse>> {
    return {
      code: 0,
      message: 'ok',
      data: await this.school.submitJoin(req.user.uid, body),
    };
  }

  /** GET /schools/join/status 进度查询（契约外新增，已声明）需登录 */
  @Get('join/status')
  @UseGuards(JwtAuthGuard)
  async joinStatus(
    @Req() req: { user: { uid: string } },
  ): Promise<ApiResponse<JoinStatusResponse>> {
    return {
      code: 0,
      message: 'ok',
      data: await this.school.getJoinStatus(req.user.uid),
    };
  }
}
