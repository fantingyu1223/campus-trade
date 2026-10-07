<!-- @page A4 @ac F32-AC1 F32-AC2 F32-AC3 @module PIM-BC-05 -->
<template>
  <div class="merchant-review-page">
    <el-card shadow="never">
      <template #header>
        <div class="card-header">
          <span>商家入驻审核（SLA：2 个工作日）</span>
          <el-button @click="fetchList">刷新</el-button>
        </div>
      </template>

      <el-table
        v-loading="loading"
        :data="list"
        border
        empty-text="暂无待审申请"
        @row-click="openDetail"
      >
        <el-table-column prop="applicant_masked" label="申请人（脱敏）" min-width="140" />
        <el-table-column prop="submitted_at" label="提交时间" width="170" />
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
        <el-table-column label="操作" width="90">
          <template #default="{ row }">
            <el-button link type="primary" @click.stop="openDetail(row)">审核</el-button>
          </template>
        </el-table-column>
      </el-table>
    </el-card>

    <!-- 审核详情抽屉（资质调阅留痕） -->
    <el-drawer v-model="drawerVisible" title="入驻申请详情" size="560px">
      <div v-loading="detailLoading" class="drawer-body">
        <template v-if="detail">
          <el-descriptions :column="1" border style="margin-bottom: 16px">
            <el-descriptions-item label="真实姓名">{{ detail.materials.real_name }}</el-descriptions-item>
            <el-descriptions-item label="SLA 截止">{{ detail.sla_deadline }}</el-descriptions-item>
            <el-descriptions-item label="是否超时">
              <el-tag :type="detail.sla_overdue ? 'danger' : 'success'">
                {{ detail.sla_overdue ? '已超时' : '未超时' }}
              </el-tag>
            </el-descriptions-item>
            <el-descriptions-item label="状态">
              <el-tag :type="STATUS_TAG[detail.status]">{{ STATUS_TEXT[detail.status] }}</el-tag>
            </el-descriptions-item>
          </el-descriptions>

          <h4>身份证照片</h4>
          <div class="credential-list">
            <el-image
              v-for="(url, i) in detail.materials.id_card_urls"
              :key="'id' + i"
              :src="url"
              :preview-src-list="detail.materials.id_card_urls"
              :initial-index="i"
              fit="cover"
              class="credential-img"
            />
            <el-empty v-if="!detail.materials.id_card_urls.length" description="无" :image-size="50" />
          </div>

          <h4>资质材料</h4>
          <div class="credential-list">
            <el-image
              v-for="(url, i) in detail.materials.credential_urls"
              :key="'cred' + i"
              :src="url"
              :preview-src-list="detail.materials.credential_urls"
              :initial-index="i"
              fit="cover"
              class="credential-img"
            />
            <el-empty v-if="!detail.materials.credential_urls.length" description="无" :image-size="50" />
          </div>

          <h4>历史记录</h4>
          <el-empty v-if="!detail.history.length" description="暂无" :image-size="50" />
          <el-timeline v-else style="padding-left: 4px">
            <el-timeline-item
              v-for="(item, i) in detail.history"
              :key="i"
              :timestamp="item.time"
              placement="top"
            >
              {{ item.action }}<span v-if="item.operator">（{{ item.operator }}）</span>
              <div v-if="item.note" class="timeline-note">{{ item.note }}</div>
            </el-timeline-item>
          </el-timeline>

          <div class="drawer-actions">
            <el-button type="success" :loading="acting" @click="onApprove">通过</el-button>
            <el-button type="danger" :loading="acting" @click="openReject">驳回</el-button>
          </div>
        </template>
      </div>
    </el-drawer>

    <!-- 驳回对话框 -->
    <el-dialog v-model="rejectVisible" title="驳回申请" width="480px">
      <el-form label-width="90px" @submit.prevent>
        <el-form-item label="驳回理由" required>
          <el-select v-model="rejectReasonCode" placeholder="请选择（仅枚举）" style="width: 100%">
            <el-option v-for="opt in REASON_OPTIONS" :key="opt.value" :label="opt.label" :value="opt.value" />
          </el-select>
        </el-form-item>
        <el-form-item v-if="rejectReasonCode === 8" label="备注" required>
          <el-input
            v-model="rejectNote"
            type="textarea"
            :rows="3"
            maxlength="200"
            show-word-limit
            placeholder="选择「其他」时必填"
          />
        </el-form-item>
        <el-form-item v-else label="备注">
          <el-input v-model="rejectNote" type="textarea" :rows="2" maxlength="200" />
        </el-form-item>
      </el-form>
      <template #footer>
        <el-button @click="rejectVisible = false">取消</el-button>
        <el-button type="danger" :loading="acting" @click="onReject">确认驳回</el-button>
      </template>
    </el-dialog>
  </div>
</template>

<script setup lang="ts">
import { onMounted, onUnmounted, ref } from 'vue';
import { ElMessage, ElMessageBox } from 'element-plus';
import {
  approveMerchant,
  getMerchantReview,
  listMerchantReviews,
  rejectMerchant,
} from '../../api/governance';
import type {
  MerchantRejectReasonCode,
  MerchantReviewDetail,
  MerchantReviewItem,
  MerchantReviewStatus,
} from '../../api/governance';

