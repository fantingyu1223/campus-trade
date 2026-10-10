/**
 * infra/uploads/uploads.controller.ts —— 图片上传端点（纯技术设施，归 infra 层）。
 *
 * @module PIM-C-3 技术设施（COS 未开通前的本地存储占位，与 /static 映射配套）
 * @api §5.2 扩展占位：POST /uploads（multipart/form-data，字段名 file）
 *
 * 口径：
 *  - 存储：multer diskStorage → server/public/uploads/（main.ts /static/* 映射
 *    server/public/*，故落盘文件天然经 /static/uploads/<filename> 可访问）；
 *  - 文件名：crypto 随机 hex + 白名单扩展名（不保留原始文件名，防路径注入/覆盖）；
 *  - 白名单：jpg/jpeg/png/webp；大小 ≤5MB（超限由 multer LIMIT_FILE_SIZE → 413）；
 *  - 需登录（JwtAuthGuard）；响应统一包络 {code:0,data:{url:'/static/uploads/xxx'}}。
 *  - multer 类型声明见 src/types/multer.d.ts（下方 reference 为 ts-node 直跑按文件编译所需）。
 */
/// <reference path="../../types/multer.d.ts" />
import {
  Controller,
  Post,
  Req,
  UploadedFile,
  UseGuards,
  UseInterceptors,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { randomBytes } from 'node:crypto';
import { existsSync, mkdirSync } from 'node:fs';
import { extname, join } from 'node:path';
import { diskStorage } from 'multer';
import { ERROR_CODES } from '@contract/index';
import { JwtAuthGuard } from '@infra/auth/jwt.guard';

/** 业务错误（code/message，由全局过滤器翻译为统一响应包络） */
export class BusinessError extends Error {
  constructor(
    public readonly code: number,
    message: string,
  ) {
    super(message);
    this.name = 'BusinessError';
  }
}

/** 扩展名白名单（小写，含点前缀） */
export const ALLOWED_IMAGE_EXTS: readonly string[] = ['.jpg', '.jpeg', '.png', '.webp'];

/** 单文件大小上限：5MB */
export const MAX_FILE_SIZE_BYTES = 5 * 1024 * 1024;

/** 落盘目录：server/public/uploads/（相对 main.ts 的 /static 映射根） */
export const UPLOAD_DIR = join(__dirname, '..', '..', '..', 'public', 'uploads');

/** 扩展名白名单校验（原始文件名取小写扩展名比对） */
export function isAllowedImageExt(originalName: string): boolean {
  return ALLOWED_IMAGE_EXTS.includes(extname(originalName || '').toLowerCase());
}

/** 存储文件名：crypto 随机 hex + 白名单扩展名（原始文件名不入库，防路径注入） */
export function buildStoredFilename(originalName: string, randomHex: string): string {
  return `${randomHex}${extname(originalName || '').toLowerCase()}`;
}

/** multer fileFilter：非白名单扩展名 → BusinessError(9001)（经全局过滤器包络） */
const imageFileFilter = (
  _req: unknown,
  file: { originalname: string },
  cb: (err: Error | null, acceptFile: boolean) => void,
): void => {
  if (!isAllowedImageExt(file.originalname)) {
    cb(
      new BusinessError(
        ERROR_CODES.PARAM_VALIDATION_FAILED,
        `仅支持图片格式：${ALLOWED_IMAGE_EXTS.map((e) => e.slice(1)).join('/')}`,
      ),
      false,
    );
    return;
  }
  cb(null, true);
};

interface ApiResponse<T> {
  code: number;
  message: string;
  data: T;
}

/** 认证上下文（JwtAuthGuard 注入 req.user；uid 缺失 → 1001） */
interface AuthedRequest {
  user?: { uid?: string; id?: string };
}

export interface UploadResult {
  url: string;
}

@Controller('uploads')
@UseGuards(JwtAuthGuard)
export class UploadsController {
  /**
   * @api §5.2 扩展占位：POST /uploads（multipart 字段名 file）
   * 成功返回 {url:'/static/uploads/<filename>'}（前端展示时拼 STATIC_BASE）。
   */
  @Post()
  @UseInterceptors(
    FileInterceptor('file', {
      storage: diskStorage({
        destination: (_req, _file, cb) => {
          // 目录不存在则创建（首次上传场景）
          if (!existsSync(UPLOAD_DIR)) {
            mkdirSync(UPLOAD_DIR, { recursive: true });
          }
          cb(null, UPLOAD_DIR);
        },
        filename: (_req, file, cb) => {
          cb(null, buildStoredFilename(file.originalname, randomBytes(16).toString('hex')));
        },
      }),
      limits: { fileSize: MAX_FILE_SIZE_BYTES },
      fileFilter: imageFileFilter,
    }),
  )
  upload(
    @UploadedFile() file: { filename: string } | undefined,
    @Req() req: AuthedRequest,
  ): ApiResponse<UploadResult> {
    if (!req.user?.uid && !req.user?.id) {
      throw new BusinessError(ERROR_CODES.AUTH_TOKEN_INVALID, '未登录或登录已过期');
    }
    if (!file) {
      throw new BusinessError(ERROR_CODES.PARAM_VALIDATION_FAILED, '缺少上传文件（字段名 file）');
    }
    return { code: 0, message: 'ok', data: { url: `/static/uploads/${file.filename}` } };
  }
}
