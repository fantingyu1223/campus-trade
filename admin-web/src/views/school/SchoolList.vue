<!--
  @page A5 高校名单配置页（名单列表）
  @ac F36-AC2 运营新增高校并保存后认证页同步展示（验证配置通道可用，首期不启用新增）
  @module PIM-BC-06
  契约：docs/design §5.3 #68-71（名单列表/新增/修改/移除）
-->
<template>
  <div class="school-list-page">
    <el-card shadow="never">
      <template #header>
        <div class="card-header">
          <span>高校名单（首期=本校）</span>
          <el-button type="primary" @click="openCreate">新增学校</el-button>
        </div>
      </template>

      <!-- 筛选栏 -->
      <el-form inline @submit.prevent>
        <el-form-item label="学校名称">
          <el-input
            v-model="query.keyword"
            placeholder="按名称搜索"
            clearable
            style="width: 220px"
            @keyup.enter="reload"
            @clear="reload"
          />
        </el-form-item>
        <el-form-item label="状态">
          <el-select v-model="query.status" placeholder="全部" clearable style="width: 140px" @change="reload">
            <el-option label="生效中" value="active" />
            <el-option label="待开通" value="pending" />
            <el-option label="已停用" value="offboarded" />
          </el-select>
        </el-form-item>
        <el-form-item>
          <el-button type="primary" @click="reload">查询</el-button>
        </el-form-item>
      </el-form>

      <!-- 名单表格 -->
      <el-table v-loading="loading" :data="list" border empty-text="暂无学校，点击右上角新增">
        <el-table-column prop="id" label="ID" width="80" />
        <el-table-column prop="name" label="学校名称" min-width="200" />
        <el-table-column prop="domain" label="邮箱后缀" min-width="160" />
        <el-table-column prop="member_count" label="在册成员数" width="110" align="right" />
        <el-table-column label="状态" width="100">
          <template #default="{ row }">
            <el-tag :type="statusTagType(row.status)">{{ statusText(row.status) }}</el-tag>
          </template>
        </el-table-column>
        <el-table-column label="操作" width="160" fixed="right">
          <template #default="{ row }">
            <el-button link type="primary" @click="openEdit(row)">编辑</el-button>
            <el-button
              v-if="row.status !== 'offboarded'"
              link
              type="danger"
              @click="confirmDisable(row)"
            >停用</el-button>
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

    <!-- 新增/编辑对话框 -->
    <el-dialog
      v-model="dialogVisible"
      :title="editingId === null ? '新增学校' : '编辑学校'"
      width="480px"
      @closed="resetForm"
    >
      <el-form ref="formRef" :model="form" :rules="formRules" label-width="90px">
        <el-form-item label="学校名称" prop="name">
          <el-input v-model="form.name" maxlength="128" placeholder="学校全称" />
        </el-form-item>
        <el-form-item label="邮箱后缀" prop="domain">
          <el-input v-model="form.domain" maxlength="128" placeholder="如 @xxx.edu.cn" />
        </el-form-item>
        <el-form-item label="备注" prop="remark">
          <el-input v-model="form.remark" type="textarea" :rows="2" maxlength="255" />
        </el-form-item>
      </el-form>
      <template #footer>
        <el-button @click="dialogVisible = false">取消</el-button>
        <el-button type="primary" :loading="saving" @click="submitForm">保存</el-button>
      </template>
    </el-dialog>
  </div>
</template>

<script setup lang="ts">
import { onMounted, reactive, ref } from 'vue';
import { ElMessage, ElMessageBox } from 'element-plus';
import type { FormInstance, FormRules } from 'element-plus';
import {
  fetchSchools,
  createSchool,
  updateSchool,
  removeSchool,
} from '../../api/school';
import type { SchoolCreatePayload, SchoolItem, SchoolListQuery, SchoolStatus } from '../../api/school';

