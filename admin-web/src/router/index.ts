/**
 * 后台路由表。
 * @page A5 高校名单配置（/school 名单、/school/join-requests 加入申请）
 * @page A2/A3/A4/A7 治理（举报队列/举报处置/商家审核/黄牛复核）
 * @page A6/A8/A9 治理扩展（账号管理/申诉仲裁/词表配置）
 * @page 登录页 /login（@api §5.3 #51，meta.public 免鉴权）
 */
import { createRouter, createWebHistory } from 'vue-router';
import type { RouteRecordRaw } from 'vue-router';

const routes: RouteRecordRaw[] = [
  { path: '/', redirect: '/school' },
  {
    path: '/login',
    name: 'Login',
    component: () => import('../views/Login.vue'),
    meta: { title: '登录', public: true },
  },
  {
    path: '/school',
    name: 'SchoolList',
    component: () => import('../views/school/SchoolList.vue'),
    meta: { title: '高校名单配置', group: '平台配置' },
  },
  {
    path: '/school/join-requests',
    name: 'SchoolJoinRequests',
    component: () => import('../views/school/SchoolJoinRequests.vue'),
    meta: { title: '加入申请审批', group: '平台配置' },
  },
  {
    path: '/governance/reports',
    name: 'ReportQueue',
    component: () => import('../views/governance/ReportQueue.vue'),
    meta: { title: '举报队列', group: '治理' },
  },
  {
    path: '/governance/reports/:id',
    name: 'ReportDisposal',
    component: () => import('../views/governance/ReportDisposal.vue'),
    meta: { title: '举报处置', group: '治理' },
  },
  {
    path: '/governance/merchant-reviews',
    name: 'MerchantReview',
    component: () => import('../views/governance/MerchantReview.vue'),
    meta: { title: '商家审核', group: '治理' },
  },
  {
    path: '/governance/risk-warnings',
    name: 'RiskReview',
    component: () => import('../views/governance/RiskReview.vue'),
    meta: { title: '黄牛复核', group: '治理' },
  },
  {
    path: '/governance/appeals',
    name: 'AppealArbitration',
    component: () => import('../views/governance/AppealArbitration.vue'),
    meta: { title: '申诉仲裁', group: '治理' },
  },
  {
    path: '/governance/word-list',
    name: 'WordListConfig',
    component: () => import('../views/governance/WordListConfig.vue'),
    meta: { title: '词表配置', group: '治理' },
  },
  {
    path: '/governance/accounts',
    name: 'AccountManage',
    component: () => import('../views/governance/AccountManage.vue'),
    meta: { title: '账号管理', group: '治理' },
  },
];

export const router = createRouter({
  history: createWebHistory(),
  routes,
});

/**
 * 导航守卫（@module PIM-BC-05 / @api §5.3 #51）：
 * - 无 token 访问受保护页 → 跳 /login（携带 redirect 以便登录后回跳）；
 * - 已登录访问 /login → 跳主页；
 * - token 读取沿用 localStorage('admin_token') 约定。
 */
router.beforeEach((to) => {
  const token = localStorage.getItem('admin_token');
  if (to.meta.public) {
    return token ? '/' : true;
  }
  return token ? true : { path: '/login', query: { redirect: to.fullPath } };
});

export default router;
