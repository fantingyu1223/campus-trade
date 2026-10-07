/**
 * user/user.validator.ts —— user 模块入参校验（模块自含，§3.1）。
 *
 * @module PIM-BC-01 身份与准入
 * 校验失败一律抛 BusinessError(9001)（契约 §5.1 参数校验失败）。
 */
import { ERROR_CODES } from '@contract/index';
import { BusinessError } from './user.service';

/** 合法的用户 id 路径参数：正整数（十进制字符串，允许首尾空白） */
const USER_ID_PATTERN = /^[1-9]\d*$/;

/**
 * 校验 GET /users/{id} 的 id 路径参数。
 * @api §5.2 #46
 * @returns 去空白后的 id 字符串
 * @throws BusinessError(9001) 非法输入
 */
export function validateUserIdParam(id: unknown): string {
  if (typeof id !== 'string' || !USER_ID_PATTERN.test(id.trim())) {
    throw new BusinessError(ERROR_CODES.PARAM_VALIDATION_FAILED, '用户 id 非法');
  }
  return id.trim();
}
