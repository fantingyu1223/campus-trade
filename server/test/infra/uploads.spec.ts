/**
 * uploads.spec.ts —— 图片上传端点（infra/uploads/uploads.controller.ts）
 *
 * @module PIM-C-3 技术设施
 * @api §5.2 扩展占位：POST /uploads（multipart 字段名 file）
 *
 * 覆盖：
 *  - 扩展名白名单：jpg/jpeg/png/webp 放行（大小写不敏感），其余拦截；
 *  - 存储文件名：crypto 随机 hex + 白名单扩展名（原始文件名不保留，防路径注入）；
 *  - 大小上限常量 5MB（超限由 multer LIMIT_FILE_SIZE → 413，此处断言配置值）；
 *  - 控制器响应包络 {code:0,data:{url:'/static/uploads/<filename>'}}；
 *    缺文件 → 9001；未登录（req.user 缺失）→ 1001。
 *
 * 不落真实磁盘：直接构造 mock 文件对象调控制器方法，白名单/文件名走纯函数断言。
 */
import { ERROR_CODES } from '@contract/index';
import {
  ALLOWED_IMAGE_EXTS,
  MAX_FILE_SIZE_BYTES,
  UploadsController,
  buildStoredFilename,
  isAllowedImageExt,
} from '../../src/infra/uploads/uploads.controller';

describe('isAllowedImageExt（扩展名白名单）', () => {
  it.each(['a.jpg', 'b.JPEG', 'c.png', 'd.webp', '目录/子目录/e.PNG'])(
    '白名单内 %j → 放行（大小写不敏感）',
    (name) => {
      expect(isAllowedImageExt(name)).toBe(true);
    },
  );

  it.each(['a.gif', 'b.txt', 'c.svg', 'd', 'e.exe.png.exe', ''])(
    '白名单外 %j → 拦截',
    (name) => {
      expect(isAllowedImageExt(name)).toBe(false);
    },
  );

  it('白名单恰好为 jpg/jpeg/png/webp 四项', () => {
    expect(ALLOWED_IMAGE_EXTS).toEqual(['.jpg', '.jpeg', '.png', '.webp']);
  });
});

describe('buildStoredFilename（随机文件名生成）', () => {
  it('随机 hex + 小写扩展名，不保留原始文件名（防路径注入/覆盖）', () => {
    const name = buildStoredFilename('../../etc/头像.PNG', 'ab12cd');
    expect(name).toBe('ab12cd.png');
    expect(name).not.toContain('头像');
  });

  it('同名文件两次生成不冲突（随机部分不同）', () => {
    const a = buildStoredFilename('x.jpg', 'aa');
    const b = buildStoredFilename('x.jpg', 'bb');
    expect(a).not.toBe(b);
    expect(a.endsWith('.jpg') && b.endsWith('.jpg')).toBe(true);
  });
});

describe('上传限制配置', () => {
  it('大小上限为 5MB（超限由 multer 拦截 → 413）', () => {
    expect(MAX_FILE_SIZE_BYTES).toBe(5 * 1024 * 1024);
  });
});

describe('UploadsController.upload（统一响应包络 §5.1）', () => {
  const controller = new UploadsController();

  it('正常保存：data.url 为 /static/uploads/<filename>', () => {
    const res = controller.upload(
      { filename: 'ab12cd.png' },
      { user: { uid: '1', id: '1' } },
    );
    expect(res).toEqual({
      code: 0,
      message: 'ok',
      data: { url: '/static/uploads/ab12cd.png' },
    });
  });

  it('缺文件（fileFilter 拦截或字段名错误）→ 9001', () => {
    try {
      controller.upload(undefined, { user: { uid: '1' } });
      fail('应当抛出 9001');
    } catch (e) {
      expect((e as { code: number }).code).toBe(ERROR_CODES.PARAM_VALIDATION_FAILED);
    }
  });

  it('未登录（req.user 缺失）→ 1001', () => {
    try {
      controller.upload({ filename: 'a.png' }, {});
      fail('应当抛出 1001');
    } catch (e) {
      expect((e as { code: number }).code).toBe(ERROR_CODES.AUTH_TOKEN_INVALID);
    }
  });
});
