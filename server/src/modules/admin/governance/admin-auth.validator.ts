/**
 * admin-auth.validator.ts —— 后台登录入参校验器（§5.3 #51）
 *
 * @module PIM-BC-05
 * 规则：username/password 必填非空字符串，长度上限防滥用；违规一律 9001。
 * 注意：import BusinessError 自 admin-auth.service 属循环引用，仅运行时调用访问，安全
 * （与 support/school-admin.validator 同款既定模式）。
 */
import { ERROR_CODES } from '@contract/error-codes';
import { BusinessError } from './admin-auth.service';

const MAX_USERNAME_LEN = 64;
const MAX_PASSWORD_LEN = 128;

export interface AdminLoginBody {
  username: string;
  password: string;
}

function fail(message: string): never {
  throw new BusinessError(ERROR_CODES.PARAM_VALIDATION_FAILED, message);
}

/** #51 登录请求体校验：username/password 必填非空，trim 归一化 username */
export function validateAdminLoginBody(input: unknown): AdminLoginBody {
  const body = (typeof input === 'object' && input !== null ? input : {}) as Record<
    string,
    unknown
  >;

  if (typeof body.username !== 'string' || body.username.trim().length === 0) {
    fail('username 必填');
  }
  if (body.username.trim().length > MAX_USERNAME_LEN) {
    fail(`username 超长（最大 ${MAX_USERNAME_LEN}）`);
  }
  if (typeof body.password !== 'string' || body.password.length === 0) {
    fail('password 必填');
  }
  if (body.password.length > MAX_PASSWORD_LEN) {
    fail(`password 超长（最大 ${MAX_PASSWORD_LEN}）`);
  }

  return { username: body.username.trim(), password: body.password };
}
