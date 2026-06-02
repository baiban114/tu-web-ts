<script setup lang="ts">
import { computed, onMounted, reactive, ref, watch } from 'vue';
import { useRoute, useRouter } from 'vue-router';
import {
  createResourceItem,
  createResourceExcerpt,
  createResourceType,
  createResourceWork,
  deleteResourceItem,
  deleteResourceExcerpt,
  deleteResourceType,
  deleteResourceWork,
  listResourceExcerpts,
  listResourceItems,
  listResourceTypes,
  listResourceWorks,
  updateResourceExcerpt,
  updateResourceItem,
  updateResourceType,
  updateResourceWork,
  type ResourceExcerpt,
  type ResourceItem,
  type ResourceType,
  type ResourceWork,
} from '@/api/externalResource';
import {
  listReferences,
  rebuildReferences,
  updateExternalReference,
  deleteAnnotationReference,
  type ReferenceItem,
} from '@/api/reference';
import { useObjectModelStore } from '@/stores/objectModel';

type ResourceTab = 'references' | 'items' | 'works' | 'types' | 'objects';
type ReferenceCategoryFilter = 'all' | 'internal' | 'external' | 'annotation';
type ReferenceStatusFilter = 'all' | 'ok' | 'broken' | 'bound' | 'unbound';

const route = useRoute();
const router = useRouter();
const resourceTabs = new Set<ResourceTab>(['references', 'items', 'works', 'types', 'objects']);

function getRouteTab(): ResourceTab {
  const tab = route.query.tab;
  return typeof tab === 'string' && resourceTabs.has(tab as ResourceTab) ? tab as ResourceTab : 'references';
}

const activeTab = ref<ResourceTab>(getRouteTab());
const loading = ref(false);
const referencesLoading = ref(false);
const excerptsLoading = ref(false);
const errorMessage = ref('');
const successMessage = ref('');
const selectedTypeId = ref('');
const selectedWorkId = ref('');
const selectedExcerptItemId = ref('');
const selectedReferenceCategory = ref<ReferenceCategoryFilter>('all');
const selectedReferenceStatus = ref<ReferenceStatusFilter>('all');
const referenceKeyword = ref('');
const selectedReferenceResourceItemId = ref('');
const currentPage = ref(0);
const pageSize = ref(50);
const totalReferences = ref(0);

const types = ref<ResourceType[]>([]);
const works = ref<ResourceWork[]>([]);
const items = ref<ResourceItem[]>([]);
const excerpts = ref<ResourceExcerpt[]>([]);
const references = ref<ReferenceItem[]>([]);
const objectModelStore = useObjectModelStore();
const selectedClassId = ref('');
const selectedObjectId = ref('');

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

const excerptForm = reactive({
  id: '',
  title: '',
  locator: '',
  excerptText: '',
  note: '',
  sortOrder: 0,
});

const classForm = reactive({
  id: '',
  name: '',
  attributes: '',
  methods: '',
});

const objectForm = reactive({
  id: '',
  name: '',
  classId: '',
  propertyValues: '{}',
});

const referenceForm = reactive({
  id: '',
  resourceItemId: '',
  bindingMode: 'auto' as 'auto' | 'manual_bound' | 'manual_unbound',
  displayText: '',
  citationLocator: '',
  citationNote: '',
});

const filteredWorks = computed(() => {
  if (!selectedTypeId.value) return works.value;
  return works.value.filter((work) => work.typeId === selectedTypeId.value);
});

const itemFormType = computed(() => types.value.find((type) => type.id === itemForm.typeId));
const typeById = computed(() => new Map(types.value.map((type) => [type.id, type])));
const selectedExcerptItem = computed(() => items.value.find((item) => item.id === selectedExcerptItemId.value) || null);
const classNameById = computed(() => new Map(objectModelStore.classes.map((item) => [item.id, item.name])));
const editableExternalReferences = computed(() => references.value.filter((item) => item.category === 'external'));

function splitLines(value: string): string[] {
  return value
    .split('\n')
    .map((line) => line.trim())
    .filter(Boolean);
}

function parseObjectValues(raw: string): Record<string, string> {
  try {
    const parsed = JSON.parse(raw);
    return Object.prototype.toString.call(parsed) === '[object Object]' ? parsed as Record<string, string> : {};
  } catch {
    return {};
  }
}

function normalizeText(value: string | null | undefined): string {
  return value?.trim() || '';
}

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
  const workId = selectedWorkId.value || '';
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

