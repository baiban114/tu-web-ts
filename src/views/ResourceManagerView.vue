<script setup lang="ts">
import { computed, onMounted, reactive, ref } from 'vue';
import {
  createResourceItem,
  createResourceType,
  createResourceWork,
  deleteResourceItem,
  deleteResourceType,
  deleteResourceWork,
  listResourceItems,
  listResourceTypes,
  listResourceWorks,
  updateResourceItem,
  updateResourceType,
  updateResourceWork,
  type ResourceItem,
  type ResourceType,
  type ResourceWork,
} from '@/api/externalResource';

const activeTab = ref<'items' | 'works' | 'types'>('items');
const loading = ref(false);
const errorMessage = ref('');
const successMessage = ref('');
const selectedTypeId = ref('');
const selectedWorkId = ref('');

const types = ref<ResourceType[]>([]);
const works = ref<ResourceWork[]>([]);
const items = ref<ResourceItem[]>([]);

const typeForm = reactive({
  id: '',
  code: '',
  name: '',
  icon: '',
  description: '',
  identityFieldKey: '',
  identityFieldLabel: '',
});

const workForm = reactive({
  id: '',
  typeId: '',
  title: '',
  subtitle: '',
  description: '',
});

const itemForm = reactive({
  id: '',
  typeId: '',
  workId: '',
  title: '',
  identityValue: '',
  sourceUrl: '',
  edition: '',
  note: '',
});

const filteredWorks = computed(() => {
  if (!selectedTypeId.value) return works.value;
  return works.value.filter((work) => work.typeId === selectedTypeId.value);
});

const itemFormType = computed(() => types.value.find((type) => type.id === itemForm.typeId));

function resetTypeForm() {
  Object.assign(typeForm, {
    id: '',
    code: '',
    name: '',
    icon: '',
    description: '',
    identityFieldKey: '',
    identityFieldLabel: '',
  });
}

function resetWorkForm() {
  Object.assign(workForm, {
    id: '',
    typeId: selectedTypeId.value || types.value[0]?.id || '',
    title: '',
    subtitle: '',
    description: '',
  });
}

function resetItemForm() {
  const typeId = selectedTypeId.value || types.value[0]?.id || '';
  const workId = selectedWorkId.value || works.value.find((work) => work.typeId === typeId)?.id || '';
  Object.assign(itemForm, {
    id: '',
    typeId,
    workId,
    title: '',
    identityValue: '',
    sourceUrl: '',
    edition: '',
    note: '',
  });
}

function showError(error: unknown) {
  errorMessage.value = error instanceof Error ? error.message : 'Request failed';
  successMessage.value = '';
}

function showSuccess(message: string) {
  successMessage.value = message;
  errorMessage.value = '';
}

async function refreshAll() {
  loading.value = true;
  errorMessage.value = '';
  try {
    types.value = await listResourceTypes();
    works.value = await listResourceWorks();
    items.value = await listResourceItems({
      typeId: selectedTypeId.value,
      workId: selectedWorkId.value,
    });
    if (!workForm.typeId) resetWorkForm();
    if (!itemForm.typeId) resetItemForm();
  } catch (error) {
    showError(error);
  } finally {
    loading.value = false;
  }
}

async function refreshItems() {
  loading.value = true;
  try {
    items.value = await listResourceItems({
      typeId: selectedTypeId.value,
      workId: selectedWorkId.value,
    });
  } catch (error) {
    showError(error);
  } finally {
    loading.value = false;
  }
}

async function saveType() {
  try {
    if (typeForm.id) {
      await updateResourceType(typeForm.id, {
        name: typeForm.name,
        icon: typeForm.icon,
        description: typeForm.description,
        identityFieldKey: typeForm.identityFieldKey,
        identityFieldLabel: typeForm.identityFieldLabel,
      });
      showSuccess('资源类型已更新');
    } else {
      await createResourceType({
        code: typeForm.code,
        name: typeForm.name,
        icon: typeForm.icon,
        description: typeForm.description,
        identityFieldKey: typeForm.identityFieldKey,
        identityFieldLabel: typeForm.identityFieldLabel,
      });
      showSuccess('资源类型已创建');
    }
    resetTypeForm();
    await refreshAll();
  } catch (error) {
    showError(error);
  }
}

