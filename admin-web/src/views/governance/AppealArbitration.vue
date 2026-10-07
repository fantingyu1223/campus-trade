<!-- @page A8 @ac F30-AC1 F31-AC1 @module PIM-BC-05 -->
<template>
  <div class="appeal-arbitration-page">
    <el-card shadow="never">
      <template #header>
        <div class="card-header">
          <span>申诉仲裁（48h 介入时限倒计时）</span>
          <el-button @click="fetchList">刷新</el-button>
        </div>
      </template>

      <el-form inline @submit.prevent>
        <el-form-item label="类型">
          <el-select
            v-model="typeFilter"
            placeholder="全部"
            clearable
            style="width: 140px"
            @change="fetchList"
          >
            <el-option label="纠纷申诉" value="dispute" />
            <el-option label="处罚申诉" value="punishment" />
          </el-select>
        </el-form-item>
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
      </el-form>

      <el-table
        v-loading="loading"
        :data="list"
        :row-class-name="rowClassName"
        border
        empty-text="暂无申诉"
        @row-click="openDetail"
      >
        <el-table-column prop="id" label="ID" width="80" />
        <el-table-column label="类型" width="110">
          <template #default="{ row }">
            {{ TYPE_TEXT[row.type] ?? row.type }}
          </template>
        </el-table-column>
        <el-table-column prop="related_no" label="关联单号" min-width="160" show-overflow-tooltip />
        <el-table-column prop="submitted_at" label="提交时间" width="170" />
        <el-table-column label="48h 倒计时" width="160">
          <template #default="{ row }">
            <span :class="{ 'sla-timeout-text': isTimeout(row) }">{{ countdown(row) }}</span>
            <el-tag v-if="isTimeout(row)" type="danger" size="small" style="margin-left: 6px">
              超时
            </el-tag>
          </template>
        </el-table-column>
        <el-table-column label="状态" width="100">
          <template #default="{ row }">
            <el-tag :type="STATUS_TAG[row.status]">{{ STATUS_TEXT[row.status] }}</el-tag>
          </template>
        </el-table-column>
      </el-table>
    </el-card>

    <!-- 详情抽屉：理由/证据/关联上下文/聊天摘要 + 裁决表单 -->
    <el-drawer v-model="drawerVisible" title="申诉详情与裁决" size="560px">
      <div v-loading="detailLoading">
        <template v-if="detail">
          <el-descriptions :column="1" border size="small">
            <el-descriptions-item label="类型">{{ TYPE_TEXT[detail.type] }}</el-descriptions-item>
            <el-descriptions-item label="提交时间">{{ detail.submitted_at }}</el-descriptions-item>
            <el-descriptions-item label="申诉理由">{{ detail.reason }}</el-descriptions-item>
          </el-descriptions>

          <h4>证据图</h4>
          <div v-if="detail.evidence_urls.length" class="evidence-list">
            <el-image
              v-for="(url, i) in detail.evidence_urls"
              :key="i"
              :src="url"
              :preview-src-list="detail.evidence_urls"
              :initial-index="i"
              fit="cover"
              class="evidence-img"
              preview-teleported
            />
          </div>
          <el-text v-else type="info">无证据图</el-text>

          <h4>关联上下文</h4>
          <el-card shadow="never" class="context-card">
            <div class="context-row">
              <span>关联单号：{{ detail.related_no }}</span>
              <el-button link type="primary" @click="onQuickView">快捷查看</el-button>
            </div>
            <pre v-if="detail.context" class="context-json">{{ JSON.stringify(detail.context, null, 2) }}</pre>
          </el-card>

          <h4>聊天摘要</h4>
          <el-text type="info">{{ detail.chat_summary || '聊天摘要（占位，待后端返回）' }}</el-text>

          <el-divider />

          <!-- 裁决表单 -->
          <el-form ref="formRef" :model="form" :rules="formRules" label-width="100px">
            <el-form-item label="裁决结果" prop="result">
              <el-select v-model="form.result" placeholder="请选择" style="width: 100%">
                <el-option label="买家胜" value="buyer_win" />
                <el-option label="卖家胜" value="seller_win" />
                <el-option label="双方警告" value="both_warning" />
                <el-option label="无效驳回" value="invalid" />
              </el-select>
            </el-form-item>
            <el-form-item label="裁决备注" prop="note">
              <el-input
                v-model="form.note"
                type="textarea"
                :rows="3"
                placeholder="必填：说明裁决依据"
              />
            </el-form-item>
            <el-form-item label="关联处置">
              <el-select v-model="form.linked_action" placeholder="无" clearable style="width: 100%">
                <el-option label="下架" value="off_shelf" />
                <el-option label="警告" value="warning" />
                <el-option label="封禁" value="ban" />
                <el-option label="驳回" value="rejected" />
              </el-select>
            </el-form-item>
            <el-form-item>
              <el-button type="primary" :loading="acting" @click="onSubmit">提交裁决</el-button>
            </el-form-item>
          </el-form>
        </template>
        <el-empty v-else-if="!detailLoading" description="详情加载失败" />
      </div>
    </el-drawer>
  </div>