function resetExcerptForm() {
  Object.assign(excerptForm, {
    id: '',
    title: '',
    locator: '',
    excerptText: '',
    note: '',
    sortOrder: excerpts.value.length,
  });
}

function clearExcerptPanel() {
  selectedExcerptItemId.value = '';
  excerpts.value = [];
  resetExcerptForm();
}

function resetClassForm() {
  selectedClassId.value = '';
  Object.assign(classForm, {
    id: '',
    name: '',
    attributes: '',
    methods: '',
  });
}

function resetObjectForm() {
  selectedObjectId.value = '';
  Object.assign(objectForm, {
    id: '',
    name: '',
    classId: selectedClassId.value || objectModelStore.classes[0]?.id || '',
    propertyValues: '{}',
  });
}

function resetReferenceForm() {
  Object.assign(referenceForm, {
    id: '',
    resourceItemId: '',
    bindingMode: 'auto',
    displayText: '',
    citationLocator: '',
    citationNote: '',
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
    if (selectedExcerptItemId.value && !items.value.some((item) => item.id === selectedExcerptItemId.value)) {
      clearExcerptPanel();
    }
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
    if (selectedExcerptItemId.value && !items.value.some((item) => item.id === selectedExcerptItemId.value)) {
      clearExcerptPanel();
    }
  } catch (error) {
    showError(error);
  } finally {
    loading.value = false;
  }
}

function isBookItem(item: ResourceItem): boolean {
  return typeById.value.get(item.typeId)?.code === 'book';
}

async function loadExcerpts(resourceItemId: string) {
  if (!resourceItemId) {
    excerpts.value = [];
    resetExcerptForm();
    return;
  }
  excerptsLoading.value = true;
  try {
    excerpts.value = await listResourceExcerpts(resourceItemId);
    resetExcerptForm();
  } catch (error) {
    showError(error);
  } finally {
    excerptsLoading.value = false;
  }
}

async function selectExcerptItem(item: ResourceItem) {
  if (!isBookItem(item)) return;
  selectedExcerptItemId.value = item.id;
  await loadExcerpts(item.id);
}

async function refreshReferences() {
  referencesLoading.value = true;
  try {
    const result = await listReferences({
      category: selectedReferenceCategory.value === 'all' ? undefined : selectedReferenceCategory.value,
      resourceItemId: selectedReferenceResourceItemId.value || undefined,
      status: selectedReferenceStatus.value === 'all' ? undefined : selectedReferenceStatus.value,
      q: referenceKeyword.value.trim() || undefined,
      page: currentPage.value,
      pageSize: pageSize.value,
    });
    if (Array.isArray(result)) {
      references.value = result;
      totalReferences.value = result.length;
    } else {
      references.value = result.items ?? [];
      totalReferences.value = result.total ?? 0;
    }
  } catch (error) {
    showError(error);
  } finally {
    referencesLoading.value = false;
  }
}

function onReferenceFilterChange() {
  currentPage.value = 0;
  void refreshReferences();
}

function goToPage(page: number) {
  currentPage.value = page;
  void refreshReferences();
}

const totalPages = computed(() => Math.max(1, Math.ceil(totalReferences.value / pageSize.value)));

const displayedPages = computed(() => {
  const total = totalPages.value;
  const current = currentPage.value;
  const range: (number | null)[] = [];
  if (total <= 7) {
    for (let i = 0; i < total; i++) range.push(i);
    return range;
  }
  range.push(0);
  if (current > 2) range.push(null);
  const start = Math.max(1, current - 1);
  const end = Math.min(total - 2, current + 1);
  for (let i = start; i <= end; i++) range.push(i);
  if (current < total - 3) range.push(null);
  range.push(total - 1);
  return range;
});

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

async function saveExcerpt() {
  if (!selectedExcerptItem.value) return;
  try {
    const payload = {
      title: excerptForm.title,
      locator: excerptForm.locator,
      excerptText: excerptForm.excerptText,
      note: excerptForm.note,
      sortOrder: Number.isFinite(excerptForm.sortOrder) ? excerptForm.sortOrder : excerpts.value.length,
    };
    if (excerptForm.id) {
      await updateResourceExcerpt(excerptForm.id, payload);
      showSuccess('图书节选已更新');
    } else {
      await createResourceExcerpt(selectedExcerptItem.value.id, payload);
      showSuccess('图书节选已创建');
    }
    await loadExcerpts(selectedExcerptItem.value.id);
    await refreshReferences();
  } catch (error) {
    showError(error);
  }
}

async function saveReference() {
  try {
    if (!referenceForm.id) return;
    await updateExternalReference(referenceForm.id, {
      resourceItemId: referenceForm.bindingMode === 'manual_bound' ? referenceForm.resourceItemId || null : null,
      bindingMode: referenceForm.bindingMode,
      displayText: referenceForm.displayText,
      citationLocator: referenceForm.citationLocator,
      citationNote: referenceForm.citationNote,
    });
    showSuccess('引用元数据已更新');
    resetReferenceForm();
    await refreshReferences();
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
    workId: item.workId || '',
    title: item.title,
    identityValue: item.identityValue || '',
    sourceUrl: item.sourceUrl || '',
    edition: item.edition || '',
    note: item.note || '',
  });
  activeTab.value = 'items';
}

