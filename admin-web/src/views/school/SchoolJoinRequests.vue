<!--
  @page A5 高校名单配置页（名单外加入申请列表与审批）
  @ac F36-AC2 名单配置通道可用性的配套审批入口
  @module PIM-BC-06
  契约：docs/design §5.3 #72-73（申请列表/审批处理，approve 自动建校并开通）
-->
<template>
  <div class="join-requests-page">
    <el-card shadow="never">
      <template #header>
        <span>名单外学校 · 加入申请</span>
      </template>

      <el-tabs v-model="activeStatus" @tab-change="reload">
        <el-tab-pane label="待审批" name="pending" />
        <el-tab-pane label="已通过" name="approved" />
        <el-tab-pane label="已拒绝" name="rejected" />
      </el-tabs>

      <el-table v-loading="loading" :data="list" border empty-text="暂无申请记录">
        <el-table-column prop="id" label="ID" width="80" />
        <el-table-column prop="school_name" label="申请学校" min-width="200" />
        <el-table-column prop="contact" label="联系方式" min-width="150" />
        <el-table-column prop="reason" label="申请说明" min-width="220" show-overflow-tooltip />
        <el-table-column prop="created_at" label="提交时间" width="170" />
        <el-table-column label="状态" width="100">
          <template #default="{ row }">
            <el-tag :type="statusTagType(row.status)">{{ statusText(row.status) }}</el-tag>
          </template>
        </el-table-column>
        <el-table-column label="操作" width="150" fixed="right">
          <template #default="{ row }">
            <template v-if="row.status === 'pending'">
              <el-button link type="success" @click="openHandle(row, 'approve')">通过</el-button>
              <el-button link type="danger" @click="openHandle(row, 'reject')">拒绝</el-button>
            </template>
            <span v-else class="handled-text">已处理</span>
          </template>
        </el-table-column>
      </el-table>

      <el-pagination
        v-model:current-page="query.page"
        v-model:page-size="query.pageSize"
        :total="total"
        layout="total, prev, pager, next"
        style="margin-top: 16px; justify-content: flex-end"
        @current-change="loadList"
      />
    </el-card>

    <!-- 审批对话框 -->
    <el-dialog
      v-model="handleDialogVisible"
      :title="handleAction === 'approve' ? '通过申请' : '拒绝申请'"
      width="480px"
    >
      <el-alert
        v-if="handleAction === 'approve'"
        type="warning"
        :closable="false"
        title="通过后系统将自动创建该校并开通认证（首期名单收窄为本校，请确认运营策略后再操作）"
        style="margin-bottom: 16px"
      />
      <el-form label-width="90px">
        <el-form-item label="申请学校">
          <span>{{ currentRow?.school_name }}</span>
        </el-form-item>
        <el-form-item :label="handleAction === 'approve' ? '备注' : '拒绝原因'">
          <el-input
            v-model="handleNote"
            type="textarea"
            :rows="3"
            maxlength="255"
            :placeholder="handleAction === 'approve' ? '选填' : '必填，将反馈给申请人'"
          />
        </el-form-item>
      </el-form>
      <template #footer>
        <el-button @click="handleDialogVisible = false">取消</el-button>
        <el-button
          :type="handleAction === 'approve' ? 'success' : 'danger'"
          :loading="handling"
          @click="submitHandle"
        >确认{{ handleAction === 'approve' ? '通过' : '拒绝' }}</el-button>
      </template>
    </el-dialog>
  </div>
</template>

<script setup lang="ts">
import { onMounted, reactive, ref } from 'vue';
import { ElMessage } from 'element-plus';
import { fetchJoinRequests, handleJoinRequest } from '../../api/school';
import type {
  JoinRequestAction,
  JoinRequestListQuery,
  JoinRequestStatus,
  SchoolJoinRequestItem,
} from '../../api/school';

const activeStatus = ref<JoinRequestStatus>('pending');
const query = reactive<JoinRequestListQuery>({ page: 1, pageSize: 20, status: 'pending' });
const list = ref<SchoolJoinRequestItem[]>([]);
const total = ref(0);
const loading = ref(false);

async function loadList() {
  loading.value = true;
  try {
    query.status = activeStatus.value;
    const data = await fetchJoinRequests(query); // #72
    list.value = data.list;
    total.value = data.total;
  } catch (e) {
    ElMessage.error((e as Error).message || '申请列表加载失败');
  } finally {
    loading.value = false;
  }
}

function reload() {
  query.page = 1;
  loadList();
}

const STATUS_TEXT: Record<JoinRequestStatus, string> = {
  pending: '待审批',
  approved: '已通过',
  rejected: '已拒绝',
};
const STATUS_TAG: Record<JoinRequestStatus, 'warning' | 'success' | 'danger'> = {
  pending: 'warning',
  approved: 'success',
  rejected: 'danger',
};

function statusText(s: JoinRequestStatus): string {
  return STATUS_TEXT[s];
}

function statusTagType(s: JoinRequestStatus): 'warning' | 'success' | 'danger' {
  return STATUS_TAG[s];
}

// ---------- 审批（#73） ----------
const handleDialogVisible = ref(false);
const handling = ref(false);
const handleAction = ref<JoinRequestAction>('approve');
const handleNote = ref('');
const currentRow = ref<SchoolJoinRequestItem | null>(null);

function openHandle(row: SchoolJoinRequestItem, action: JoinRequestAction) {
  currentRow.value = row;
  handleAction.value = action;
  handleNote.value = '';
  handleDialogVisible.value = true;
}

async function submitHandle() {
  if (!currentRow.value) return;
  if (handleAction.value === 'reject' && !handleNote.value.trim()) {
    ElMessage.warning('拒绝申请时必须填写拒绝原因');
    return;
  }
  handling.value = true;
  try {
    await handleJoinRequest(currentRow.value.id, {
      action: handleAction.value,
      note: handleNote.value.trim() || undefined,
    }); // #73
    ElMessage.success(handleAction.value === 'approve' ? '已通过，学校已自动创建并开通' : '已拒绝');
    handleDialogVisible.value = false;
    loadList();
  } catch (e) {
    // 4002：状态冲突（如已被处理）
    ElMessage.error((e as Error).message || '操作失败');
  } finally {
    handling.value = false;
  }
}

onMounted(loadList);
</script>

<style scoped>
.handled-text {
  color: #909399;
  font-size: 13px;
}
</style>
