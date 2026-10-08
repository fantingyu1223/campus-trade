/**
 * @page U24 我的页面（用户信息卡 + 功能列表 + 设置区 + 账号与安全/注销账号）
 * @ac F26-AC1（注销账号：红色入口唤起二次确认弹窗，输入「注销」方可提交；
 *      存在在途交易被拦截并 toast 提示）
 *     F33-AC1（identity_type === 'merchant' 时额外展示 merchant-badge 强化亮标）
 * @module PIM-BC-01 用户与认证
 * 接口：§5.2 #2 GET /auth/me（用户信息）、#50（services/api/account.ts cancelAccount）。
 * 设置区：资料编辑（pages/profile-edit）/ 退出登录；用户卡展示 bio 与匿名态（N6）。
 */
import { cancelAccount } from '../../services/api/account';
import { getMe } from '../../services/api/auth';
import { isLoggedIn, getUser, clearSession, SessionUser } from '../../utils/session';
import { UserIdentityType } from '../../types/contract';
import { STATIC_BASE } from '../../config';

/** tabBar 页面清单（navigateTo 不可跳 tabBar 页，须 switchTab） */
const TAB_PAGES = ['/pages/want-buy/want-buy'];

Page({
  data: {
    loggedIn: false,
    /** 用户信息（/auth/me；role 即 identity_type） */
    user: {
      nickname: '',
      avatar: '',
      bio: '',
      is_anonymous: false,
      identity_type: UserIdentityType.GUEST as string,
    },
    isMerchant: false,
    modalVisible: false,
    confirming: false,
    /** 注销成功后的终态页 */
    cancelled: false,
    effectiveAt: '',
  },

  onShow() {
    if (!isLoggedIn()) {
      this.setData({ loggedIn: false });
      return;
    }
    const cached = getUser();
    if (cached) this.applyUser(cached);
    getMe()
      .then((me) => this.applyUser(me as unknown as SessionUser & { role: string }))
      .catch(() => {});
  },

  applyUser(me: { nickname?: string; avatar?: string; bio?: string; is_anonymous?: boolean; role?: string }) {
    const identityType = me.role || UserIdentityType.GUEST;
    const isAnonymous = me.is_anonymous === true;
    const rawAvatar = me.avatar || '';
    this.setData({
      loggedIn: true,
      user: {
        // N6 匿名态：本人视角同样提示匿名展示效果
        nickname: isAnonymous ? '匿名用户' : (me.nickname || '未设置昵称'),
        avatar: isAnonymous ? '' : (rawAvatar.startsWith('/static/') ? `${STATIC_BASE}${rawAvatar}` : rawAvatar),
        bio: me.bio || '',
        is_anonymous: isAnonymous,
        identity_type: identityType,
      },
      isMerchant: identityType === UserIdentityType.MERCHANT,
    });
  },

  /** 未登录态：去登录页 */
  onGotoLogin() {
    wx.navigateTo({ url: '/pages/login/login' });
  },

  /** 设置区：资料编辑 */
  onGotoProfileEdit() {
    wx.navigateTo({ url: '/pages/profile-edit/profile-edit' });
  },

  /** 设置区：退出登录（清除本地登录态并回登录页） */
  onLogout() {
    clearSession();
    wx.reLaunch({ url: '/pages/login/login' });
  },

  /** 功能列表跳转（未登录先登录） */
  onNav(e: WechatMiniprogram.BaseEvent) {
    const { url } = e.currentTarget.dataset as { url: string };
    if (!isLoggedIn()) {
      wx.navigateTo({ url: '/pages/login/login' });
      return;
    }
    if (TAB_PAGES.includes(url)) {
      wx.switchTab({ url });
      return;
    }
    wx.navigateTo({ url });
  },

  /** 唤起注销二次确认弹窗 */
  onCancelAccountTap() {
    this.setData({ modalVisible: true });
  },

  onModalCancel() {
    this.setData({ modalVisible: false });
  },

  /** 弹窗 confirm（已输入「注销」）：接口 #50 */
  onModalConfirm() {
    if (this.data.confirming) return;
    this.setData({ confirming: true });

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
});