async function saveWork() {
  try {
    if (workForm.id) {
      await updateResourceWork(workForm.id, { ...workForm });
      showSuccess('资源归类已更新');
    } else {
      await createResourceWork({ ...workForm });
      showSuccess('资源归类已创建');
    }
    resetWorkForm();
    await refreshAll();
  } catch (error) {
    showError(error);
  }
}

async function saveItem() {
  try {
    if (itemForm.id) {
      await updateResourceItem(itemForm.id, { ...itemForm });
      showSuccess('资源实体已更新');
    } else {
      await createResourceItem({ ...itemForm });
      showSuccess('资源实体已创建');
    }
    resetItemForm();
    await refreshAll();
  } catch (error) {
    showError(error);
  }
}

function editType(type: ResourceType) {
  Object.assign(typeForm, type);
  activeTab.value = 'types';
}

function editWork(work: ResourceWork) {
  Object.assign(workForm, {
    id: work.id,
    typeId: work.typeId,
    title: work.title,
    subtitle: work.subtitle || '',
    description: work.description || '',
  });
  activeTab.value = 'works';
}

function editItem(item: ResourceItem) {
  Object.assign(itemForm, {
    id: item.id,
    typeId: item.typeId,
    workId: item.workId,
    title: item.title,
    identityValue: item.identityValue,
    sourceUrl: item.sourceUrl || '',
    edition: item.edition || '',
    note: item.note || '',
  });
  activeTab.value = 'items';
}

async function removeType(id: string) {
  try {
    await deleteResourceType(id);
    showSuccess('资源类型已删除');
    await refreshAll();
  } catch (error) {
    showError(error);
  }
}

async function removeWork(id: string) {
  try {
    await deleteResourceWork(id);
    showSuccess('资源归类已删除');
    await refreshAll();
  } catch (error) {
    showError(error);
  }
}

async function removeItem(id: string) {
  try {
    await deleteResourceItem(id);
    showSuccess('资源实体已删除');
    await refreshAll();
  } catch (error) {
    showError(error);
  }
}

function onTypeFilterChange() {
  selectedWorkId.value = '';
  resetWorkForm();
  resetItemForm();
  refreshItems();
}

onMounted(refreshAll);
</script>

