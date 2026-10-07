<template>
  <div class="login-page">
    <el-card class="login-card" shadow="always">
      <div class="login-title">校园二手平台 · 管理端登录</div>
      <el-form
        ref="formRef"
        :model="form"
        :rules="rules"
        label-position="top"
        size="large"
        @submit.prevent
      >
        <el-form-item label="账号" prop="username">
          <el-input v-model="form.username" placeholder="请输入管理员账号" autocomplete="username" />
        </el-form-item>
        <el-form-item label="密码" prop="password">
          <el-input
            v-model="form.password"
            type="password"
            placeholder="请输入密码"
            show-password
            autocomplete="current-password"
            @keyup.enter="onSubmit"
          />
        </el-form-item>
        <!-- 错误态：后端 envelope.message 直接展示（1001 凭据错误 / 1003 账号停用） -->
        <el-alert
          v-if="errorMsg"
          :title="errorMsg"
          type="error"
          :closable="false"
          class="login-error"
        />
        <el-button
          type="primary"
          class="login-btn"
          :loading="loading"
          :disabled="loading"
          @click="onSubmit"
        >
          {{ loading ? '登录中…' : '登 录' }}
        </el-button>
      </el-form>
    </el-card>
  </div>
</template>

<script setup lang="ts">
/**
 * @module PIM-BC-05
 * @api §5.3 #51 POST /admin/v1/auth/login
 *
 * 后台登录页：账号+密码表单 → 成功存 localStorage('admin_token') 并跳回目标页；
 * 失败展示后端错误信息。路由守卫见 router/index.ts（无 token 跳 /login，已登录访问 /login 跳主页）。
 */
import { reactive, ref } from 'vue';
import { useRoute, useRouter } from 'vue-router';
import type { FormInstance, FormRules } from 'element-plus';
import { ElMessage } from 'element-plus';
import { adminLogin, ADMIN_TOKEN_KEY } from '../api/auth';

const route = useRoute();
const router = useRouter();

const formRef = ref<FormInstance>();
const form = reactive({ username: '', password: '' });
const loading = ref(false);
const errorMsg = ref('');

const rules: FormRules = {
  username: [{ required: true, message: '请输入账号', trigger: 'blur' }],
  password: [{ required: true, message: '请输入密码', trigger: 'blur' }],
};

async function onSubmit() {
  if (loading.value) return;
  const valid = await formRef.value?.validate().catch(() => false);
  if (!valid) return;
  loading.value = true;
  errorMsg.value = '';
  try {
    const data = await adminLogin({ username: form.username.trim(), password: form.password });
    // 键名沿用 admin_token，兼容既有 api 文件的 authHeaders 读取
    localStorage.setItem(ADMIN_TOKEN_KEY, data.access_token);
    const role = data.role ?? data.operator?.role;
    if (role) localStorage.setItem('admin_role', role);
    ElMessage.success('登录成功');
    const redirect = typeof route.query.redirect === 'string' ? route.query.redirect : '/';
    await router.replace(redirect);
  } catch (e) {
    // 错误态：1001 凭据错误 / 1003 账号停用等，message 由后端给出可直接展示
    errorMsg.value = e instanceof Error ? e.message : '登录失败，请稍后重试';
  } finally {
    loading.value = false;
  }
}
</script>

<style scoped>
.login-page {
  min-height: 100vh;
  display: flex;
  align-items: center;
  justify-content: center;
  background: var(--el-fill-color-light);
}
.login-card {
  width: 380px;
}
.login-title {
  text-align: center;
  font-size: 18px;
  font-weight: 600;
  margin-bottom: 24px;
}
.login-error {
  margin-bottom: 18px;
}
.login-btn {
  width: 100%;
}
</style>
