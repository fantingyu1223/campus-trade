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

/** nickname 长度上限（user.nickname VARCHAR(64)） */
const NICKNAME_MAX = 64;
/** bio 长度上限（user.bio VARCHAR(500)） */
const BIO_MAX = 500;
/** avatar_url 长度上限（user.avatar_url VARCHAR(512)） */
const AVATAR_URL_MAX = 512;
/** 头像 URL 白名单前缀：本地 /static/ 占位 或 http(s) 外链（COS 未开通前的双通道口径） */
const AVATAR_URL_PREFIXES = ['/static/', 'http'];

/**
 * 校验 PATCH /users/me 请求体（资料编辑）。
 * @api 补充接口 PATCH /users/me
 * 口径：四字段全可选但至少提供一项（空 body → 9001）；逐项类型/长度/前缀校验，
 * 非法即抛 9001；通过项原样返回（trim 仅用于空串判定，不改写用户输入）。
 * @throws BusinessError(9001) 空 body 或任一字段非法
 */
export function validateUpdateProfileFields(raw: unknown): {
  nickname?: string;
  bio?: string;
  avatarUrl?: string;
  isAnonymous?: boolean;
} {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) {
    throw new BusinessError(ERROR_CODES.PARAM_VALIDATION_FAILED, '缺少必填字段：请求体');
  }
  const body = raw as Record<string, unknown>;
  const provided = ['nickname', 'bio', 'avatar_url', 'is_anonymous'].filter(
    (k) => body[k] !== undefined,
  );
  if (provided.length === 0) {
    throw new BusinessError(
      ERROR_CODES.PARAM_VALIDATION_FAILED,
      '缺少必填字段：nickname/bio/avatar_url/is_anonymous 至少一项',
    );
  }

  const out: { nickname?: string; bio?: string; avatarUrl?: string; isAnonymous?: boolean } = {};

  if (body.nickname !== undefined) {
    if (typeof body.nickname !== 'string' || body.nickname.length > NICKNAME_MAX) {
      throw new BusinessError(ERROR_CODES.PARAM_VALIDATION_FAILED, `nickname 须为不超过 ${NICKNAME_MAX} 字符的字符串`);
    }
    out.nickname = body.nickname;
  }
  if (body.bio !== undefined) {
    if (typeof body.bio !== 'string' || body.bio.length > BIO_MAX) {
      throw new BusinessError(ERROR_CODES.PARAM_VALIDATION_FAILED, `bio 须为不超过 ${BIO_MAX} 字符的字符串`);
    }
    out.bio = body.bio;
  }
  if (body.avatar_url !== undefined) {
    const avatarUrl = body.avatar_url;
    if (
      typeof avatarUrl !== 'string' ||
      avatarUrl.length > AVATAR_URL_MAX ||
      !AVATAR_URL_PREFIXES.some((p) => avatarUrl.startsWith(p))
    ) {
      throw new BusinessError(
        ERROR_CODES.PARAM_VALIDATION_FAILED,
        `avatar_url 须以 '/static/' 或 'http' 开头且不超过 ${AVATAR_URL_MAX} 字符`,
      );
    }
    out.avatarUrl = avatarUrl;
  }
  if (body.is_anonymous !== undefined) {
    if (typeof body.is_anonymous !== 'boolean') {
      throw new BusinessError(ERROR_CODES.PARAM_VALIDATION_FAILED, 'is_anonymous 须为布尔值');
    }
    out.isAnonymous = body.is_anonymous;
  }
  return out;
}
