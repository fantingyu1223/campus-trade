/**
 * infra/product-events/product-published.bus.ts —— 商品上架事件进程内总线（infra 共享设施）
 *
 * @event PIM-EV-11 求购撮合命中（触发源：商品发布成功落库）
 *
 * 背景：product 与 wantbuy 分属不同模块目录，§3.1 边界纪律禁止 modules 间直接
 * import；而「新上架商品触发求购撮合」（F9-AC1）需要跨模块联动，故在 infra 层
 * 提供最小 pub/sub：product 模块发布成功后 emit，wantbuy 模块在模块初始化时
 * subscribe（见 wantbuy.module.ts#onModuleInit）。
 *
 * 纪律：本总线只承载事件载荷声明与分发，不含任何业务规则；订阅方各自自含规则。
 */

/** 商品上架事件载荷（id/category_id 以 string 序列化，跨模块传输口径；price 为定点串） */
export interface ProductPublishedPayload {
  id: string;
  category_id: string;
  title: string;
  price: string;
}

export type ProductPublishedHandler = (
  payload: ProductPublishedPayload,
) => Promise<unknown> | unknown;

const handlers: ProductPublishedHandler[] = [];

export const ProductPublishedBus = {
  /** 订阅上架事件；返回取消订阅函数（测试隔离用） */
  subscribe(handler: ProductPublishedHandler): () => void {
    handlers.push(handler);
    return () => {
      const idx = handlers.indexOf(handler);
      if (idx >= 0) {
        handlers.splice(idx, 1);
      }
    };
  },

  /**
   * 分发上架事件：按订阅序逐个 await；单 handler 异常仅记录不阻断
   * （发布已落库，下游撮合/通知失败不回溯发布主流程）。
   */
  async emit(payload: ProductPublishedPayload): Promise<void> {
    for (const handler of [...handlers]) {
      try {
        await handler(payload);
      } catch (err) {
        console.error('[ProductPublishedBus] handler 执行失败：', err);
      }
    }
  },
};
