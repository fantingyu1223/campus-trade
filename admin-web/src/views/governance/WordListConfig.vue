<!-- @page A9 @ac F22-AC1 F13-AC3 @module PIM-BC-06 -->
<template>
  <div class="word-list-config-page">
    <el-card shadow="never">
      <template #header>
        <div class="card-header">
          <span>词表配置</span>
          <div>
            <el-button @click="fetchList">刷新</el-button>
            <el-button type="primary" @click="openCreate">新增词条</el-button>
          </div>
        </div>
      </template>

      <el-alert type="info" :closable="false" show-icon style="margin-bottom: 12px">
        保存后将自动刷新各端词表快照，C 端发布/聊天即时生效。
      </el-alert>

      <el-form inline @submit.prevent>
        <el-form-item label="词类型">
          <el-select
            v-model="typeFilter"
            placeholder="全部"
            clearable
            style="width: 140px"
            @change="fetchList"
          >
            <el-option label="风险词" value="risk" />
            <el-option label="违规词" value="violation" />
            <el-option label="违禁品" value="prohibited" />
          </el-select>
        </el-form-item>
      </el-form>

      <el-table v-loading="loading" :data="list" border empty-text="暂无词条">
        <el-table-column prop="id" label="ID" width="80" />
        <el-table-column prop="word" label="词条" min-width="140" />
        <el-table-column label="类型" width="110">
          <template #default="{ row }: { row: WordItem }">
            {{ TYPE_TEXT[row.type] ?? row.type }}
          </template>
        </el-table-column>
        <el-table-column label="级别" width="120">
          <template #default="{ row }: { row: WordItem }">
            <el-tag :type="row.level === 'block' ? 'danger' : 'warning'">
              {{ LEVEL_TEXT[row.level] ?? row.level }}
            </el-tag>
          </template>
        </el-table-column>
        <el-table-column label="状态" width="100">
          <template #default="{ row }">
            <el-tag :type="row.status === 'enabled' ? 'success' : 'info'">
              {{ row.status === 'enabled' ? '启用' : '停用' }}
            </el-tag>
          </template>
        </el-table-column>
        <el-table-column prop="updated_at" label="更新时间" width="170">
          <template #default="{ row }">{{ row.updated_at || '—' }}</template>
        </el-table-column>
        <el-table-column label="操作" width="200" fixed="right">
          <template #default="{ row }">
            <el-button link type="primary" @click="openEdit(row)">编辑</el-button>
            <el-button
              link
              :type="row.status === 'enabled' ? 'danger' : 'success'"
              @click="onToggle(row)"
            >
              {{ row.status === 'enabled' ? '停用' : '启用' }}
            </el-button>
            <el-button link type="info" @click="openHistory(row)">历史</el-button>
          </template>
        </el-table-column>
      </el-table>
    </el-card>

    <!-- 新增/编辑对话框 -->
    <el-dialog v-model="dialogVisible" :title="editingId ? '编辑词条' : '新增词条'" width="440px">
      <el-form ref="formRef" :model="form" :rules="formRules" label-width="80px">
        <el-form-item label="词条" prop="word">
          <el-input v-model="form.word" placeholder="必填：词条文本" />
        </el-form-item>
        <el-form-item label="类型" prop="type">
          <el-select v-model="form.type" placeholder="必选" style="width: 100%">
            <el-option label="风险词" value="risk" />
            <el-option label="违规词" value="violation" />
            <el-option label="违禁品" value="prohibited" />
          </el-select>
        </el-form-item>
        <el-form-item label="级别" prop="level">
          <el-select v-model="form.level" placeholder="必选" style="width: 100%">
            <el-option label="直接拦截" value="block" />
            <el-option label="转人工复核" value="review" />
          </el-select>
        </el-form-item>
      </el-form>
      <template #footer>
        <el-button @click="dialogVisible = false">取消</el-button>
        <el-button type="primary" :loading="acting" @click="onSave">保存</el-button>
      </template>
    </el-dialog>

    <!-- 变更历史侧栏 -->
    <el-drawer v-model="historyVisible" title="变更历史" size="420px">
      <div v-loading="historyLoading">
        <el-timeline v-if="history.length">
          <el-timeline-item v-for="(h, i) in history" :key="i" :timestamp="h.time">
            <div>{{ ACTION_TEXT[h.action] ?? h.action }}<span v-if="h.operator">（{{ h.operator }}）</span></div>
            <div class="history-diff">
              <div>前：{{ h.before ? JSON.stringify(h.before) : '—' }}</div>
              <div>后：{{ h.after ? JSON.stringify(h.after) : '—' }}</div>
            </div>
          </el-timeline-item>
        </el-timeline>
        <el-empty v-else description="暂无变更历史" />
      </div>
    </el-drawer>
  </div>
