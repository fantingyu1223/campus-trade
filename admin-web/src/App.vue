<template>
  <!-- 登录页裸布局（无侧边栏/顶栏） -->
  <router-view v-if="isLoginPage" />
  <el-container v-else class="app-shell">
    <el-aside width="220px" class="app-aside">
      <div class="app-title">校园二手平台 · 管理端</div>
      <el-menu :default-active="$route.path" router>
        <el-sub-menu index="platform-config">
          <template #title>平台配置</template>
          <!-- A5 高校名单配置（F36） -->
          <el-menu-item index="/school">高校名单</el-menu-item>
          <el-menu-item index="/school/join-requests">加入申请审批</el-menu-item>
        </el-sub-menu>
        <el-sub-menu index="governance">
          <template #title>治理</template>
          <!-- A2 举报队列（F20）/ A4 商家审核（F32）/ A7 黄牛复核（F23） -->
          <el-menu-item index="/governance/reports">举报队列</el-menu-item>
          <el-menu-item index="/governance/merchant-reviews">商家审核</el-menu-item>
          <el-menu-item index="/governance/risk-warnings">黄牛复核</el-menu-item>
          <!-- A8 申诉仲裁（F30/F31）/ A9 词表配置 / A6 账号管理 -->
          <el-menu-item index="/governance/appeals">申诉仲裁</el-menu-item>
          <el-menu-item index="/governance/word-list">词表配置</el-menu-item>
          <el-menu-item index="/governance/accounts">账号管理</el-menu-item>
        </el-sub-menu>
      </el-menu>
    </el-aside>
    <el-container>
      <el-header class="app-header" height="56px">
        <el-breadcrumb separator="/">
          <el-breadcrumb-item>{{ $route.meta.group ?? '平台配置' }}</el-breadcrumb-item>
          <el-breadcrumb-item>{{ $route.meta.title }}</el-breadcrumb-item>
        </el-breadcrumb>
        <div class="header-right">
          <span v-if="roleLabel()" class="role-tag">{{ roleLabel() }}</span>
          <el-button link type="danger" @click="onLogout">退出登录</el-button>
        </div>
      </el-header>
      <el-main>
        <router-view />
      </el-main>
    </el-container>
  </el-container>
</template>

<script setup lang="ts">
/**
 * @module PIM-BC-05
 * 登录页裸布局切换 + 顶部退出登录。
 * 退出仅清本地 token（#52 refresh / #53 logout 后端未实现，见 api/auth.ts 偏差说明 2）。
 */
import { computed } from 'vue';
import { useRoute, useRouter } from 'vue-router';
import { ElMessageBox } from 'element-plus';
import { ADMIN_TOKEN_KEY } from './api/auth';

const route = useRoute();
const router = useRouter();

const isLoginPage = computed(() => route.path === '/login');
// localStorage 非响应式，模板随路由切换重渲染时读取即可
const roleLabel = () => localStorage.getItem('admin_role') ?? '';

async function onLogout() {
  try {
    await ElMessageBox.confirm('确认退出登录？', '退出登录', { type: 'warning' });
  } catch {
    return; // 取消
  }
  localStorage.removeItem(ADMIN_TOKEN_KEY);
  localStorage.removeItem('admin_role');
  await router.replace('/login');
}
</script>

<style scoped>
.app-shell {
  min-height: 100vh;
  font-family: -apple-system, 'PingFang SC', 'Microsoft YaHei', sans-serif;
}
.app-aside {
  border-right: 1px solid var(--el-border-color);
}
.app-title {
  padding: 16px;
  font-weight: 600;
  font-size: 15px;
}
.app-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  border-bottom: 1px solid var(--el-border-color);
}
.header-right {
  display: flex;
  align-items: center;
  gap: 12px;
}
.role-tag {
  color: var(--el-text-color-secondary);
  font-size: 13px;
}
</style>
