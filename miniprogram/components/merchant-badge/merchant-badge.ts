/**
 * @component components/merchant-badge —— 「认证商家」强化标识（图标 + 文字）。
 * @ac F33-AC1（认证商家全链路亮标：与个人闲置视觉强区分，金色边框 + 图标，
 *      比 identity-badge 的商家态更醒目，用于我的页面/商品详情等强展示位）
 * @module PIM-BC-01 用户与认证
 * 使用：仅当用户 identity_type === 'merchant' 时展示；与 identity-badge 并存（后者轻量、本组件强化）。
 */
Component({
  properties: {
    /** 尺寸：normal（默认） / large（详情页等强展示位） */
    size: { type: String, value: 'normal' },
  },
});
