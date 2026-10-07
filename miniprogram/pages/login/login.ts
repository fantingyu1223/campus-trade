/**
 * @page U2 注册/登录页（微信授权登录）
 * @ac F1-AC1（登录后引导认证） / F36-AC1（名单外申请加入，承接 U3 跳转）
 * @module PIM-BC-01 用户与认证
 * 关键元素：微信授权按钮、用户协议与隐私政策勾选（未勾选拦截提示）。
 */
import { login } from '../../utils/session';

Page({
  data: {
    agreed: false,
    loading: false,
  },

  onAgreeChange(e: WechatMiniprogram.CheckboxGroupChange) {
    this.setData({ agreed: e.detail.value.length > 0 });
  },

  /** 协议/政策查看（正文页由后续任务提供，先占位提示） */
  onViewAgreement(e: WechatMiniprogram.BaseEvent) {
    const { type } = e.currentTarget.dataset as { type: string };
    wx.showToast({
      title: `${type === 'privacy' ? '隐私政策' : '用户协议'}详情待接入`,
      icon: 'none',
    });
  },

  /** 微信授权登录：未勾选协议先拦截 */
  onLogin() {
    if (!this.data.agreed) {
      wx.showToast({ title: '请先勾选并同意用户协议与隐私政策', icon: 'none' });
      return;
    }
    if (this.data.loading) return;
    this.setData({ loading: true });
    login()
      .then((user) => {
        wx.showToast({ title: '登录成功', icon: 'success' });
        // 未认证（verified=false）引导至 U3 认证页（F1-AC1）；已认证回首页
        setTimeout(() => {
          if (user.verified) {
            wx.reLaunch({ url: '/pages/index/index' });
          } else {
            wx.redirectTo({ url: '/pages/verify/verify' });
          }
        }, 600);
      })
      .catch((err: Error) => {
        wx.showToast({ title: err.message || '登录失败，请重试', icon: 'none' });
      })
      .finally(() => {
        this.setData({ loading: false });
      });
  },

  /** 游客模式：先逛逛（N1 浏览不受限） */
  onBrowseAsGuest() {
    wx.reLaunch({ url: '/pages/index/index' });
  },
});
