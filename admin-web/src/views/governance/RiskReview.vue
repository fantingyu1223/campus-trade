<!-- @page A7 @ac F23-AC1 @module PIM-BC-05 -->
<template>
  <div class="risk-review-page">
    <el-card shadow="never">
      <template #header>
        <div class="card-header">
          <span>黄牛预警复核</span>
          <el-button @click="fetchList">刷新</el-button>
        </div>
      </template>

      <el-table v-loading="loading" :data="list" border empty-text="暂无预警">
        <el-table-column prop="user_masked" label="用户（脱敏）" min-width="140" />
        <el-table-column label="命中规则" width="160">
          <template #default="{ row }">
            {{ RULE_TEXT[row.rule_type] ?? row.rule_type }}
          </template>
        </el-table-column>
        <el-table-column prop="created_at" label="触发时间" width="170" />
        <el-table-column label="状态" width="100">
          <template #default="{ row }">
            <el-tag :type="statusTagType(row.status)">{{ statusText(row.status) }}</el-tag>
          </template>
        </el-table-column>
        <el-table-column label="操作" width="160" fixed="right">
          <template #default="{ row }">
            <el-button link type="primary" @click="openConfirm(row)">确认</el-button>
            <el-button link type="info" @click="onIgnore(row)">忽略</el-button>
          </template>
        </el-table-column>
      </el-table>
    </el-card>

    <!-- 确认处置对话框 -->
    <el-dialog v-model="confirmVisible" title="确认黄牛预警" width="440px">
      <el-radio-group v-model="confirmChoice" class="confirm-radio-group">
        <el-radio value="lead">转商家入驻线索</el-radio>
        <el-radio value="warn">转处置 - 警告</el-radio>
        <el-radio value="ban">转处置 - 封禁</el-radio>
      </el-radio-group>
      <template #footer>
        <el-button @click="confirmVisible = false">取消</el-button>
        <el-button type="primary" :loading="acting" @click="onConfirmSubmit">确认提交</el-button>
      </template>
    </el-dialog>
  </div>
</template>

<script setup lang="ts">
import { onMounted, ref } from 'vue';
import { ElMessage, ElMessageBox } from 'element-plus';
import { listRiskWarnings, reviewRiskWarning } from '../../api/governance';
import type { RiskReviewPayload, RiskRuleType, RiskWarningItem } from '../../api/governance';

const list = ref<RiskWarningItem[]>([]);
const loading = ref(false);
const acting = ref(false);

async function fetchList() {
  loading.value = true;
  try {
    const data = await listRiskWarnings({}); // #59
    list.value = data.list;
  } catch (e) {
    list.value = [];
    ElMessage.error((e as Error).message || '预警列表加载失败');
  } finally {
    loading.value = false;
  }
}

const RULE_TEXT: Record<RiskRuleType, string> = {
  daily_ge5: '日发≥5件',
  cross_ge3_cat: '跨≥3类目',
  suspected_merchant: '疑似伪装商家',
};

// 状态 tag：pending→warning 待复核 / confirmed→success / false_alarm→info（其余兜底）
function statusText(status: string): string {
  const map: Record<string, string> = {
    pending: '待复核',
    confirmed: '已确认',
    false_alarm: '误报',
    handled: '已处理',
  };
  return map[status] ?? status;
}

function statusTagType(status: string): 'warning' | 'success' | 'info' {
  const map: Record<string, 'warning' | 'success' | 'info'> = {
    pending: 'warning',
    confirmed: 'success',
    false_alarm: 'info',
    handled: 'info',
  };
  return map[status] ?? 'info';
}

// ---------- 确认（#60）：lead→limit_publish / warn→action+warning / ban→action+ban ----------
const confirmVisible = ref(false);
const confirmChoice = ref<'lead' | 'warn' | 'ban'>('warn');
const currentRow = ref<RiskWarningItem | null>(null);

function openConfirm(row: RiskWarningItem) {
  currentRow.value = row;
  confirmChoice.value = 'warn';
  confirmVisible.value = true;
}

async function onConfirmSubmit() {
  if (!currentRow.value) return;
  const payload: RiskReviewPayload =
    confirmChoice.value === 'lead'
      ? { conclusion: 'limit_publish' }
      : { conclusion: 'action', action_detail: confirmChoice.value === 'warn' ? 'warning' : 'ban' };
  acting.value = true;
  try {
    await reviewRiskWarning(currentRow.value.id, payload); // #60
    ElMessage.success('复核结论已提交');
    confirmVisible.value = false;
    fetchList();
  } catch (e) {
    ElMessage.error((e as Error).message || '提交失败');
  } finally {
    acting.value = false;
  }
}

// ---------- 忽略（#60 conclusion=release） ----------
async function onIgnore(row: RiskWarningItem) {
  try {
    await ElMessageBox.confirm(
      `确认忽略用户「${row.user_masked}」的该条预警？将标记为误报并解除限流。`,
      '忽略确认',
      { type: 'warning', confirmButtonText: '确认忽略', cancelButtonText: '取消' },
    );
  } catch {
    return;
  }
  acting.value = true;
  try {
    await reviewRiskWarning(row.id, { conclusion: 'release' }); // #60
    ElMessage.success('已忽略');
    fetchList();
  } catch (e) {
    ElMessage.error((e as Error).message || '操作失败');
  } finally {
    acting.value = false;
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
.confirm-radio-group {
  display: flex;
  flex-direction: column;
  gap: 8px;
}
</style>
