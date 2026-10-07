<!-- @page A2 @ac F20-AC1 @module PIM-BC-05 -->
<template>
  <div class="report-queue-page">
    <el-card shadow="never">
      <template #header>
        <div class="card-header">
          <span>举报队列（按 SLA 剩余时限升序）</span>
          <el-button @click="fetchList">刷新</el-button>
        </div>
      </template>

      <!-- 筛选栏：status 走查询参数；target_type 契约未支持，前端当前页过滤 -->
      <el-form inline @submit.prevent>
        <el-form-item label="状态">
          <el-select
            v-model="statusFilter"
            placeholder="全部"
            clearable
            style="width: 140px"
            @change="fetchList"
          >
            <el-option label="待处理" value="pending" />
            <el-option label="处理中" value="processing" />
            <el-option label="已办结" value="done" />
          </el-select>
        </el-form-item>
        <el-form-item label="对象类型">
          <el-select v-model="typeFilter" placeholder="全部" clearable style="width: 140px">
            <el-option label="商品" value="product" />
            <el-option label="用户" value="user" />
            <el-option label="商家" value="merchant" />
            <el-option label="会话" value="chat" />
          </el-select>
        </el-form-item>
      </el-form>

      <el-table
        v-loading="loading"
        :data="filteredReports"
        :row-class-name="rowClassName"
        border
        empty-text="暂无举报"
        @row-click="goDetail"
      >
        <el-table-column label="对象类型" width="110">
          <template #default="{ row }">
            {{ TARGET_TYPE_TEXT[row.target_type] ?? row.target_type }}
          </template>
        </el-table-column>
        <el-table-column prop="reason" label="举报理由" min-width="180" show-overflow-tooltip />
        <el-table-column prop="created_at" label="提交时间" width="170">
          <template #default="{ row }">{{ row.created_at || '—' }}</template>
        </el-table-column>
        <el-table-column label="SLA 倒计时" width="150">
          <template #default="{ row }">
            <span :class="{ 'sla-timeout-text': isTimeout(row) }">{{ slaCountdown(row) }}</span>
            <el-tag v-if="isTimeout(row)" type="danger" size="small" style="margin-left: 6px">
              超时
            </el-tag>
          </template>
        </el-table-column>
        <el-table-column label="状态" width="100">
          <template #default="{ row }">
            <el-tag v-if="row.status" :type="STATUS_TAG[row.status]">
              {{ STATUS_TEXT[row.status] }}
            </el-tag>
            <span v-else>—</span>
          </template>
        </el-table-column>
        <el-table-column label="处理人" width="120">
          <template #default="{ row }">{{ row.handler || '未认领' }}</template>
        </el-table-column>
      </el-table>
    </el-card>
  </div>
</template>

<script setup lang="ts">
import { computed, onMounted, onUnmounted, ref } from 'vue';
import { useRouter } from 'vue-router';
import { ElMessage } from 'element-plus';
import { listReports } from '../../api/governance';
import type { ReportItem, ReportQueueStatus, ReportTargetType } from '../../api/governance';

const router = useRouter();

const reports = ref<ReportItem[]>([]);
const loading = ref(false);
const statusFilter = ref<'' | ReportQueueStatus>('');
const typeFilter = ref<'' | ReportTargetType>('');
// 每秒 +1 触发倒计时重算
const nowTick = ref(Date.now());
let timer: ReturnType<typeof setInterval> | undefined;

async function fetchList() {
  loading.value = true;
  try {
    const data = await listReports({ status: statusFilter.value || undefined });
    reports.value = data.list;
  } catch (e) {
    reports.value = [];
    ElMessage.error((e as Error).message || '举报队列加载失败');
  } finally {
    loading.value = false;
  }
}

// target_type 契约不支持查询参数，前端在当前页数据过滤
const filteredReports = computed(() =>
  typeFilter.value ? reports.value.filter((r) => r.target_type === typeFilter.value) : reports.value,
);

function remainingMs(row: ReportItem): number {
  // 依赖 nowTick 实现秒级刷新
  return new Date(row.sla_deadline).getTime() - nowTick.value;
}

function isTimeout(row: ReportItem): boolean {
  return row.sla_overdue || remainingMs(row) <= 0;
}

function slaCountdown(row: ReportItem): string {
  const ms = remainingMs(row);
  if (ms <= 0 || row.sla_overdue) return '已超时';
  const totalMin = Math.floor(ms / 60000);
  const h = Math.floor(totalMin / 60);
  const m = totalMin % 60;
  return `${h}h ${m}m`;
}

function rowClassName({ row }: { row: ReportItem }): string {
  return isTimeout(row) ? 'row-timeout' : '';
}

const TARGET_TYPE_TEXT: Record<ReportTargetType, string> = {
  product: '商品',
  user: '用户',
  merchant: '商家',
  chat: '会话',
};

const STATUS_TEXT: Record<ReportQueueStatus, string> = {
  pending: '待处理',
  processing: '处理中',
  done: '已办结',
};
const STATUS_TAG: Record<ReportQueueStatus, 'warning' | 'primary' | 'success'> = {
  pending: 'warning',
  processing: 'primary',
  done: 'success',
};

function goDetail(row: ReportItem) {
  router.push(`/governance/reports/${row.id}`);
}

onMounted(() => {
  fetchList();
  timer = setInterval(() => {
    nowTick.value = Date.now();
  }, 1000);
});

onUnmounted(() => {
  if (timer) clearInterval(timer);
});
</script>

<style scoped>
.card-header {
  display: flex;
  justify-content: space-between;
  align-items: center;
}
.sla-timeout-text {
  color: var(--el-color-danger);
  font-weight: 600;
}
:deep(.row-timeout) {
  background-color: var(--el-color-danger-light-9) !important;
}
</style>
