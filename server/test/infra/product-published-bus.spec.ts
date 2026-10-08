/**
 * product-published-bus.spec.ts —— 商品上架事件总线（infra/product-events）
 *
 * @event PIM-EV-11 求购撮合命中（触发源分发设施）
 *
 * 覆盖：
 *  - emit 按订阅序分发载荷；
 *  - 单 handler 抛错不阻断后续 handler 且不向调用方抛错（发布主流程不回溯）；
 *  - subscribe 返回的取消函数生效（测试隔离）。
 */
import {
  ProductPublishedBus,
  ProductPublishedPayload,
} from '../../src/infra/product-events/product-published.bus';

const PAYLOAD: ProductPublishedPayload = {
  id: '100',
  category_id: '10',
  title: '高等数学（下册）',
  price: '25.00',
};

describe('ProductPublishedBus（@event PIM-EV-11 触发源分发，infra 进程内总线）', () => {
  it('emit 将载荷分发给全部订阅者', async () => {
    const received: ProductPublishedPayload[] = [];
    const off1 = ProductPublishedBus.subscribe((p) => received.push(p));
    const off2 = ProductPublishedBus.subscribe((p) => received.push(p));
    try {
      await ProductPublishedBus.emit(PAYLOAD);
      expect(received).toEqual([PAYLOAD, PAYLOAD]);
    } finally {
      off1();
      off2();
    }
  });

  it('单 handler 抛错：记录但不阻断后续 handler，emit 本身不抛错', async () => {
    const after = jest.fn();
    const errSpy = jest.spyOn(console, 'error').mockImplementation(() => undefined);
    const off1 = ProductPublishedBus.subscribe(() => {
      throw new Error('下游撮合失败');
    });
    const off2 = ProductPublishedBus.subscribe(after);
    try {
      await expect(ProductPublishedBus.emit(PAYLOAD)).resolves.toBeUndefined();
      expect(after).toHaveBeenCalledWith(PAYLOAD);
      expect(errSpy).toHaveBeenCalled();
    } finally {
      off1();
      off2();
      errSpy.mockRestore();
    }
  });

  it('取消订阅后不再接收事件', async () => {
    const handler = jest.fn();
    const off = ProductPublishedBus.subscribe(handler);
    off();
    await ProductPublishedBus.emit(PAYLOAD);
    expect(handler).not.toHaveBeenCalled();
  });
});