function editExcerpt(excerpt: ResourceExcerpt) {
  Object.assign(excerptForm, {
    id: excerpt.id,
    title: excerpt.title,
    locator: excerpt.locator || '',
    excerptText: excerpt.excerptText,
    note: excerpt.note || '',
    sortOrder: excerpt.sortOrder ?? 0,
  });
}

function editReference(item: ReferenceItem) {
  if (item.category !== 'external') return;
  Object.assign(referenceForm, {
    id: item.id,
    resourceItemId: item.target.resourceItemId || '',
    bindingMode: item.status === 'unbound'
      ? 'manual_unbound'
      : item.target.resourceItemId
        ? 'manual_bound'
        : 'auto',
    displayText: item.citation.displayText || '',
    citationLocator: item.citation.locator || '',
    citationNote: item.citation.note || '',
  });
}

async function setReferenceBinding(item: ReferenceItem, bindingMode: 'auto' | 'manual_unbound') {
  try {
    await updateExternalReference(item.id, {
      resourceItemId: null,
      bindingMode,
      displayText: item.citation.displayText || '',
      citationLocator: item.citation.locator || '',
      citationNote: item.citation.note || '',
    });
    showSuccess(bindingMode === 'auto' ? '已恢复自动匹配' : '已解绑引用');
    await refreshReferences();
  } catch (error) {
    showError(error);
  }
}

async function rebuildReferenceIndex() {
  try {
    referencesLoading.value = true;
    await rebuildReferences();
    showSuccess('引用索引已重建');
    await refreshAll();
    await refreshReferences();
  } catch (error) {
    showError(error);
  } finally {
    referencesLoading.value = false;
  }
}

function saveClass() {
  const definition = objectModelStore.upsertClass({
    id: classForm.id || undefined,
    name: classForm.name,
    attributes: splitLines(classForm.attributes),
    methods: splitLines(classForm.methods),
  });
  selectedClassId.value = definition.id;
  resetClassForm();
  showSuccess('类定义已保存，可在 X6 类图中同步。');
}

function editClass(id: string) {
  const definition = objectModelStore.classes.find((item) => item.id === id);
  if (!definition) return;
  selectedClassId.value = id;
  Object.assign(classForm, {
    id: definition.id,
    name: definition.name,
    attributes: definition.attributes.join('\n'),
    methods: definition.methods.join('\n'),
  });
  if (!objectForm.classId) objectForm.classId = id;
}

function removeClass(id: string) {
  objectModelStore.deleteClass(id);
  if (selectedClassId.value === id) resetClassForm();
  if (objectForm.classId === id) resetObjectForm();
  showSuccess('类定义已删除。');
}

function saveObject() {
  objectModelStore.upsertObject({
    id: objectForm.id || undefined,
    name: objectForm.name,
    classId: objectForm.classId,
    propertyValues: parseObjectValues(objectForm.propertyValues),
  });
  resetObjectForm();
  showSuccess('对象实例已保存，可随类图数据同步。');
}

function editObject(id: string) {
  const objectDefinition = objectModelStore.objects.find((item) => item.id === id);
  if (!objectDefinition) return;
  selectedObjectId.value = id;
  Object.assign(objectForm, {
    id: objectDefinition.id,
    name: objectDefinition.name,
    classId: objectDefinition.classId,
    propertyValues: JSON.stringify(objectDefinition.propertyValues, null, 2),
  });
}

function removeObject(id: string) {
  objectModelStore.deleteObject(id);
  if (selectedObjectId.value === id) resetObjectForm();
  showSuccess('对象实例已删除。');
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
    if (selectedExcerptItemId.value === id) {
      clearExcerptPanel();
    }
    await refreshAll();
    await refreshReferences();
  } catch (error) {
    showError(error);
  }
}