<template>
  <main class="resource-page">
    <header class="resource-header">
      <div>
        <h1>外部资源</h1>
        <p>管理图书、图片、视频等外部资源的类型、归类和具体实体。</p>
      </div>
      <RouterLink class="back-link" to="/">返回工作区</RouterLink>
    </header>

    <section class="resource-filters">
      <label>
        类型
        <select v-model="selectedTypeId" @change="onTypeFilterChange">
          <option value="">全部类型</option>
          <option v-for="type in types" :key="type.id" :value="type.id">
            {{ type.icon || '·' }} {{ type.name }}
          </option>
        </select>
      </label>
      <label>
        归类
        <select v-model="selectedWorkId" @change="refreshItems">
          <option value="">全部归类</option>
          <option v-for="work in filteredWorks" :key="work.id" :value="work.id">
            {{ work.title }}
          </option>
        </select>
      </label>
    </section>

    <div v-if="errorMessage" class="message message--error">{{ errorMessage }}</div>
    <div v-if="successMessage" class="message message--success">{{ successMessage }}</div>

    <nav class="resource-tabs">
      <button :class="{ active: activeTab === 'items' }" @click="activeTab = 'items'">资源实体</button>
      <button :class="{ active: activeTab === 'works' }" @click="activeTab = 'works'">资源归类</button>
      <button :class="{ active: activeTab === 'types' }" @click="activeTab = 'types'">资源类型</button>
    </nav>

    <section v-if="activeTab === 'items'" class="resource-layout">
      <form class="resource-form" @submit.prevent="saveItem">
        <h2>{{ itemForm.id ? '编辑资源实体' : '新增资源实体' }}</h2>
        <label>
          类型
          <select v-model="itemForm.typeId" required @change="itemForm.workId = ''">
            <option value="" disabled>选择类型</option>
            <option v-for="type in types" :key="type.id" :value="type.id">{{ type.name }}</option>
          </select>
        </label>
        <label>
          归类 Work
          <select v-model="itemForm.workId" required>
            <option value="" disabled>选择归类</option>
            <option
              v-for="work in works.filter((work) => work.typeId === itemForm.typeId)"
              :key="work.id"
              :value="work.id"
            >
              {{ work.title }}
            </option>
          </select>
        </label>
        <label>
          标题
          <input v-model.trim="itemForm.title" required maxlength="255" />
        </label>
        <label>
          {{ itemFormType?.identityFieldLabel || '唯一标识' }}
          <input v-model.trim="itemForm.identityValue" required maxlength="512" />
        </label>
        <label>
          源 URL
          <input v-model.trim="itemForm.sourceUrl" maxlength="1024" />
        </label>
        <label>
          版本/发行
          <input v-model.trim="itemForm.edition" maxlength="128" />
        </label>
        <label>
          备注
          <textarea v-model.trim="itemForm.note" maxlength="1024" rows="4" />
        </label>
        <div class="form-actions">
          <button type="submit">{{ itemForm.id ? '保存实体' : '创建实体' }}</button>
          <button type="button" class="secondary" @click="resetItemForm">清空</button>
        </div>
      </form>

      <div class="resource-list" :aria-busy="loading">
        <article v-for="item in items" :key="item.id" class="resource-row">
          <div>
            <div class="row-title">{{ item.title }}</div>
            <div class="row-meta">{{ item.typeName }} · {{ item.identityFieldLabel }}: {{ item.identityValue }}</div>
            <div class="row-meta">归类：{{ item.workTitle }}</div>
            <a v-if="item.sourceUrl" :href="item.sourceUrl" target="_blank" rel="noreferrer">{{ item.sourceUrl }}</a>
          </div>
          <div class="row-actions">
            <button @click="editItem(item)">编辑</button>
            <button class="danger" @click="removeItem(item.id)">删除</button>
          </div>
        </article>
        <p v-if="!items.length && !loading" class="empty">暂无资源实体</p>
      </div>
    </section>

    <section v-if="activeTab === 'works'" class="resource-layout">
      <form class="resource-form" @submit.prevent="saveWork">
        <h2>{{ workForm.id ? '编辑资源归类' : '新增资源归类' }}</h2>
        <label>
          类型
          <select v-model="workForm.typeId" required>
            <option value="" disabled>选择类型</option>
            <option v-for="type in types" :key="type.id" :value="type.id">{{ type.name }}</option>
          </select>
        </label>
        <label>
          标题
          <input v-model.trim="workForm.title" required maxlength="255" />
        </label>
        <label>
          副标题
          <input v-model.trim="workForm.subtitle" maxlength="255" />
        </label>
        <label>
          描述
          <textarea v-model.trim="workForm.description" maxlength="1024" rows="4" />
        </label>
        <div class="form-actions">
          <button type="submit">{{ workForm.id ? '保存归类' : '创建归类' }}</button>
          <button type="button" class="secondary" @click="resetWorkForm">清空</button>
        </div>
      </form>

      <div class="resource-list">
        <article v-for="work in filteredWorks" :key="work.id" class="resource-row">
          <div>
            <div class="row-title">{{ work.title }}</div>
            <div class="row-meta">{{ work.typeName }}<span v-if="work.subtitle"> · {{ work.subtitle }}</span></div>
            <p v-if="work.description">{{ work.description }}</p>
          </div>
          <div class="row-actions">
            <button @click="editWork(work)">编辑</button>
            <button class="danger" @click="removeWork(work.id)">删除</button>
          </div>
        </article>
        <p v-if="!filteredWorks.length" class="empty">暂无资源归类</p>
      </div>
    </section>

    <section v-if="activeTab === 'types'" class="resource-layout">
      <form class="resource-form" @submit.prevent="saveType">
        <h2>{{ typeForm.id ? '编辑资源类型' : '新增资源类型' }}</h2>
        <label>
          代码
          <input v-model.trim="typeForm.code" required maxlength="64" :disabled="Boolean(typeForm.id)" placeholder="book" />
        </label>
        <label>
          名称
          <input v-model.trim="typeForm.name" required maxlength="128" placeholder="图书" />
        </label>
        <label>
          图标
          <input v-model.trim="typeForm.icon" maxlength="32" placeholder="📚" />
        </label>
        <label>
          主标识字段
          <input v-model.trim="typeForm.identityFieldKey" required maxlength="64" placeholder="isbn" />
        </label>
        <label>
          主标识名称
          <input v-model.trim="typeForm.identityFieldLabel" required maxlength="128" placeholder="ISBN" />
        </label>
        <label>
          描述
          <textarea v-model.trim="typeForm.description" maxlength="255" rows="3" />
        </label>
        <div class="form-actions">
          <button type="submit">{{ typeForm.id ? '保存类型' : '创建类型' }}</button>
          <button type="button" class="secondary" @click="resetTypeForm">清空</button>
        </div>
      </form>

      <div class="resource-list">
        <article v-for="type in types" :key="type.id" class="resource-row">
          <div>
            <div class="row-title">{{ type.icon }} {{ type.name }}</div>
            <div class="row-meta">{{ type.code }} · {{ type.identityFieldLabel }} ({{ type.identityFieldKey }})</div>
            <p v-if="type.description">{{ type.description }}</p>
          </div>
          <div class="row-actions">
            <button @click="editType(type)">编辑</button>
            <button class="danger" @click="removeType(type.id)">删除</button>
          </div>
        </article>
        <p v-if="!types.length" class="empty">暂无资源类型</p>
      </div>
    </section>
  </main>
