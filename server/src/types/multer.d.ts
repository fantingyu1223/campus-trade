/**
 * multer.d.ts —— multer 最小类型声明（项目仅用 diskStorage，@types/multer 未引入）。
 *
 * @module PIM-C-3 技术设施（infra/uploads 上传端点配套）
 * 纪律：仅声明本项目用到的 diskStorage 入口与回调签名，非完整 multer 类型；
 * 若后续接入更多 multer 能力，再补全或改引 @types/multer。
 */
declare module 'multer' {
  /** 落盘回调（err 为 null 表示成功） */
  type DiskStorageCallback = (err: Error | null, result: string) => void;

  interface DiskStorageFile {
    originalname: string;
  }

  interface DiskStorageOptions {
    destination?: (req: unknown, file: DiskStorageFile, cb: DiskStorageCallback) => void;
    filename?: (req: unknown, file: DiskStorageFile, cb: DiskStorageCallback) => void;
  }

  /** 磁盘存储引擎（destination/filename 回调定制） */
  function diskStorage(options: DiskStorageOptions): unknown;
}
