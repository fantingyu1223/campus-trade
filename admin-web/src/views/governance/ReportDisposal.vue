<!-- @page A3 @ac F20-AC2 F21-AC1 @module PIM-BC-05 -->
<template>
  <div class="report-disposal-page">
    <el-card v-loading="loading" shadow="never">
      <template #header>
        <div class="card-header">
          <span>举报处置 #{{ id }}</span>
          <el-button @click="router.back()">返回</el-button>
        </div>
      </template>

      <el-empty v-if="!loading && !detail" description="举报详情加载失败" />

      <template v-else-if="detail">
        <el-descriptions :column="2" border style="margin-bottom: 16px">
          <el-descriptions-item label="对象类型">
            {{ TARGET_TYPE_TEXT[detail.target_type] ?? detail.target_type }}
          </el-descriptions-item>
          <el-descriptions-item label="状态">
            <el-tag :type="STATUS_TAG[detail.status]">{{ STATUS_TEXT[detail.status] }}</el-tag>
          </el-descriptions-item>
          <el-descriptions-item label="SLA 截止">{{ detail.sla_deadline }}</el-descriptions-item>
          <el-descriptions-item label="是否超时">
            <el-tag :type="detail.sla_overdue ? 'danger' : 'success'">
              {{ detail.sla_overdue ? '已超时' : '未超时' }}
            </el-tag>
          </el-descriptions-item>
          <el-descriptions-item label="举报理由" :span="2">{{ detail.reason }}</el-descriptions-item>
          <el-descriptions-item label="详细描述" :span="2">{{ detail.description }}</el-descriptions-item>
        </el-descriptions>

        <!-- 被举报对象快照 -->
        <h4>对象快照</h4>
        <pre class="snapshot-pre">{{ snapshotText }}</pre>

        <!-- 证据图 -->
        <h4>证据材料（{{ detail.evidence_urls.length }}）</h4>
        <el-empty v-if="!detail.evidence_urls.length" description="无证据图" :image-size="60" />
        <div v-else class="evidence-list">
          <el-image
            v-for="(url, i) in detail.evidence_urls"
            :key="i"
            :src="url"
            :preview-src-list="detail.evidence_urls"
            :initial-index="i"
            fit="cover"
            class="evidence-img"
          />
        </div>

        <!-- 处置留痕 -->
        <h4>处置留痕</h4>
        <el-empty v-if="!detail.timeline.length" description="暂无留痕" :image-size="60" />
        <el-timeline v-else style="padding-left: 4px">
          <el-timeline-item
            v-for="(item, i) in detail.timeline"
            :key="i"
            :timestamp="item.time"
            placement="top"
          >
            <div>{{ item.action }}<span v-if="item.operator">（{{ item.operator }}）</span></div>
            <div v-if="item.note" class="timeline-note">{{ item.note }}</div>
          </el-timeline-item>
        </el-timeline>

        <!-- 处置表单 -->
        <el-divider />
        <h4>处置操作</h4>
        <el-form label-width="100px" style="max-width: 560px" @submit.prevent>
          <el-form-item label="处置结果" required>
            <el-select v-model="result" placeholder="请选择（仅枚举，不可输入）" style="width: 100%">
              <el-option label="下架" value="off_shelf" />
              <el-option label="警告" value="warning" />
              <el-option label="封禁" value="ban" />
              <el-option label="驳回举报" value="rejected" />
            </el-select>
          </el-form-item>
          <el-form-item v-if="result === 'ban'" label="封禁天数" required>
            <el-input-number v-model="durationDays" :min="1" :max="3650" />
          </el-form-item>
          <el-form-item label="处置说明">
            <el-input v-model="note" type="textarea" :rows="3" maxlength="500" show-word-limit />
          </el-form-item>
          <el-form-item>
            <el-button type="primary" :loading="submitting" @click="onSubmit">提交处置</el-button>
          </el-form-item>
        </el-form>
      </template>
    </el-card>
  </div>
</template>

<script setup lang="ts">
import { computed, onMounted, ref } from 'vue';
import { useRoute, useRouter } from 'vue-router';
import { ElMessage, ElMessageBox } from 'element-plus';
import { getReport, submitDisposal } from '../../api/governance';
import type {
  DisposalResult,
  ReportDetail,
  ReportQueueStatus,
  ReportTargetType,
} from '../../api/governance';

const route = useRoute();
const router = useRouter();
const id = Number(route.params.id);

const detail = ref<ReportDetail | null>(null);
const loading = ref(false);
const submitting = ref(false);

const result = ref<DisposalResult | ''>('');
const durationDays = ref<number>(7);
const note = ref('');

const snapshotText = computed(() =>
  detail.value?.target_snapshot ? JSON.stringify(detail.value.target_snapshot, null, 2) : '（无快照）',
);

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

const RESULT_TEXT: Record<DisposalResult, string> = {
  off_shelf: '下架',
  warning: '警告',
  ban: '封禁',
  rejected: '驳回举报',
};

async function loadDetail() {
  loading.value = true;
  try {
    const data = await getReport(id); // #55
    detail.value = data.report;
  } catch (e) {
    ElMessage.error((e as Error).message || '详情加载失败');
  } finally {
    loading.value = false;
  }
}

async function onSubmit() {
  if (!result.value) {
    ElMessage.warning('请选择处置结果');
    return;
  }
  if (result.value === 'ban' && (!durationDays.value || durationDays.value < 1)) {
    ElMessage.warning('封禁必须填写封禁天数（≥1）');
    return;
  }
  try {
    await ElMessageBox.confirm(
      `确认对举报 #${id} 执行「${RESULT_TEXT[result.value]}」？提交后不可撤销。`,
      '处置确认',
      { type: 'warning', confirmButtonText: '确认提交', cancelButtonText: '取消' },
    );
  } catch {
    return; // 用户取消
  }
  submitting.value = true;
  try {
    await submitDisposal(id, {
      result: result.value,
      note: note.value,
      ...(result.value === 'ban' ? { duration_days: durationDays.value } : {}),
    }); // #56
    ElMessage.success('处置已提交');
    router.back();
  } catch (e) {
    ElMessage.error((e as Error).message || '处置提交失败');
  } finally {
    submitting.value = false;
  }
}

onMounted(loadDetail);
</script>

<style scoped>
.card-header {
  display: flex;
  justify-content: space-between;
  align-items: center;
}
.snapshot-pre {
  background: var(--el-fill-color-light);
  border: 1px solid var(--el-border-color);
  border-radius: 4px;
  padding: 12px;
  margin: 0 0 16px;
  max-height: 240px;
  overflow: auto;
  font-size: 12px;
}
.evidence-list {
  display: flex;
  flex-wrap: wrap;
  gap: 8px;
  margin-bottom: 16px;
}
.evidence-img {
  width: 120px;
  height: 120px;
  border-radius: 4px;
  border: 1px solid var(--el-border-color);
}
.timeline-note {
  color: var(--el-text-color-secondary);
  font-size: 12px;
}
</style>
