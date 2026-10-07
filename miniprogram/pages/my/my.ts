/**
 * @page U24 我的页面（用户信息卡 + 功能列表 + 账号与安全/注销账号）
 * @ac F26-AC1（注销账号：红色入口唤起二次确认弹窗，输入「注销」方可提交；
 *      存在在途交易被拦截并 toast 提示）
 *     F33-AC1（identity_type === 'merchant' 时额外展示 merchant-badge 强化亮标）
 * @module PIM-BC-01 用户与认证
 * 接口：§5.2 #50（services/api/account.ts cancelAccount）。
 * 接口未就绪：USE_MOCK=true 时走本地 Mock（按契约结构），就绪后置 false 切换。
 */
import { cancelAccount } from '../../services/api/account';
import { UserIdentityType } from '../../types/contract';

const USE_MOCK = true;

Page({
  data: {
    /** 用户信息（Mock；接口就绪后由 users/me 拉取） */
    user: {
      nickname: '王同学',
      avatar: '',
      identity_type: UserIdentityType.MERCHANT as string,
    },
    isMerchant: false,
    /**
     * 注销 Mock 分支开关：
     *  - false：注销成功 → 展示「已注销，感谢使用」态；
     *  - true：模拟存在在途交易（契约 4002）→ toast「存在未完成交易，请先完结后再注销」。
     * 联调时手工切换本值复测两个分支；接口就绪后删除。
     */
    mockBlocked: false,
    modalVisible: false,
    confirming: false,
    /** 注销成功后的终态页 */
    cancelled: false,
    effectiveAt: '',
  },

  onLoad() {
    this.setData({ isMerchant: this.data.user.identity_type === UserIdentityType.MERCHANT });
  },

  /** 功能列表跳转 */
  onNav(e: WechatMiniprogram.BaseEvent) {
    const { url } = e.currentTarget.dataset as { url: string };
    wx.navigateTo({ url });
  },

  /** 唤起注销二次确认弹窗 */
  onCancelAccountTap() {
    this.setData({ modalVisible: true });
  },

  onModalCancel() {
    this.setData({ modalVisible: false });
  },

  /** 弹窗 confirm（已输入「注销」）：Mock 两分支 / 接口 #50 */
  onModalConfirm() {
    if (this.data.confirming) return;
    this.setData({ confirming: true });

    if (USE_MOCK) {
      setTimeout(() => {
        this.setData({ confirming: false, modalVisible: false });
        if (this.data.mockBlocked) {
          // 在途交易拦截分支（契约 4002 ORDER_STATUS_CONFLICT）
          wx.showToast({ title: '存在未完成交易，请先完结后再注销', icon: 'none' });
          return;
        }
        this.setData({ cancelled: true, effectiveAt: '冷静期结束后生效' });
      }, 300);
      return;
    }

    cancelAccount({ confirm: true })
      .then((res) => {
        this.setData({
          confirming: false,
          modalVisible: false,
          cancelled: true,
          effectiveAt: res.effective_at,
        });
      })
      .catch((err: Error) => {
        this.setData({ confirming: false, modalVisible: false });
        wx.showToast({ title: err.message || '存在未完成交易，请先完结后再注销', icon: 'none' });
      });
  },

  /** 已注销态：回登录页 */
  onGotoLogin() {
    wx.reLaunch({ url: '/pages/login/login' });
  },
});
