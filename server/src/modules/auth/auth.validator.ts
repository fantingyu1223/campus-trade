/**
 * @model PIM-AG-01
 * 认证模块入参校验器。
 * 注意：import BusinessError 自 auth.service 属循环引用，仅类型/调用时访问，安全。
 */
import { BusinessError } from './auth.service';

export interface ValidatedWxLoginDto {
  code: string;
}

export function validateWxLoginDto(input: unknown): ValidatedWxLoginDto {
  const code = (input as { code?: unknown })?.code;
  if (typeof code !== 'string' || code.trim().length === 0) {
    throw new BusinessError(9001, 'code 缺失或非法');
  }
  return { code: code.trim() };
}