const list = ref<MerchantReviewItem[]>([]);
const loading = ref(false);
const nowTick = ref(Date.now());
let timer: ReturnType<typeof setInterval> | undefined;

async function fetchList() {
  loading.value = true;
  try {
    const data = await listMerchantReviews({}); // #61
    list.value = data.list;
  } catch (e) {
    list.value = [];
    ElMessage.error((e as Error).message || '审核列表加载失败');
  } finally {
    loading.value = false;
  }
}

function remainingMs(row: MerchantReviewItem): number {
  return new Date(row.sla_deadline).getTime() - nowTick.value;
}

function isTimeout(row: MerchantReviewItem): boolean {
  return row.sla_overdue || remainingMs(row) <= 0;
}

function slaCountdown(row: MerchantReviewItem): string {
  const ms = remainingMs(row);
  if (ms <= 0 || row.sla_overdue) return '已超时';
  const totalMin = Math.floor(ms / 60000);
  const h = Math.floor(totalMin / 60);
  const m = totalMin % 60;
  return `${h}h ${m}m`;
}

const STATUS_TEXT: Record<MerchantReviewStatus, string> = {
  pending: '待审核',
  approved: '已通过',
  rejected: '已驳回',
};
const STATUS_TAG: Record<MerchantReviewStatus, 'warning' | 'success' | 'danger'> = {
  pending: 'warning',
  approved: 'success',
  rejected: 'danger',
};

// ---------- 详情抽屉 ----------
const drawerVisible = ref(false);
const detailLoading = ref(false);
const detail = ref<MerchantReviewDetail | null>(null);
const currentId = ref<number | null>(null);
const acting = ref(false);

async function openDetail(row: MerchantReviewItem) {
  currentId.value = row.id;
  drawerVisible.value = true;
  detailLoading.value = true;
  detail.value = null;
  try {
    const data = await getMerchantReview(row.id); // #62 资质调阅（留痕）
    detail.value = data.application;
    ElMessage.info('本次调阅已留痕');
  } catch (e) {
    ElMessage.error((e as Error).message || '详情加载失败');
  } finally {
    detailLoading.value = false;
  }
}

// ---------- 通过（#63） ----------
async function onApprove() {
  if (currentId.value === null) return;
  try {
    await ElMessageBox.confirm('确认通过该入驻申请？通过后申请人将开通商家权限。', '通过确认', {
      type: 'warning',
      confirmButtonText: '确认通过',
      cancelButtonText: '取消',
    });
  } catch {
    return;
  }
  acting.value = true;
  try {
    await approveMerchant(currentId.value);
    ElMessage.success('已通过');
    drawerVisible.value = false;
    fetchList();
  } catch (e) {
    ElMessage.error((e as Error).message || '操作失败');
  } finally {
    acting.value = false;
  }
}

// ---------- 驳回（#64） ----------
const rejectVisible = ref(false);
const rejectReasonCode = ref<MerchantRejectReasonCode | ''>('');
const rejectNote = ref('');

const REASON_OPTIONS: Array<{ value: MerchantRejectReasonCode; label: string }> = [
  { value: 1, label: '1 证件模糊' },
  { value: 2, label: '2 证件过期' },
  { value: 3, label: '3 信息不符' },
  { value: 4, label: '4 非本校学生' },
  { value: 5, label: '5 材料缺失' },
  { value: 6, label: '6 疑似伪造' },
  { value: 7, label: '7 在禁入驻名单' },
  { value: 8, label: '8 其他' },
];

function openReject() {
  rejectReasonCode.value = '';
  rejectNote.value = '';
  rejectVisible.value = true;
}

async function onReject() {
  if (currentId.value === null) return;
  if (!rejectReasonCode.value) {
    ElMessage.warning('请选择驳回理由');
    return;
  }
  if (rejectReasonCode.value === 8 && !rejectNote.value.trim()) {
    ElMessage.warning('选择「其他」时备注必填');
    return;
  }
  acting.value = true;
  try {
    await rejectMerchant(currentId.value, {
      reason_code: rejectReasonCode.value,
      ...(rejectNote.value.trim() ? { note: rejectNote.value.trim() } : {}),
    });
    ElMessage.success('已驳回');
    rejectVisible.value = false;
    drawerVisible.value = false;
    fetchList();
  } catch (e) {
    ElMessage.error((e as Error).message || '驳回失败');
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
.drawer-body {
  padding-bottom: 16px;
}
.credential-list {
  display: flex;
  flex-wrap: wrap;
  gap: 8px;
  margin-bottom: 16px;
}
.credential-img {
  width: 120px;
  height: 120px;
  border-radius: 4px;
  border: 1px solid var(--el-border-color);
}
.timeline-note {
  color: var(--el-text-color-secondary);
  font-size: 12px;
}
.drawer-actions {
  margin-top: 24px;
  display: flex;
  gap: 12px;
}
</style>