async function removeExcerpt(excerpt: ResourceExcerpt) {
  if (!confirm(`确定删除节选「${excerpt.title}」？`)) return;
  try {
    await deleteResourceExcerpt(excerpt.id);
    showSuccess('图书节选已删除');
    if (selectedExcerptItem.value) {
      await loadExcerpts(selectedExcerptItem.value.id);
    }
    await refreshReferences();
  } catch (error) {
    showError(error);
  }
}

function onTypeFilterChange() {
  selectedWorkId.value = '';
  clearExcerptPanel();
  resetWorkForm();
  resetItemForm();
  void refreshItems();
}

function goToReferenceSource(item: ReferenceItem) {
  void router.push({
    path: '/',
    query: {
      pageId: item.source.pageId,
      blockId: item.source.blockId,
    },
  });
}

function categoryLabel(category: string): string {
  return (
    {
      annotation: '标注',
      internal: '内部引用',
      external: '外部引用',
    }[category] || category
  );
}

async function deleteAnnotation(item: ReferenceItem) {
  if (!confirm(`确定删除标注「${item.target.blockPreview || item.target.resourceItemTitle}」？`)) return;
  try {
    await deleteAnnotationReference(item.source.pageId, item.source.blockId, item.source.sourceLocator);
    showSuccess('标注已删除');
    await refreshReferences();
  } catch (error) {
    showError(error);
  }
}

function setActiveTab(tab: ResourceTab) {
  activeTab.value = tab;
  void router.replace({
    path: route.path,
    query: {
      ...route.query,
      tab,
    },
  });
}

onMounted(async () => {
  await refreshAll();
  await refreshReferences();
});

watch(
  () => route.query.tab,
  () => {
    activeTab.value = getRouteTab();
  },
);
</script>

