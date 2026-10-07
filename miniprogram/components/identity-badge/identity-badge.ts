/**
 * components/identity-badge —— 用户身份标识。
 * 按 UserIdentityType（types/contract.ts）展示：学生 / 教职工 / 认证商家；
 * guest 不展示。认证商家标识需与个人闲置视觉可区分（F33-AC1 全链路亮标）。
 * @module PIM-BC-01 用户与认证
 */
import { UserIdentityType } from '../../types/contract';

const LABEL_MAP: Record<string, string> = {
  [UserIdentityType.STUDENT]: '学生',
  [UserIdentityType.STAFF]: '教职工',
  [UserIdentityType.MERCHANT]: '认证商家',
};

Component({
  properties: {
    /** 身份类型：guest/student/staff/merchant */
    identityType: {
      type: String,
      value: 'guest',
    },
  },
  data: {
    label: '',
    isMerchant: false,
  },
  observers: {
    identityType(type: string) {
      this.setData({
        label: LABEL_MAP[type] || '',
        isMerchant: type === UserIdentityType.MERCHANT,
      });
    },
  },
});
