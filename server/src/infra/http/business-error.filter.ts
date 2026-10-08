/**
 * infra/http/business-error.filter.ts —— BusinessError 全局异常过滤器。
 *
 * 背景：项目内各模块自含的 BusinessError 均继承裸 Error（无 HTTP 状态语义），
 * 未注册过滤器时 Nest 默认返回 500 Internal server error，前端无法拿到业务错误码。
 * 本过滤器将 BusinessError（及其同名子类）映射为统一包络：
 *   { code, message, data }，HTTP 200（业务判定一律以 code 为准，§5.1 通用约定）。
 * data 口径：BusinessError 携带 details 时透传至 data（契约 §5.2 #27：3002 命中
 *   风险词时 data 仍返回风险详情 {hits}，供前端弹层）；无 details 时 data=null。
 * 命名 HttpException（如 guard 抛出的 UnauthorizedException）按 Nest 原生语义透传（401/403 等）。
 */
import { ArgumentsHost, Catch, ExceptionFilter } from '@nestjs/common';

interface BusinessErrorLike extends Error {
  code: number;
  details?: unknown;
}

function isBusinessError(err: unknown): err is BusinessErrorLike {
  return (
    err instanceof Error &&
    err.name === 'BusinessError' &&
    typeof (err as BusinessErrorLike).code === 'number'
  );
}

@Catch()
export class BusinessErrorFilter implements ExceptionFilter {
  catch(exception: unknown, host: ArgumentsHost): void {
    const res = host.switchToHttp().getResponse();
    if (isBusinessError(exception)) {
      res
        .status(200)
        .json({ code: exception.code, message: exception.message, data: exception.details ?? null });
      return;
    }
    // 非 BusinessError：透传给 Nest 默认异常处理（HttpException → 401/403/500 等）
    if (exception instanceof Error && 'getStatus' in exception && typeof (exception as { getStatus: unknown }).getStatus === 'function') {
      const status = (exception as { getStatus: () => number }).getStatus();
      const body = (exception as { getResponse?: () => unknown }).getResponse?.() ?? { message: exception.message };
      res.status(status).json(body);
      return;
    }
    res.status(500).json({ statusCode: 500, message: 'Internal server error' });
  }
}