</template>

<script setup lang="ts">
import { onMounted, onUnmounted, reactive, ref } from 'vue';
import { ElMessage, ElMessageBox } from 'element-plus';
import type { FormInstance, FormRules } from 'element-plus';
import { adjudicateAppeal, getAppeal, listAppeals } from '../../api/appeal';
import type { AdjudicatePayload, AppealDetail, AppealItem, AppealStatus, AppealType } from '../../api/appeal';

const list = ref<AppealItem[]>([]);
const loading = ref(false);
const typeFilter = ref<'' | AppealType>('');
const statusFilter = ref<'' | AppealStatus>('');
// 每秒 +1 触发倒计时重算
const nowTick = ref(Date.now());
let timer: ReturnType<typeof setInterval> | undefined;

async function fetchList() {
  loading.value = true;
  try {
    const data = await listAppeals({
      type: typeFilter.value || undefined,
      status: statusFilter.value || undefined,
    });
    list.value = data.list;
  } catch (e) {
    list.value = [];
    ElMessage.error((e as Error).message || '申诉列表加载失败');
  } finally {
    loading.value = false;
  }
}

function remainingMs(row: AppealItem): number {
  return new Date(row.intervene_deadline).getTime() - nowTick.value;
}

function isTimeout(row: AppealItem): boolean {
  return remainingMs(row) <= 0;
}

function countdown(row: AppealItem): string {
  const ms = remainingMs(row);
  if (ms <= 0) return '已超时';
  const totalMin = Math.floor(ms / 60000);
  const h = Math.floor(totalMin / 60);
  const m = totalMin % 60;
  return `${h}h ${m}m`;
}

function rowClassName({ row }: { row: AppealItem }): string {
  return isTimeout(row) ? 'row-timeout' : '';
}

const TYPE_TEXT: Record<AppealType, string> = {
  dispute: '纠纷申诉',
  punishment: '处罚申诉',
};

const STATUS_TEXT: Record<AppealStatus, string> = {
  pending: '待处理',
  processing: '处理中',
  done: '已办结',
};
const STATUS_TAG: Record<AppealStatus, 'warning' | 'primary' | 'success'> = {
  pending: 'warning',
  processing: 'primary',
  done: 'success',
};

// ---------- 详情抽屉 ----------
const drawerVisible = ref(false);
const detailLoading = ref(false);
const detail = ref<AppealDetail | null>(null);

async function openDetail(row: AppealItem) {
  drawerVisible.value = true;
  detailLoading.value = true;
  detail.value = null;
  resetForm();
  try {
    const data = await getAppeal(row.id);
    detail.value = data.appeal;
  } catch (e) {
    ElMessage.error((e as Error).message || '申诉详情加载失败');
  } finally {
    detailLoading.value = false;
  }
}

// 关联上下文快捷查看（占位：详情页路由待契约后接入）
function onQuickView() {
  ElMessage.info('快捷查看（占位）：关联订单/举报详情页待接入');
}

// ---------- 裁决表单 ----------
const formRef = ref<FormInstance>();
const acting = ref(false);
const form = reactive<{ result: '' | AdjudicatePayload['result']; note: string; linked_action: '' | NonNullable<AdjudicatePayload['linked_action']> }>({
  result: '',
  note: '',
  linked_action: '',
});

const formRules: FormRules = {
  result: [{ required: true, message: '请选择裁决结果', trigger: 'change' }],
  note: [{ required: true, message: '裁决备注必填', trigger: 'blur' }],
};

function resetForm() {
  form.result = '';
  form.note = '';
  form.linked_action = '';
}

async function onSubmit() {
  if (!detail.value || !formRef.value) return;
  try {
    await formRef.value.validate();
  } catch {
    return;
  }
  try {
    await ElMessageBox.confirm(
      '确认提交裁决结果？提交后不可撤回，申诉将标记为已办结。',
      '提交确认',
      { type: 'warning', confirmButtonText: '确认提交', cancelButtonText: '取消' },
    );
  } catch {
    return;
  }
  const payload: AdjudicatePayload = {
    result: form.result as AdjudicatePayload['result'],
    note: form.note,
  };
  if (form.linked_action) payload.linked_action = form.linked_action as AdjudicatePayload['linked_action'];
  acting.value = true;
  try {
    await adjudicateAppeal(detail.value.id, payload);
    ElMessage.success('裁决已提交');
    drawerVisible.value = false;
    fetchList();
  } catch (e) {
    ElMessage.error((e as Error).message || '提交失败');
  } finally {
    acting.value = false;
  }
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
.evidence-list {
  display: flex;
  gap: 8px;
  flex-wrap: wrap;
}
.evidence-img {
  width: 96px;
  height: 96px;
  border-radius: 4px;
}
.context-card {
  background: var(--el-fill-color-light);
}
.context-row {
  display: flex;
  justify-content: space-between;
  align-items: center;
}
.context-json {
  margin: 8px 0 0;
  font-size: 12px;
  white-space: pre-wrap;
}
h4 {
  margin: 16px 0 8px;
}
</style>
