/**
 * @page U4 认证结果页（告知认证结果）
 * @ac F1-AC1（认证通过后获得发布/会话/交易权限） / F36-AC1（名单外驳回可重新申请）
 * @module PIM-BC-01 用户与认证
 * 关键元素：通过/失败状态、失败原因与重试入口；另含 pending 审核中三态展示。
 */
import { getVerifyStatus } from '../../services/api/auth';
import { saveUser, getUser } from '../../utils/session';

type VerifyStatus = 'none' | 'pending' | 'approved' | 'rejected';

Page({
  data: {
    status: 'none' as VerifyStatus,
    rejectReason: '',
    loading: true,
    error: '',
  },

  onLoad(options: { status?: string }) {
    // 提交后带参直达时可先展示对应态，onShow 仍会拉取最新状态
    if (options.status && ['pending', 'approved', 'rejected'].includes(options.status)) {
      this.setData({ status: options.status as VerifyStatus });
    }
  },

  onShow() {
    this.fetchStatus();
  },

  /** §5.2 #4 GET /auth/verify/status */
  fetchStatus() {
    this.setData({ loading: true, error: '' });
    getVerifyStatus()
      .then((res) => {
        this.setData({
          status: res.status,
          rejectReason: res.reject_reason || '',
          loading: false,
        });
        // 认证通过：回写本地用户快照 verified
        if (res.status === 'approved') {
          const user = getUser();
          if (user) saveUser({ ...user, verified: true });
        }
      })
      .catch((err: Error) => {
        this.setData({ loading: false, error: err.message || '状态查询失败' });
      });
  },

  /** 重试 / 重新认证：回 U3 认证页 */
  onRetry() {
    wx.redirectTo({ url: '/pages/verify/verify' });
  },

  /** 认证通过：进入首页 */
  onGoHome() {
    wx.reLaunch({ url: '/pages/index/index' });
  },
});