const query = reactive<SchoolListQuery>({ page: 1, pageSize: 20 });
const list = ref<SchoolItem[]>([]);
const total = ref(0);
const loading = ref(false);
const loadError = ref('');

async function loadList() {
  loading.value = true;
  loadError.value = '';
  try {
    const data = await fetchSchools(query);
    list.value = data.list;
    total.value = data.total;
  } catch (e) {
    loadError.value = (e as Error).message;
    ElMessage.error(loadError.value || '名单加载失败');
  } finally {
    loading.value = false;
  }
}

function reload() {
  query.page = 1;
  loadList();
}

const STATUS_TEXT: Record<SchoolStatus, string> = {
  active: '生效中',
  pending: '待开通',
  offboarded: '已停用',
};
const STATUS_TAG: Record<SchoolStatus, 'success' | 'warning' | 'info'> = {
  active: 'success',
  pending: 'warning',
  offboarded: 'info',
};

function statusText(s: SchoolStatus): string {
  return STATUS_TEXT[s];
}

function statusTagType(s: SchoolStatus): 'success' | 'warning' | 'info' {
  return STATUS_TAG[s];
}

// ---------- 新增/编辑 ----------
const dialogVisible = ref(false);
const saving = ref(false);
const editingId = ref<number | null>(null);
const formRef = ref<FormInstance>();
const form = reactive({ name: '', domain: '', remark: '' });

const formRules: FormRules = {
  name: [{ required: true, message: '请输入学校名称', trigger: 'blur' }],
  domain: [
    { required: true, message: '请输入校园邮箱后缀', trigger: 'blur' },
    {
      pattern: /^@?[A-Za-z0-9.-]+\.[A-Za-z]{2,}$/,
      message: '邮箱后缀格式不正确（如 @xxx.edu.cn）',
      trigger: 'blur',
    },
  ],
};

function openCreate() {
  editingId.value = null;
  dialogVisible.value = true;
}

function openEdit(row: SchoolItem) {
  editingId.value = row.id;
  form.name = row.name;
  form.domain = row.domain;
  form.remark = row.remark ?? '';
  dialogVisible.value = true;
}

function resetForm() {
  formRef.value?.resetFields();
  form.name = '';
  form.domain = '';
  form.remark = '';
}

async function submitForm() {
  const valid = await formRef.value?.validate().catch(() => false);
  if (!valid) return;
  saving.value = true;
  try {
    const payload: SchoolCreatePayload = { name: form.name, email_suffix: form.domain };
    if (form.remark.trim()) payload.remark = form.remark.trim();
    if (editingId.value === null) {
      await createSchool(payload); // #69
      ElMessage.success('新增成功，认证页学校列表将同步展示');
    } else {
      await updateSchool(editingId.value, payload); // #70
      ElMessage.success('保存成功');
    }
    dialogVisible.value = false;
    loadList();
  } catch (e) {
    ElMessage.error((e as Error).message || '保存失败');
  } finally {
    saving.value = false;
  }
}

// ---------- 停用（#71 软删除，留痕；存在在册成员时后端返回 4002） ----------
async function confirmDisable(row: SchoolItem) {
  try {
    await ElMessageBox.confirm(
      `确认停用「${row.name}」？停用后该校学生将无法完成认证；` +
        (row.member_count > 0 ? `该校当前有 ${row.member_count} 名在册成员，需先处置。` : ''),
      '停用确认',
      { type: 'warning', confirmButtonText: '确认停用', cancelButtonText: '取消' },
    );
  } catch {
    return; // 用户取消
  }
  try {
    await removeSchool(row.id); // #71
    ElMessage.success('已停用');
    loadList();
  } catch (e) {
    // 4002：存在在册成员需先处置
    ElMessage.error((e as Error).message || '停用失败');
  }
}

onMounted(loadList);
</script>

<style scoped>
.card-header {
  display: flex;
  justify-content: space-between;
  align-items: center;
}
</style>