<template>
  <main class="resource-page">
    <header class="resource-header">
      <div>
        <h1>引用与外部资源</h1>
        <p>统一查看页面内部引用、外部链接引用，以及资源类型、归类和具体实体。</p>
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
      <button :class="{ active: activeTab === 'references' }" @click="setActiveTab('references')">引用管理</button>
      <button :class="{ active: activeTab === 'items' }" @click="setActiveTab('items')">资源实体</button>
      <button :class="{ active: activeTab === 'works' }" @click="setActiveTab('works')">资源归类</button>
      <button :class="{ active: activeTab === 'types' }" @click="setActiveTab('types')">资源类型</button>
      <button :class="{ active: activeTab === 'objects' }" @click="setActiveTab('objects')">对象管理</button>
    </nav>

    <section v-if="activeTab === 'references'" class="resource-layout reference-layout">
      <form class="resource-form" @submit.prevent="saveReference">
        <h2>{{ referenceForm.id ? '编辑外部引用' : '引用详情' }}</h2>
        <label>
          引用类别
          <select v-model="selectedReferenceCategory" @change="onReferenceFilterChange">
            <option value="all">全部</option>
            <option value="annotation">标注引用</option>
            <option value="internal">内部引用</option>
            <option value="external">外部引用</option>
          </select>
        </label>
        <label>
          引用状态
          <select v-model="selectedReferenceStatus" @change="onReferenceFilterChange">
            <option value="all">全部</option>
            <option value="ok">正常</option>
            <option value="broken">失效</option>
            <option value="bound">已绑定</option>
            <option value="unbound">未绑定</option>
          </select>
        </label>
        <label>
          关联资源实体
          <select v-model="selectedReferenceResourceItemId" @change="onReferenceFilterChange">
            <option value="">全部资源实体</option>
            <option v-for="item in items" :key="item.id" :value="item.id">
              {{ item.title }}
            </option>
          </select>
        </label>
        <label>
          关键字
          <input v-model.trim="referenceKeyword" maxlength="200" placeholder="页面、块、资源标题、URL" />
        </label>
        <div class="form-actions">
          <button type="button" @click="onReferenceFilterChange">查询</button>
          <button type="button" class="secondary" @click="rebuildReferenceIndex">重建索引</button>
        </div>

        <template v-if="referenceForm.id">
          <hr class="form-divider" />
          <label>
            绑定方式
            <select v-model="referenceForm.bindingMode">
              <option value="auto">自动匹配</option>
              <option value="manual_bound">手动绑定</option>
              <option value="manual_unbound">手动解绑</option>
            </select>
          </label>
          <label>
            资源实体
            <select v-model="referenceForm.resourceItemId" :disabled="referenceForm.bindingMode !== 'manual_bound'">
              <option value="">选择资源实体</option>
              <option v-for="item in items" :key="item.id" :value="item.id">
                {{ item.title }}
              </option>
            </select>
          </label>
          <label>
            显示文案
            <input v-model.trim="referenceForm.displayText" maxlength="255" />
          </label>
          <label>
            页码/定位
            <input v-model.trim="referenceForm.citationLocator" maxlength="255" placeholder="p. 18" />
          </label>
          <label>
            引用说明
            <textarea v-model.trim="referenceForm.citationNote" rows="4" maxlength="1024" />
          </label>
          <div class="form-actions">
            <button type="submit">保存引用</button>
            <button type="button" class="secondary" @click="resetReferenceForm">清空</button>
          </div>
        </template>
      </form>

      <div class="resource-list" :aria-busy="referencesLoading">
        <div class="resource-list__scroll">
          <article v-for="item in references" :key="item.id" class="resource-row">
            <div class="reference-row__content">
              <div class="row-title">
                <span class="reference-badge" :class="`reference-badge--${item.category}`">{{ categoryLabel(item.category) }}</span>
                <span class="reference-status" :class="`reference-status--${item.status}`">{{ item.status }}</span>
              </div>
              <div class="row-meta">
                来源：
                <template v-if="item.category === 'annotation'">
                  {{ item.source.pageTitle }} · {{ item.target.blockPreview || item.target.resourceItemTitle }}
                </template>
                <template v-else>
                  页面 {{ item.source.pageTitle }} · 块 {{ item.source.blockId }} · {{ item.source.sourceKind }}
                </template>
              </div>
              <div class="row-meta">
                目标：
                <template v-if="item.category === 'internal'">
                  {{ item.target.kind }} {{ item.target.pageTitle || item.target.pageId || item.target.blockId }}
                </template>
                <template v-else-if="item.category === 'annotation'">
                  {{ item.citation.note || '(无备注)' }}
                </template>
                <template v-else>
                  {{ item.target.resourceItemTitle || '未绑定资源' }}
                  <span v-if="item.target.resourceTypeName"> · {{ item.target.resourceTypeName }}</span>
                  <span v-if="item.target.resourceExcerptTitle"> · 节选：{{ item.target.resourceExcerptTitle }}</span>
                  <span v-if="item.target.resourceExcerptLocator"> · {{ item.target.resourceExcerptLocator }}</span>
                </template>
              </div>
              <p v-if="item.target.url" class="reference-url">{{ item.target.url }}</p>
              <p v-if="item.target.blockPreview && item.category !== 'annotation'" class="reference-preview">{{ item.target.blockPreview }}</p>
              <p v-if="item.citation.displayText || item.citation.locator || item.citation.note" class="reference-preview">
                {{ item.citation.displayText || '未设置显示文案' }}
                <span v-if="item.citation.locator"> · {{ item.citation.locator }}</span>
                <span v-if="item.citation.note"> · {{ item.citation.note }}</span>
              </p>
            </div>
            <div class="row-actions">
              <button @click="goToReferenceSource(item)">打开来源</button>
              <button v-if="item.editable && item.category !== 'annotation'" @click="editReference(item)">编辑</button>
              <button v-if="item.editable && item.category !== 'annotation'" class="secondary" @click="setReferenceBinding(item, 'auto')">自动匹配</button>
              <button v-if="item.editable && item.category !== 'annotation'" class="danger" @click="setReferenceBinding(item, 'manual_unbound')">解绑</button>
              <button v-if="item.editable && item.category === 'annotation'" class="danger" @click="deleteAnnotation(item)">删除</button>
            </div>
          </article>
          <p v-if="!references.length && !referencesLoading" class="empty">暂无引用记录</p>
        </div>
        <div v-if="!referencesLoading && references.length" class="resource-list__pagination">
          <span class="pagination-info">共 {{ totalReferences }} 条</span>
          <span class="pagination-separator">|</span>
          <button :disabled="currentPage <= 0" @click="goToPage(0)" title="首页">&laquo;</button>
          <button :disabled="currentPage <= 0" @click="goToPage(currentPage - 1)" title="上一页">&lsaquo;</button>
          <template v-if="totalPages > 1" v-for="p in displayedPages" :key="p">
            <button
              v-if="p !== null"
              :class="{ active: p === currentPage }"
              @click="goToPage(p)"
            >{{ p + 1 }}</button>
            <span v-else class="pagination-ellipsis">…</span>
          </template>
          <button :disabled="currentPage >= totalPages - 1" @click="goToPage(currentPage + 1)" title="下一页">&rsaquo;</button>
          <button :disabled="currentPage >= totalPages - 1" @click="goToPage(totalPages - 1)" title="末页">&raquo;</button>
          <span class="pagination-page">{{ currentPage + 1 }}/{{ totalPages }}</span>
        </div>
      </div>
    </section>

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
          <select v-model="itemForm.workId">
            <option value="">不选择归类</option>
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
          <input v-model.trim="itemForm.identityValue" maxlength="512" />
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

      <div class="resource-items-panel">
        <div class="resource-list" :aria-busy="loading">
          <article v-for="item in items" :key="item.id" class="resource-row" :class="{ 'resource-row--active': selectedExcerptItemId === item.id }">
            <div>
              <div class="row-title">{{ item.title }}</div>
              <div class="row-meta">{{ item.typeName }} · {{ item.identityFieldLabel }}: {{ item.identityValue || '未填写' }}</div>
              <div class="row-meta">归类：{{ item.workTitle || '未归类' }}</div>
              <a v-if="item.sourceUrl" :href="item.sourceUrl" target="_blank" rel="noreferrer">{{ item.sourceUrl }}</a>
            </div>
            <div class="row-actions">
              <button v-if="isBookItem(item)" class="secondary" @click="selectExcerptItem(item)">节选</button>
              <button @click="editItem(item)">编辑</button>
              <button class="danger" @click="removeItem(item.id)">删除</button>
            </div>
          </article>
          <p v-if="!items.length && !loading" class="empty">暂无资源实体</p>
        </div>

        <section v-if="selectedExcerptItem" class="resource-excerpts-panel" :aria-busy="excerptsLoading">
          <header class="excerpt-panel__header">
            <div>
              <h2>图书节选</h2>
              <p>{{ selectedExcerptItem.title }} · {{ excerpts.length }} 个片段</p>
            </div>
            <button type="button" class="secondary" @click="clearExcerptPanel">关闭</button>
          </header>

          <div class="excerpt-panel__body">
            <div class="excerpt-list">
              <article v-for="excerpt in excerpts" :key="excerpt.id" class="excerpt-row" :class="{ 'excerpt-row--active': excerptForm.id === excerpt.id }">
                <div>
                  <div class="row-title">{{ excerpt.title }}</div>
                  <div v-if="excerpt.locator" class="row-meta">{{ excerpt.locator }}</div>
                  <p>{{ excerpt.excerptText }}</p>
                  <p v-if="excerpt.note" class="excerpt-note">{{ excerpt.note }}</p>
                </div>
                <div class="row-actions">
                  <button type="button" @click="editExcerpt(excerpt)">编辑</button>
                  <button type="button" class="danger" @click="removeExcerpt(excerpt)">删除</button>
                </div>
              </article>
              <p v-if="!excerpts.length && !excerptsLoading" class="empty">暂无图书节选</p>
            </div>

            <form class="excerpt-form" @submit.prevent="saveExcerpt">
              <h3>{{ excerptForm.id ? '编辑节选' : '新增节选' }}</h3>
              <label>
                标题
                <input v-model.trim="excerptForm.title" required maxlength="255" />
              </label>
              <label>
                页码/定位
                <input v-model.trim="excerptForm.locator" maxlength="255" placeholder="第 1 章 / p. 18" />
              </label>
              <label>
                节选正文
                <textarea v-model.trim="excerptForm.excerptText" required rows="6" maxlength="20000" />
              </label>
              <label>
                备注
                <textarea v-model.trim="excerptForm.note" rows="3" maxlength="1024" />
              </label>
              <label>
                排序
                <input v-model.number="excerptForm.sortOrder" type="number" min="0" step="1" />
              </label>
              <div class="form-actions">
                <button type="submit" :disabled="!excerptForm.title.trim() || !excerptForm.excerptText.trim()">
                  {{ excerptForm.id ? '保存节选' : '创建节选' }}
                </button>
                <button type="button" class="secondary" @click="resetExcerptForm">清空</button>
              </div>
            </form>
          </div>
        </section>
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

    <section v-if="activeTab === 'objects'" class="object-model-layout">
      <form class="resource-form" @submit.prevent="saveClass">
        <h2>{{ classForm.id ? '编辑类定义' : '新增类定义' }}</h2>
        <label>
          类名
          <input v-model.trim="classForm.name" required maxlength="128" placeholder="User" />
        </label>
        <label>
          属性
          <textarea v-model="classForm.attributes" rows="6" placeholder="id: string&#10;name: string" />
        </label>
        <label>
          方法
          <textarea v-model="classForm.methods" rows="5" placeholder="login(): void&#10;logout(): void" />
        </label>
        <div class="form-actions">
          <button type="submit">{{ classForm.id ? '保存类' : '创建类' }}</button>
          <button type="button" class="secondary" @click="resetClassForm">清空</button>
        </div>
      </form>

      <form class="resource-form" @submit.prevent="saveObject">
        <h2>{{ objectForm.id ? '编辑对象实例' : '新增对象实例' }}</h2>
        <label>
          对象名
          <input v-model.trim="objectForm.name" required maxlength="128" placeholder="currentUser" />
        </label>
        <label>
          所属类
          <select v-model="objectForm.classId" required>
            <option value="" disabled>选择类定义</option>
            <option v-for="definition in objectModelStore.classes" :key="definition.id" :value="definition.id">
              {{ definition.name }}
            </option>
          </select>
        </label>
        <label>
          属性值 JSON
          <textarea v-model="objectForm.propertyValues" rows="8" placeholder="{&quot;id&quot;:&quot;u-001&quot;}" />
        </label>
        <div class="form-actions">
          <button type="submit" :disabled="objectModelStore.classes.length === 0">{{ objectForm.id ? '保存对象' : '创建对象' }}</button>
          <button type="button" class="secondary" @click="resetObjectForm">清空</button>
        </div>
      </form>

      <div class="resource-list object-model-list">
        <section class="object-model-section">
          <div class="object-model-section__header">
            <h2>类定义</h2>
            <span>{{ objectModelStore.classes.length }}</span>
          </div>
          <article v-for="definition in objectModelStore.classes" :key="definition.id" class="resource-row">
            <div>
              <div class="row-title">{{ definition.name }}</div>
              <div class="row-meta">属性 {{ definition.attributes.length }} · 方法 {{ definition.methods.length }}</div>
              <p v-if="definition.attributes.length">{{ definition.attributes.join('；') }}</p>
            </div>
            <div class="row-actions">
              <button @click="editClass(definition.id)">编辑</button>
              <button class="danger" @click="removeClass(definition.id)">删除</button>
            </div>
          </article>
          <p v-if="!objectModelStore.classes.length" class="empty">暂无类定义</p>
        </section>

        <section class="object-model-section">
          <div class="object-model-section__header">
            <h2>对象实例</h2>
            <span>{{ objectModelStore.objects.length }}</span>
          </div>
          <article v-for="objectDefinition in objectModelStore.objects" :key="objectDefinition.id" class="resource-row">
            <div>
              <div class="row-title">{{ objectDefinition.name }}</div>
              <div class="row-meta">所属类：{{ classNameById.get(objectDefinition.classId) || objectDefinition.classId }}</div>
              <p>{{ JSON.stringify(objectDefinition.propertyValues) }}</p>
            </div>
            <div class="row-actions">
              <button @click="editObject(objectDefinition.id)">编辑</button>
              <button class="danger" @click="removeObject(objectDefinition.id)">删除</button>
            </div>
          </article>
          <p v-if="!objectModelStore.objects.length" class="empty">暂无对象实例</p>
        </section>
      </div>
    </section>
  </main>
