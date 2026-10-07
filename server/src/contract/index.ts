// ★ 契约层（docs/design §3.3）：DTO + 枚举 + 错误码常量的唯一事实源。
// 仅限声明（类型/常量），禁止在此层写任何逻辑函数。
// 前端 admin-web/src/types/contract.ts 与 miniprogram/types/contract.ts 直接拷贝同步，
// 一致性由 test/contract/contract-sync.spec.ts 强制校验。
export * from './enums';
export * from './dto';
export * from './error-codes';
