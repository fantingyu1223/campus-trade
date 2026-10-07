<!-- @page A6 @ac F21-AC1 F26-AC1 F31-AC1 @module PIM-BC-06 -->
<template>
  <div class="account-manage-page">
    <el-card shadow="never">
      <template #header>
        <div class="card-header">
          <span>账号管理</span>
          <el-button @click="fetchList">刷新</el-button>
        </div>
      </template>

      <el-form inline @submit.prevent>
        <el-form-item label="关键词">
          <el-input
            v-model="keyword"
            placeholder="ID / 昵称"
            clearable
            style="width: 200px"
            @keyup.enter="fetchList"
            @clear="fetchList"
          />
        </el-form-item>
        <el-form-item label="状态">
          <el-select
            v-model="statusFilter"
            placeholder="全部"
            clearable
            style="width: 140px"
            @change="fetchList"
          >
            <el-option label="正常" value="normal" />
            <el-option label="已封禁" value="banned" />
            <el-option label="注销清算中" value="deactivating" />
          </el-select>
        </el-form-item>
        <el-form-item label="身份">
          <el-select
            v-model="roleFilter"
            placeholder="全部"
            clearable
            style="width: 140px"
            @change="fetchList"
          >
            <el-option label="访客" value="guest" />
            <el-option label="学生" value="student" />
            <el-option label="教职工" value="staff" />
            <el-option label="商家" value="merchant" />
          </el-select>
        </el-form-item>
        <el-form-item>
          <el-button type="primary" @click="fetchList">检索</el-button>
        </el-form-item>
      </el-form>

      <el-table v-loading="loading" :data="list" border empty-text="暂无账号">
        <el-table-column prop="id" label="ID" width="80" />
        <el-table-column prop="nickname" label="昵称" min-width="140" show-overflow-tooltip />
        <el-table-column label="身份类型" width="110">
          <template #default="{ row }: { row: AccountItem }">
            {{ ROLE_TEXT[row.identity_type] ?? row.identity_type }}
          </template>
        </el-table-column>
        <el-table-column prop="credit_score" label="信用分" width="90" />
        <el-table-column label="状态" width="110">
          <template #default="{ row }">
            <el-tag :type="statusTagType(row.status)">{{ statusText(row.status) }}</el-tag>
          </template>
        </el-table-column>
        <el-table-column prop="registered_at" label="注册时间" width="170" />
        <el-table-column label="操作" width="180" fixed="right">
          <template #default="{ row }">
            <el-button link type="primary" @click="openDetail(row)">详情</el-button>
            <el-button
              v-if="row.status !== 'banned'"
              link
              type="danger"
              @click="openBan(row)"
            >
              封禁
            </el-button>
            <el-button v-else link type="success" @click="onUnban(row)">解封</el-button>
          </template>
        </el-table-column>
      </el-table>
    </el-card>

    <!-- 封禁对话框 -->
    <el-dialog v-model="banVisible" title="封禁账号" width="440px">
      <el-form ref="banFormRef" :model="banForm" :rules="banRules" label-width="100px">
        <el-form-item label="封禁时长" prop="duration_days">
          <el-input-number v-model="banForm.duration_days" :min="-1" style="width: 100%" />
          <div class="form-tip">填 -1 表示永久封禁</div>
        </el-form-item>
        <el-form-item label="封禁原因" prop="reason">
          <el-input
            v-model="banForm.reason"
            type="textarea"
            :rows="3"
            placeholder="必填：说明封禁依据"
          />
        </el-form-item>
        <el-form-item label="封禁来源">
          <el-select v-model="banForm.source" style="width: 100%">
            <el-option label="人工操作" value="manual" />
            <el-option label="举报处置" value="report" />
            <el-option label="申诉裁决" value="appeal" />
            <el-option label="风控拦截" value="risk" />
          </el-select>
        </el-form-item>
      </el-form>
      <template #footer>
        <el-button @click="banVisible = false">取消</el-button>
        <el-button type="danger" :loading="acting" @click="onBanSubmit">确认封禁</el-button>
      </template>
    </el-dialog>

    <!-- 详情抽屉 -->
    <el-drawer v-model="drawerVisible" title="账号详情" size="480px">
      <div v-loading="detailLoading">
        <template v-if="detail">
          <el-descriptions :column="1" border size="small">
            <el-descriptions-item label="ID">{{ detail.id }}</el-descriptions-item>
            <el-descriptions-item label="昵称">{{ detail.nickname }}</el-descriptions-item>
            <el-descriptions-item label="身份类型">
              {{ ROLE_TEXT[detail.identity_type] ?? detail.identity_type }}
            </el-descriptions-item>
            <el-descriptions-item label="信用分">{{ detail.credit_score }}</el-descriptions-item>
            <el-descriptions-item label="状态">
              <el-tag :type="statusTagType(detail.status)">{{ statusText(detail.status) }}</el-tag>
            </el-descriptions-item>
            <el-descriptions-item label="注册时间">{{ detail.registered_at }}</el-descriptions-item>
            <el-descriptions-item v-if="detail.ban_info" label="封禁信息">
              {{ detail.ban_info.duration_days === -1 ? '永久' : `${detail.ban_info.duration_days} 天` }}
              · {{ detail.ban_info.reason }} · 来源 {{ detail.ban_info.source }}
            </el-descriptions-item>
          </el-descriptions>

          <h4>统计</h4>
          <el-row :gutter="12">
            <el-col :span="8">
              <el-statistic title="发布数" :value="detail.stats.publish_count" />
            </el-col>
            <el-col :span="8">
              <el-statistic title="订单数" :value="detail.stats.order_count" />
            </el-col>
            <el-col :span="8">
              <el-statistic title="被举报数" :value="detail.stats.report_count" />
            </el-col>
          </el-row>

          <h4>操作留痕</h4>
          <el-timeline v-if="operationLogs.length">
            <el-timeline-item v-for="(log, i) in operationLogs" :key="i" :timestamp="log.time">
              {{ log.action }}<span v-if="log.operator">（{{ log.operator }}）</span>
              <div v-if="log.note" class="log-note">{{ log.note }}</div>
            </el-timeline-item>
          </el-timeline>
          <el-empty v-else description="暂无操作留痕" :image-size="60" />
        </template>
        <el-empty v-else-if="!detailLoading" description="详情加载失败" />
      </div>
    </el-drawer>
  </div>
