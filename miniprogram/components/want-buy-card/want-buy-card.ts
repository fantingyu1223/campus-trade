/**
 * components/want-buy-card —— 求购卡片（U19 列表项，F9）。
 * 展示品类 / 标题 / 预期价位区间 / 成色 / 到期倒计时（剩余 ≤3 天红色「即将到期」）；
 * isMine 且 status==='active' 时展示操作：续期 / 关闭 / 已买到（终态后条目置灰、不再显示操作）。
 * 操作以事件形式抛出（renew/close/bought，detail={id}），由页面确认后调 §5.2 #21-23。
 * @module PIM-BC-02 求购与撮合
 */
import { WantBuyItem } from '../../services/api/wantbuy';

const DAY_MS = 24 * 60 * 60 * 1000;

Component({
  properties: {
    /** 求购条目（§5.2 #24 列表项结构） */
    item: {
      type: Object,
      value: {} as WantBuyItem,
    },
    /** 是否本人发布（本人且生效中才展示操作区） */
    isMine: {
      type: Boolean,
      value: false,
    },
  },
  data: {
    /** 剩余天数（由 expire_at 计算，≤0 视为已到期） */
    daysLeft: 0,
    /** 剩余 ≤3 天：红色「即将到期」 */
    expiring: false,
  },
  observers: {
    'item.expire_at'(expireAt: string) {
      if (!expireAt) {
        this.setData({ daysLeft: 0, expiring: false });
        return;
      }
      const diff = new Date(expireAt.replace(/-/g, '/')).getTime() - Date.now();
      const daysLeft = Math.max(0, Math.ceil(diff / DAY_MS));
      this.setData({ daysLeft, expiring: daysLeft > 0 && daysLeft <= 3 });
    },
  },
  methods: {
    onRenew() {
      this.triggerEvent('renew', { id: this.data.item.id });
    },
    onClose() {
      this.triggerEvent('close', { id: this.data.item.id });
    },
    onBought() {
      this.triggerEvent('bought', { id: this.data.item.id });
    },
  },
});
