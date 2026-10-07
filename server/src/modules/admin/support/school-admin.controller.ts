/**
 * @module PIM-BC-06
 * @api §5.3 school #68-73（GET/POST /admin/v1/schools、PUT/DELETE /admin/v1/schools/{id}、
 *      GET /admin/v1/school-join-requests、POST /admin/v1/school-join-requests/{id}/handle）
 * @ac F36-AC2
 * 后台高校名单配置控制器：类级 AdminJwtGuard，统一返回 {code:0,message:'ok',data}。
 */
import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  Post,
  Put,
  Query,
  Req,
  UseGuards,
} from '@nestjs/common';
import { AdminJwtGuard } from '@infra/auth/admin-jwt.guard';
import { AdminLogService } from '@infra/admin-log/admin-log.interceptor';
import { SchoolAdminService } from './school-admin.service';

interface ApiResponse<T> {
  code: number;
  message: string;
  data: T;
}

interface AdminRequest {
  admin: { admin_id: string; role: string };
}

@Controller('admin/v1')
@UseGuards(AdminJwtGuard)
export class SchoolAdminController {
  constructor(
    private readonly schoolAdmin: SchoolAdminService,
    /** T-309 统一留痕切面（可选注入，保证既有单参构造兼容） */
    private readonly adminLog?: AdminLogService,
  ) {}

  /** @api §5.3 #68 GET /admin/v1/schools */
  @Get('schools')
  async listSchools(@Query() query: unknown) {
    return { code: 0, message: 'ok', data: await this.schoolAdmin.list(query) };
  }

  /** @api §5.3 #69 POST /admin/v1/schools */
  @Post('schools')
  async createSchool(@Req() req: AdminRequest, @Body() body: unknown) {
    const data = await this.schoolAdmin.create(req.admin.admin_id, body);
    const remark = (body as { remark?: string } | null)?.remark;
    await this.adminLog?.record({
      operatorId: req.admin.admin_id,
      action: 'school.create',
      targetType: 'school',
      targetId: data.id,
      reason: remark ?? `新增学校 ${data.name}`,
    });
    return { code: 0, message: 'ok', data };
  }

  /** @api §5.3 #70 PUT /admin/v1/schools/{id} */
  @Put('schools/:id')
  async updateSchool(
    @Req() req: AdminRequest,
    @Param('id') id: string,
    @Body() body: unknown,
  ) {
    const data = await this.schoolAdmin.update(req.admin.admin_id, id, body);
    const remark = (body as { remark?: string } | null)?.remark;
    await this.adminLog?.record({
      operatorId: req.admin.admin_id,
      action: 'school.update',
      targetType: 'school',
      targetId: id,
      reason: remark ?? `修改学校 #${id}`,
    });
    return { code: 0, message: 'ok', data };
  }

  /** @api §5.3 #71 DELETE /admin/v1/schools/{id}（软删除，data=null） */
  @Delete('schools/:id')
  async disableSchool(
    @Req() req: AdminRequest,
    @Param('id') id: string,
    @Body() body: unknown,
  ): Promise<ApiResponse<null>> {
    const data = await this.schoolAdmin.disable(req.admin.admin_id, id, body);
    const remark = (body as { remark?: string } | null)?.remark;
    await this.adminLog?.record({
      operatorId: req.admin.admin_id,
      action: 'school.disable',
      targetType: 'school',
      targetId: id,
      reason: remark ?? `停用学校 #${id}`,
    });
    return { code: 0, message: 'ok', data };
  }

  /** @api §5.3 #72 GET /admin/v1/school-join-requests */
  @Get('school-join-requests')
  async listJoinRequests(@Query() query: unknown) {
    return {
      code: 0,
      message: 'ok',
      data: await this.schoolAdmin.joinRequests(query),
    };
  }

  /** @api §5.3 #73 POST /admin/v1/school-join-requests/{id}/handle */
  @Post('school-join-requests/:id/handle')
  async handleJoinRequest(
    @Req() req: AdminRequest,
    @Param('id') id: string,
    @Body() body: unknown,
  ) {
    const data = await this.schoolAdmin.handleJoin(req.admin.admin_id, id, body);
    const b = (body ?? {}) as { action?: string; note?: string };
    await this.adminLog?.record({
      operatorId: req.admin.admin_id,
      action: `school_join.${b.action}`,
      targetType: 'school_join_application',
      targetId: id,
      reason: b.note ?? `处理加入申请 #${id}（${b.action}）`,
    });
    return { code: 0, message: 'ok', data };
  }
}