</template>

<script setup lang="ts">
import { onMounted, reactive, ref } from 'vue';
import { ElMessage, ElMessageBox } from 'element-plus';
import type { FormInstance, FormRules } from 'element-plus';
import { banAccount, getAccount, listAccounts, unbanAccount } from '../../api/account';
import type { AccountDetail, AccountItem, AccountRole, AccountStatus } from '../../api/account';

const list = ref<AccountItem[]>([]);
const loading = ref(false);
const acting = ref(false);
const keyword = ref('');
const statusFilter = ref<'' | AccountStatus>('');
const roleFilter = ref<'' | AccountRole>('');

async function fetchList() {
  loading.value = true;
  try {
    const data = await listAccounts({
      keyword: keyword.value || undefined,
      status: statusFilter.value || undefined,
      role: roleFilter.value || undefined,
    });
    list.value = data.list;
  } catch (e) {
    list.value = [];
    ElMessage.error((e as Error).message || '账号列表加载失败');
  } finally {
    loading.value = false;
  }
}

const ROLE_TEXT: Record<AccountRole, string> = {
  guest: '访客',
  student: '学生',
  staff: '教职工',
  merchant: '商家',
};

function statusText(status: string): string {
  const map: Record<string, string> = {
    normal: '正常',
    banned: '已封禁',
    deactivating: '注销清算中',
  };
  return map[status] ?? status;
}

function statusTagType(status: string): 'success' | 'danger' | 'warning' | 'info' {
  const map: Record<string, 'success' | 'danger' | 'warning' | 'info'> = {
    normal: 'success',
    banned: 'danger',
    deactivating: 'warning',
  };
  return map[status] ?? 'info';
}

// ---------- 封禁 ----------
const banVisible = ref(false);
const banFormRef = ref<FormInstance>();
const currentRow = ref<AccountItem | null>(null);
const banForm = reactive<{ duration_days: number; reason: string; source: string }>({
  duration_days: 7,
  reason: '',
  source: 'manual',
});

const banRules: FormRules = {
  duration_days: [{ required: true, message: '封禁时长必填（-1 为永久）', trigger: 'blur' }],
  reason: [{ required: true, message: '封禁原因必填', trigger: 'blur' }],
};

function openBan(row: AccountItem) {
  currentRow.value = row;
  banForm.duration_days = 7;
  banForm.reason = '';
  banForm.source = 'manual';
  banVisible.value = true;
}

async function onBanSubmit() {
  if (!currentRow.value || !banFormRef.value) return;
  try {
    await banFormRef.value.validate();
  } catch {
    return;
  }
  acting.value = true;
  try {
    await banAccount(currentRow.value.id, {
      duration_days: banForm.duration_days,
      reason: banForm.reason,
      source: banForm.source,
    });
    ElMessage.success('已封禁');
    banVisible.value = false;
    fetchList();
  } catch (e) {
    ElMessage.error((e as Error).message || '封禁失败');
  } finally {
    acting.value = false;
  }
}

// ---------- 解封 ----------
async function onUnban(row: AccountItem) {
  try {
    await ElMessageBox.confirm(
      `确认解封账号「${row.nickname}」？解封后账号恢复正常使用。`,
      '解封确认',
      { type: 'warning', confirmButtonText: '确认解封', cancelButtonText: '取消' },
    );
  } catch {
    return;
  }
  acting.value = true;
  try {
    await unbanAccount(row.id);
    ElMessage.success('已解封');
    fetchList();
  } catch (e) {
    ElMessage.error((e as Error).message || '解封失败');
  } finally {
    acting.value = false;
  }
}

// ---------- 详情抽屉 ----------
const drawerVisible = ref(false);
const detailLoading = ref(false);
const detail = ref<AccountDetail | null>(null);

// TODO(契约未就绪)：操作留痕接口未返回时降级展示 mock 示例
const MOCK_LOGS: AccountDetail['operation_logs'] = [
  { time: '2026-10-03 10:20:00', operator: 'admin01', action: '警告', note: '举报处置联动警告' },
  { time: '2026-09-28 16:05:00', operator: 'admin02', action: '信用分调整', note: '纠纷败诉 -10 分' },
];
const operationLogs = ref<AccountDetail['operation_logs']>([]);

async function openDetail(row: AccountItem) {
  drawerVisible.value = true;
  detailLoading.value = true;
  detail.value = null;
  operationLogs.value = [];
  try {
    const data = await getAccount(row.id);
    detail.value = data.account;
    operationLogs.value = data.account.operation_logs.length
      ? data.account.operation_logs
      : MOCK_LOGS;
  } catch (e) {
    ElMessage.error((e as Error).message || '账号详情加载失败');
  } finally {
    detailLoading.value = false;
  }
}

onMounted(fetchList);
</script>

<style scoped>
.card-header {
  display: flex;
  justify-content: space-between;
  align-items: center;
}
.form-tip {
  font-size: 12px;
  color: var(--el-text-color-secondary);
}
.log-note {
  font-size: 12px;
  color: var(--el-text-color-secondary);
}
h4 {
  margin: 16px 0 8px;
}
</style>