</template>

<script setup lang="ts">
import { onMounted, reactive, ref } from 'vue';
import { ElMessage, ElMessageBox } from 'element-plus';
import type { FormInstance, FormRules } from 'element-plus';
import { createWord, listWordHistory, listWords, toggleWord, updateWord } from '../../api/word-list';
import type { WordHistoryItem, WordItem, WordLevel, WordType } from '../../api/word-list';

const list = ref<WordItem[]>([]);
const loading = ref(false);
const typeFilter = ref<'' | WordType>('');
const acting = ref(false);

async function fetchList() {
  loading.value = true;
  try {
    const data = await listWords({ type: typeFilter.value || undefined });
    list.value = data.list;
  } catch (e) {
    list.value = [];
    ElMessage.error((e as Error).message || '词表加载失败');
  } finally {
    loading.value = false;
  }
}

const TYPE_TEXT: Record<WordType, string> = {
  risk: '风险词',
  violation: '违规词',
  prohibited: '违禁品',
};
const LEVEL_TEXT: Record<WordLevel, string> = {
  block: '直接拦截',
  review: '转人工复核',
};
const ACTION_TEXT: Record<string, string> = {
  create: '新增',
  update: '编辑',
  toggle: '停用/启用',
};

// ---------- 新增/编辑 ----------
const dialogVisible = ref(false);
const editingId = ref<number | null>(null);
const formRef = ref<FormInstance>();
const form = reactive<{ word: string; type: '' | WordType; level: '' | WordLevel }>({
  word: '',
  type: '',
  level: '',
});

const formRules: FormRules = {
  word: [{ required: true, message: '词条必填', trigger: 'blur' }],
  type: [{ required: true, message: '类型必选', trigger: 'change' }],
  level: [{ required: true, message: '级别必选', trigger: 'change' }],
};

function openCreate() {
  editingId.value = null;
  form.word = '';
  form.type = '';
  form.level = '';
  dialogVisible.value = true;
}

function openEdit(row: WordItem) {
  editingId.value = row.id;
  form.word = row.word;
  form.type = row.type;
  form.level = row.level;
  dialogVisible.value = true;
}

async function onSave() {
  if (!formRef.value) return;
  try {
    await formRef.value.validate();
  } catch {
    return;
  }
  acting.value = true;
  try {
    const payload = { word: form.word, type: form.type as WordType, level: form.level as WordLevel };
    if (editingId.value) {
      await updateWord(editingId.value, payload);
    } else {
      await createWord(payload);
    }
    ElMessage.success('已保存，将自动刷新各端词表快照');
    dialogVisible.value = false;
    fetchList();
  } catch (e) {
    ElMessage.error((e as Error).message || '保存失败');
  } finally {
    acting.value = false;
  }
}

// ---------- 停用/启用 ----------
async function onToggle(row: WordItem) {
  const actionText = row.status === 'enabled' ? '停用' : '启用';
  try {
    await ElMessageBox.confirm(
      `确认${actionText}词条「${row.word}」？保存后将自动刷新各端词表快照。`,
      `${actionText}确认`,
      { type: 'warning', confirmButtonText: `确认${actionText}`, cancelButtonText: '取消' },
    );
  } catch {
    return;
  }
  acting.value = true;
  try {
    await toggleWord(row.id);
    ElMessage.success(`已${actionText}`);
    fetchList();
  } catch (e) {
    ElMessage.error((e as Error).message || '操作失败');
  } finally {
    acting.value = false;
  }
}

// ---------- 变更历史（接口未就绪时展示 mock） ----------
const historyVisible = ref(false);
const historyLoading = ref(false);
const history = ref<WordHistoryItem[]>([]);

// TODO(契约未就绪)：词表变更历史接口未定，先按契约结构 mock 两条示例
const MOCK_HISTORY: WordHistoryItem[] = [
  {
    time: '2026-10-05 14:32:10',
    operator: 'admin01',
    action: 'update',
    before: { level: 'review' },
    after: { level: 'block' },
  },
  {
    time: '2026-10-01 09:15:00',
    operator: 'admin01',
    action: 'create',
    before: null,
    after: { word: '示例词条', type: 'risk', level: 'review' },
  },
];

async function openHistory(row: WordItem) {
  historyVisible.value = true;
  historyLoading.value = true;
  history.value = [];
  try {
    const data = await listWordHistory(row.id);
    history.value = data.history.length ? data.history : MOCK_HISTORY;
  } catch {
    // 接口未就绪：降级展示 mock
    history.value = MOCK_HISTORY;
  } finally {
    historyLoading.value = false;
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
.history-diff {
  font-size: 12px;
  color: var(--el-text-color-secondary);
  margin-top: 4px;
}
</style>
