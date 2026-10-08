/**
 * @page 资料编辑（我的页面设置区入口）
 * @module PIM-BC-01 用户与认证
 * 接口：PATCH /users/me（services/api/user.ts updateProfile）+ #2 GET /auth/me（预填）。
 * N6 匿名保护：开启匿名后其他用户在公开档案与商品卖家信息处看到「匿名用户」与默认头像。
 * 头像：6 张预置头像单选（存 '/static/avatar-N.png' 相对路径，展示拼 STATIC_BASE）；
 * 自定义上传待 COS 开通后接入。
 */
import { getMe } from '../../services/api/auth';
import { updateProfile } from '../../services/api/user';
import { getUser, saveUser } from '../../utils/session';
import { STATIC_BASE } from '../../config';

/** 预置头像（相对路径为存值；display 为展示 URL） */
const PRESET_AVATARS = [1, 2, 3, 4, 5, 6].map((n) => ({
  path: `/static/avatar-${n}.png`,
  display: `${STATIC_BASE}/static/avatar-${n}.png`,
}));

/** 展示态头像 URL：/static/ 相对路径拼 STATIC_BASE，http 外链原样 */
const toDisplayAvatar = (url: string): string =>
  url.startsWith('/static/') ? `${STATIC_BASE}${url}` : url;

/** 预填数据源（会话快照 或 /auth/me 响应的公共子集） */
interface PrefillMe {
  nickname?: string;
  bio?: string;
  avatar?: string;
  is_anonymous?: boolean;
}

Page({
  data: {
    nickname: '',
    bio: '',
    /** 存值：'/static/avatar-N.png' 或 http 外链（'' 表示未设置） */
    avatarUrl: '',
    /** 展示态头像 URL（相对路径已拼 STATIC_BASE） */
    avatarDisplay: '',
    isAnonymous: false,
    avatars: PRESET_AVATARS,
    saving: false,
  },

  onLoad() {
    // 先取会话快照秒填，再拉 /auth/me 校准
    const cached = getUser();
    if (cached) this.prefill(cached);
    getMe()
      .then((me) => this.prefill(me as unknown as PrefillMe))
      .catch(() => {});
  },

  prefill(me: PrefillMe) {
    const avatarUrl = me.avatar || '';
    this.setData({
      nickname: me.nickname || '',
      bio: me.bio || '',
      avatarUrl,
      avatarDisplay: toDisplayAvatar(avatarUrl),
      isAnonymous: me.is_anonymous === true,
    });
  },

  onNicknameInput(e: WechatMiniprogram.Input) {
    this.setData({ nickname: e.detail.value });
  },

  onBioInput(e: WechatMiniprogram.Input) {
    this.setData({ bio: e.detail.value });
  },

  onAvatarTap(e: WechatMiniprogram.BaseEvent) {
    const { path } = e.currentTarget.dataset as { path: string };
    this.setData({ avatarUrl: path, avatarDisplay: toDisplayAvatar(path) });
  },

  onAnonymousChange(e: WechatMiniprogram.SwitchChange) {
    this.setData({ isAnonymous: e.detail.value });
  },

  onSave() {
    if (this.data.saving) return;
    const nickname = this.data.nickname.trim();
    if (!nickname) {
      wx.showToast({ title: '请填写昵称', icon: 'none' });
      return;
    }
    this.setData({ saving: true });
    updateProfile({
      nickname,
      bio: this.data.bio.trim(),
      ...(this.data.avatarUrl ? { avatar_url: this.data.avatarUrl } : {}),
      is_anonymous: this.data.isAnonymous,
    })
      .then((profile) => {
        // 回写会话用户快照（我的页 onShow 优先读缓存）
        const cached = getUser();
        if (cached) {
          saveUser({
            ...cached,
            nickname: profile.nickname,
            avatar: profile.avatar,
            bio: profile.bio,
            is_anonymous: profile.is_anonymous,
          });
        }
        wx.showToast({ title: '已保存', icon: 'success' });
        setTimeout(() => wx.navigateBack(), 600);
      })
      .catch((err: Error) => {
        this.setData({ saving: false });
        wx.showToast({ title: err.message || '保存失败，请稍后重试', icon: 'none' });
      });
  },
});
