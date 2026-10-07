/**
 * components/mark-sold-modal —— 标记已售弹窗（U13）。
 * F7：标记已售必须指定买家；确认按钮在未选择买家时拦截提示「必须指定买家」。
 * 确认后触发 select 事件回传选中 buyer；取消触发 cancel 事件。
 * @module PIM-BC-02 商品与交易
 */
import { BuyerCandidate } from '../../services/api/product';

Component({
  properties: {
    /** 是否展示弹窗 */
    visible: {
      type: Boolean,
      value: false,
    },
    /** 买家候选列表（由 U12 通过 getBuyerCandidates 载入） */
    buyers: {
      type: Array,
      value: [] as BuyerCandidate[],
    },
  },
  data: {
    selectedId: 0,
  },
  methods: {
    onSelectBuyer(e: WechatMiniprogram.BaseEvent) {
      const { id } = e.currentTarget.dataset as { id: number };
      this.setData({ selectedId: id });
    },

    /** 确认：未选择买家时拦截（F7-AC3） */
    onConfirm() {
      const buyers = this.data.buyers as BuyerCandidate[];
      const buyer = buyers.find((b) => b.id === this.data.selectedId);
      if (!buyer) {
        wx.showToast({ title: '必须指定买家', icon: 'none' });
        return;
      }
      this.triggerEvent('select', { buyer });
      this.setData({ selectedId: 0 });
    },

    onCancel() {
      this.setData({ selectedId: 0 });
      this.triggerEvent('cancel');
    },

    /** 阻止冒泡，点遮罩关闭、点面板不关闭 */
    noop() {},
  },
});