</template>

<style scoped>
.resource-page {
  min-height: 100vh;
  padding: 24px 32px 40px;
  background: #f6f7f9;
  color: #1f2933;
}

.resource-header {
  display: flex;
  align-items: flex-start;
  justify-content: space-between;
  gap: 20px;
  margin-bottom: 20px;
}

.resource-header h1 {
  margin: 0 0 6px;
  font-size: 28px;
}

.resource-header p,
.row-meta,
.empty {
  color: #667085;
}

.back-link,
button {
  border: 1px solid #cfd7e3;
  border-radius: 6px;
  background: #fff;
  color: #1f2933;
  cursor: pointer;
  text-decoration: none;
}

.back-link {
  padding: 8px 12px;
}

.resource-filters,
.resource-tabs,
.message {
  margin-bottom: 16px;
}

.resource-filters {
  display: flex;
  gap: 16px;
  flex-wrap: wrap;
}

label {
  display: flex;
  flex-direction: column;
  gap: 6px;
  font-size: 13px;
  font-weight: 600;
}

input,
select,
textarea {
  min-width: 220px;
  border: 1px solid #cfd7e3;
  border-radius: 6px;
  padding: 8px 10px;
  font: inherit;
  background: #fff;
}

textarea {
  resize: vertical;
}

.message {
  padding: 10px 12px;
  border-radius: 6px;
}

.message--error {
  border: 1px solid #fecdca;
  background: #fffbfa;
  color: #b42318;
}

.message--success {
  border: 1px solid #abefc6;
  background: #f6fef9;
  color: #067647;
}

.resource-tabs {
  display: flex;
  gap: 8px;
}

.resource-tabs button,
.form-actions button,
.row-actions button {
  padding: 8px 12px;
}

.resource-tabs .active,
.form-actions button[type='submit'] {
  border-color: #1677ff;
  background: #1677ff;
  color: #fff;
}

.resource-layout {
  display: grid;
  grid-template-columns: minmax(280px, 360px) minmax(0, 1fr);
  gap: 20px;
  align-items: start;
}

.resource-form,
.resource-list {
  border: 1px solid #e4e7ec;
  border-radius: 8px;
  background: #fff;
}

.resource-form {
  display: flex;
  flex-direction: column;
  gap: 14px;
  padding: 18px;
}

.resource-form h2 {
  margin: 0;
  font-size: 18px;
}

.resource-form input,
.resource-form select,
.resource-form textarea {
  min-width: 0;
  width: 100%;
}

.form-actions,
.row-actions {
  display: flex;
  gap: 8px;
  flex-wrap: wrap;
}

.secondary {
  background: #f8fafc;
}

.danger {
  border-color: #fecdca;
  color: #b42318;
}

.resource-list {
  overflow: hidden;
}

.resource-row {
  display: flex;
  justify-content: space-between;
  gap: 16px;
  padding: 16px;
  border-bottom: 1px solid #edf0f5;
}

.resource-row:last-child {
  border-bottom: 0;
}

.row-title {
  font-weight: 700;
  margin-bottom: 4px;
}

.resource-row p {
  margin: 8px 0 0;
}

.resource-row a {
  display: inline-block;
  max-width: 720px;
  margin-top: 6px;
  color: #0969da;
  word-break: break-all;
}

.empty {
  margin: 0;
  padding: 24px;
}

@media (max-width: 860px) {
  .resource-page {
    padding: 18px;
  }

  .resource-header,
  .resource-row {
    flex-direction: column;
  }

  .resource-layout {
    grid-template-columns: 1fr;
  }
}
</style>