</template>

<style scoped>
.resource-page {
  box-sizing: border-box;
  height: 100vh;
  min-height: 100vh;
  overflow-y: auto;
  padding: 24px 32px 40px;
  background: linear-gradient(180deg, #f5f8fb 0%, #eef3f8 100%);
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
  border-radius: 8px;
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
  border-radius: 8px;
  padding: 8px 10px;
  font: inherit;
  background: #fff;
}

textarea {
  resize: vertical;
}

.message {
  padding: 10px 12px;
  border-radius: 8px;
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
  flex-wrap: wrap;
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

.reference-layout {
  grid-template-columns: minmax(300px, 380px) minmax(0, 1fr);
}

.object-model-layout {
  display: grid;
  grid-template-columns: minmax(260px, 320px) minmax(260px, 320px) minmax(0, 1fr);
  gap: 20px;
  align-items: start;
}

.resource-form,
.resource-list,
.resource-excerpts-panel {
  border: 1px solid #e4e7ec;
  border-radius: 14px;
  background: rgba(255, 255, 255, 0.95);
  backdrop-filter: blur(6px);
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

.form-divider {
  width: 100%;
  border: 0;
  border-top: 1px solid #edf0f5;
  margin: 4px 0;
}

.secondary {
  background: #f8fafc;
}

.danger {
  border-color: #fecdca;
  color: #b42318;
}

.resource-list {
  display: flex;
  flex-direction: column;
  overflow: hidden;
  max-height: 75vh;
}

.resource-list__scroll {
  overflow-y: auto;
  flex: 1;
  min-height: 0;
}

.resource-list__pagination {
  display: flex;
  align-items: center;
  gap: 4px;
  padding: 10px 16px;
  border-top: 1px solid #edf0f5;
  flex-shrink: 0;
  flex-wrap: wrap;
}

.resource-list__pagination button {
  min-width: 32px;
  height: 32px;
  padding: 0 8px;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  border: 1px solid #cfd7e3;
  border-radius: 6px;
  background: #fff;
  color: #1f2933;
  cursor: pointer;
  font-size: 13px;
}

.resource-list__pagination button:disabled {
  opacity: 0.4;
  cursor: default;
}

.resource-list__pagination button.active {
  border-color: #1677ff;
  background: #1677ff;
  color: #fff;
}

.resource-list__pagination .pagination-ellipsis {
  padding: 0 4px;
  color: #667085;
}

.resource-list__pagination .pagination-info {
  font-size: 13px;
  color: #667085;
  white-space: nowrap;
}

.resource-list__pagination .pagination-separator {
  color: #d0d5dd;
  font-size: 13px;
}

.resource-list__pagination .pagination-page {
  margin-left: auto;
  font-size: 13px;
  color: #667085;
  white-space: nowrap;
}

.object-model-list {
  display: flex;
  flex-direction: column;
}

.resource-items-panel {
  display: grid;
  gap: 16px;
  min-width: 0;
}

.resource-row--active,
.excerpt-row--active {
  background: #eff6ff;
}

.resource-excerpts-panel {
  overflow: hidden;
}

.excerpt-panel__header {
  display: flex;
  justify-content: space-between;
  gap: 16px;
  padding: 16px;
  border-bottom: 1px solid #edf0f5;
}

.excerpt-panel__header h2,
.excerpt-panel__header p,
.excerpt-form h3 {
  margin: 0;
}

.excerpt-panel__header p,
.excerpt-note {
  color: #667085;
}

.excerpt-panel__body {
  display: grid;
  grid-template-columns: minmax(0, 1fr) minmax(260px, 340px);
  gap: 16px;
  padding: 16px;
}

.excerpt-list {
  min-width: 0;
  max-height: 520px;
  overflow-y: auto;
  border: 1px solid #edf0f5;
  border-radius: 10px;
}

.excerpt-row {
  display: flex;
  justify-content: space-between;
  gap: 16px;
  padding: 14px;
  border-bottom: 1px solid #edf0f5;
}

.excerpt-row:last-child {
  border-bottom: 0;
}

.excerpt-row p {
  margin: 8px 0 0;
  white-space: pre-wrap;
}

.excerpt-form {
  display: grid;
  align-content: start;
  gap: 12px;
}

.excerpt-form input,
.excerpt-form textarea {
  min-width: 0;
  width: 100%;
}

.object-model-section + .object-model-section {
  border-top: 1px solid #edf0f5;
}

.object-model-section__header {
  display: flex;
  justify-content: space-between;
  gap: 12px;
  padding: 16px;
  border-bottom: 1px solid #edf0f5;
}

.object-model-section__header h2 {
  margin: 0;
  font-size: 18px;
}

.object-model-section__header span {
  color: #667085;
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
  display: flex;
  align-items: center;
  gap: 8px;
  font-weight: 700;
  margin-bottom: 4px;
}

.resource-row p {
  margin: 8px 0 0;
}

.resource-row a,
.reference-url {
  display: inline-block;
  max-width: 720px;
  margin-top: 6px;
  color: #0969da;
  word-break: break-all;
}

.reference-preview {
  color: #52606d;
}

.reference-row__content {
  min-width: 0;
}

.reference-badge,
.reference-status {
  display: inline-flex;
  align-items: center;
  border-radius: 999px;
  padding: 2px 8px;
  font-size: 12px;
  font-weight: 700;
  text-transform: uppercase;
}

.reference-badge--internal {
  background: #eff8ff;
  color: #175cd3;
}

.reference-badge--external {
  background: #fdf2fa;
  color: #c11574;
}

.reference-status--ok,
.reference-status--bound {
  background: #ecfdf3;
  color: #027a48;
}

.reference-status--broken {
  background: #fff1f3;
  color: #c01048;
}

.reference-status--unbound {
  background: #fff7ed;
  color: #c2410c;
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

  .resource-layout,
  .object-model-layout,
  .reference-layout,
  .excerpt-panel__body {
    grid-template-columns: 1fr;
  }
}
</style>
