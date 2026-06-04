<script setup lang="ts">
import { computed, onMounted, reactive, ref, watch } from 'vue';
import { useRoute, useRouter } from 'vue-router';
import { ElMessage, ElMessageBox } from 'element-plus';
import type { TabPaneName } from 'element-plus';
import {
  createResourceItem,
  createResourceExcerpt,
  createResourceType,
  createResourceWork,
  createUrlClusterRule,
  removeResourceItem,
  deleteResourceExcerpt,
  deleteResourceType,
  deleteResourceWork,
  deleteUrlClusterRule,
  listResourceExcerpts,
  listResourceItems,
  listResourceTypes,
  listResourceWorks,
  createResourceItemRelation,
  deleteResourceItemRelation,
  listUrlClusterRules,
  listResourceItemRelations,
  mergeResourceWorks,
  resetResourceItemAuto,
  splitResourceItemToNewWork,
  updateResourceExcerpt,
  updateResourceItem,
  updateResourceType,
  updateResourceWork,
  updateUrlClusterRule,
  supportsResourceExcerpts,
  type ResourceExcerpt,
  type ResourceItem,
  type ResourceItemRelation,
  type ResourceType,
  type ResourceWork,
  type UrlClusterRule,
  type VariantKind,
} from '@/api/externalResource';
import {
  listReferences,
  rebuildReferences,
  updateExternalReference,
  deleteAnnotationReference,
  type ReferenceItem,
} from '@/api/reference';
import {
  listOrphanedAnnotations,
  deleteOrphanedAnnotation,
  clearAllOrphanedAnnotations,
  type OrphanedAnnotation,
} from '@/api/orphanedAnnotation';
import { useObjectModelStore } from '@/stores/objectModel';

type ResourceTab = 'references' | 'items' | 'works' | 'types' | 'urlRules' | 'objects' | 'orphaned';
type ReferenceCategoryFilter = 'all' | 'internal' | 'external' | 'annotation';
type ReferenceStatusFilter = 'all' | 'ok' | 'broken' | 'bound' | 'unbound';

const route = useRoute();
const router = useRouter();
const resourceTabs = new Set<ResourceTab>(['references', 'items', 'works', 'types', 'urlRules', 'objects', 'orphaned']);

const TAB_LABELS: Record<ResourceTab, string> = {
  references: '引用管理',
  items: '资源实体',
  works: '资源归类',
  types: '资源类型',
  urlRules: 'URL 聚类规则',
  objects: '对象管理',
  orphaned: '孤立标注',
};

function getRouteTab(): ResourceTab {
  const tab = route.query.tab;
  return typeof tab === 'string' && resourceTabs.has(tab as ResourceTab) ? tab as ResourceTab : 'references';
}

const activeTab = ref<ResourceTab>(getRouteTab());
const loading = ref(false);
const referencesLoading = ref(false);
const excerptsLoading = ref(false);
const activeTabLabel = computed(() => TAB_LABELS[activeTab.value]);
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
const urlClusterRules = ref<UrlClusterRule[]>([]);
const itemRelations = ref<ResourceItemRelation[]>([]);
const relationForm = reactive({
  toItemId: '',
  relationType: 'translation',
  note: '',
});

const mergeWorkDialogVisible = ref(false);
const mergeWorkSourceItem = ref<ResourceItem | null>(null);
const mergeWorkSelectedId = ref('');
const mergeWorkCandidates = ref<ResourceWork[]>([]);
const mergeWorkSubmitting = ref(false);
const excerpts = ref<ResourceExcerpt[]>([]);
const references = ref<ReferenceItem[]>([]);
const orphanedAnnotations = ref<OrphanedAnnotation[]>([]);
const orphanedTotal = ref(0);
const orphanedPage = ref(0);
const orphanedPageSize = ref(50);
const orphanedLoading = ref(false);
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
  titleSource: 'auto' as 'auto' | 'manual',
  workIdSource: 'auto' as 'auto' | 'manual',
  variantKind: '' as VariantKind | '',
});

const urlRuleForm = reactive({
  id: '',
  domain: '',
  pathRegex: '',
  clusterKeyFormat: '',
  variantGroup: null as number | null,
  priority: 10,
  enabled: true,
  description: '',
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
    titleSource: 'auto',
    workIdSource: 'auto',
    variantKind: '',
  });
}

function resetUrlRuleForm() {
  Object.assign(urlRuleForm, {
    id: '',
    domain: '',
    pathRegex: '',
    clusterKeyFormat: '',
    variantGroup: null,
    priority: 10,
    enabled: true,
    description: '',
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
  ElMessage.error(error instanceof Error ? error.message : 'Request failed');
}

function showSuccess(message: string) {
  ElMessage.success(message);
}

async function confirmAction(message: string, title = '确认操作') {
  await ElMessageBox.confirm(message, title, {
    confirmButtonText: '确定',
    cancelButtonText: '取消',
    type: 'warning',
  });
}

async function refreshAll() {
  loading.value = true;
  try {
    types.value = await listResourceTypes();
    works.value = await listResourceWorks();
    urlClusterRules.value = await listUrlClusterRules();
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

function supportsExcerptItem(item: ResourceItem): boolean {
  return supportsResourceExcerpts(typeById.value.get(item.typeId)?.code);
}

const excerptLocatorPlaceholder = computed(() => {
  const code = selectedExcerptItem.value
    ? typeById.value.get(selectedExcerptItem.value.typeId)?.code
    : undefined;
  return code === 'web-link' ? '章节锚点 / 段落位置（可选）' : '第 1 章 / p. 18';
});

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
  if (!supportsExcerptItem(item)) return;
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

function onReferencePageChange(page: number) {
  currentPage.value = page - 1;
  void refreshReferences();
}

function referenceRowClassName() {
  return 'resource-row';
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

function buildItemPayloadFromRecord(item: Pick<ResourceItem, 'typeId' | 'workId' | 'title' | 'identityValue' | 'sourceUrl' | 'edition' | 'note' | 'titleSource' | 'workIdSource' | 'variantKind'>, overrides: {
  workId?: string;
  workIdSource?: 'auto' | 'manual';
  titleSource?: 'auto' | 'manual';
} = {}) {
  return {
    typeId: item.typeId,
    workId: overrides.workId ?? (item.workId || undefined),
    title: item.title,
    identityValue: item.identityValue || undefined,
    sourceUrl: item.sourceUrl || undefined,
    edition: item.edition || undefined,
    note: item.note || undefined,
    titleSource: overrides.titleSource ?? item.titleSource ?? 'auto',
    workIdSource: overrides.workIdSource ?? item.workIdSource ?? 'auto',
    variantKind: item.variantKind ? item.variantKind : undefined,
  };
}

function buildItemPayload(manual = false) {
  return buildItemPayloadFromRecord(
    {
      ...itemForm,
      variantKind: itemForm.variantKind || undefined,
    },
    {
      workId: itemForm.workId || undefined,
      titleSource: manual ? 'manual' : (itemForm.titleSource || 'auto'),
      workIdSource: manual ? 'manual' : (itemForm.workIdSource || 'auto'),
    },
  );
}

async function saveItem() {
  try {
    if (itemForm.id) {
      await updateResourceItem(itemForm.id, buildItemPayload(true));
      showSuccess('资源实体已更新');
    } else {
      await createResourceItem(buildItemPayload(false));
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
      title: excerptForm.title.trim(),
      locator: excerptForm.locator.trim() || undefined,
      excerptText: excerptForm.excerptText.trim() || undefined,
      note: excerptForm.note.trim() || undefined,
      sortOrder: Number.isFinite(excerptForm.sortOrder) ? excerptForm.sortOrder : excerpts.value.length,
    };
    if (excerptForm.id) {
      await updateResourceExcerpt(excerptForm.id, payload);
      showSuccess('节选已更新');
    } else {
      await createResourceExcerpt(selectedExcerptItem.value.id, payload);
      showSuccess('节选已创建');
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

async function loadItemRelations(itemId: string) {
  if (!itemId) {
    itemRelations.value = [];
    return;
  }
  try {
    itemRelations.value = await listResourceItemRelations(itemId);
  } catch (error) {
    showError(error);
    itemRelations.value = [];
  }
}

async function addItemRelation() {
  if (!itemForm.id || !relationForm.toItemId.trim()) return;
  try {
    await createResourceItemRelation({
      fromItemId: itemForm.id,
      toItemId: relationForm.toItemId.trim(),
      relationType: relationForm.relationType,
      note: relationForm.note.trim() || undefined,
    });
    relationForm.toItemId = '';
    relationForm.note = '';
    showSuccess('实体关系已创建');
    await loadItemRelations(itemForm.id);
  } catch (error) {
    showError(error);
  }
}

async function removeItemRelation(relation: ResourceItemRelation) {
  try {
    await confirmAction('确定删除这条实体关系？', '删除关系');
    await deleteResourceItemRelation(relation.id);
    showSuccess('关系已删除');
    if (itemForm.id) await loadItemRelations(itemForm.id);
  } catch (error) {
    showError(error);
  }
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
    titleSource: item.titleSource || 'auto',
    workIdSource: item.workIdSource || 'auto',
    variantKind: item.variantKind || '',
  });
  activeTab.value = 'items';
  void loadItemRelations(item.id);
}

function countItemsInWork(workId: string): number {
  return items.value.filter((entry) => entry.workId === workId).length;
}

function openMergeWorkDialog(item: ResourceItem) {
  const candidates = works.value.filter((work) => work.typeId === item.typeId && work.id !== item.workId);
  if (candidates.length === 0) {
    showError('没有可合并的目标归类，请先在「资源归类」中创建。');
    return;
  }
  mergeWorkSourceItem.value = item;
  mergeWorkCandidates.value = candidates;
  mergeWorkSelectedId.value = candidates[0]?.id ?? '';
  mergeWorkDialogVisible.value = true;
}

function closeMergeWorkDialog() {
  mergeWorkDialogVisible.value = false;
  mergeWorkSourceItem.value = null;
  mergeWorkSelectedId.value = '';
  mergeWorkCandidates.value = [];
  mergeWorkSubmitting.value = false;
}

function selectMergeWorkTarget(work: ResourceWork) {
  mergeWorkSelectedId.value = work.id;
}

async function confirmMergeWork() {
  const item = mergeWorkSourceItem.value;
  if (!item) return;
  const target = mergeWorkCandidates.value.find((work) => work.id === mergeWorkSelectedId.value);
  if (!target) {
    showError('请选择目标资源归类');
    return;
  }
  mergeWorkSubmitting.value = true;
  try {
    const sourceWorkId = item.workId;
    if (!sourceWorkId) {
      await updateResourceItem(item.id, buildItemPayloadFromRecord(item, {
        workId: target.id,
        workIdSource: 'manual',
        titleSource: item.titleSource === 'manual' ? 'manual' : item.titleSource,
      }));
    } else {
      await mergeResourceWorks(sourceWorkId, target.id);
    }
    showSuccess(`已将「${item.title}」合并到归类「${target.title}」`);
    closeMergeWorkDialog();
    await refreshAll();
  } catch (error) {
    showError(error);
  } finally {
    mergeWorkSubmitting.value = false;
  }
}

async function splitItemWork(item: ResourceItem) {
  try {
    await confirmAction(`确定将「${item.title}」拆分为独立的资源归类？`, '拆分为新归类');
    await splitResourceItemToNewWork(item.id);
    showSuccess('已拆分为新资源归类');
    await refreshAll();
  } catch (error) {
    showError(error);
  }
}

async function resetItemAuto(item: ResourceItem) {
  try {
    await confirmAction(`确定将「${item.title}」的自动字段重置为规则推断结果？`, '重置为自动');
    await resetResourceItemAuto(item.id);
    showSuccess('已重置为自动归类');
    await refreshAll();
  } catch (error) {
    showError(error);
  }
}

function editUrlRule(rule: UrlClusterRule) {
  Object.assign(urlRuleForm, {
    id: rule.id,
    domain: rule.domain,
    pathRegex: rule.pathRegex,
    clusterKeyFormat: rule.clusterKeyFormat,
    variantGroup: rule.variantGroup ?? null,
    priority: rule.priority,
    enabled: rule.enabled,
    description: rule.description || '',
  });
  activeTab.value = 'urlRules';
}

async function saveUrlRule() {
  try {
    const payload = {
      domain: urlRuleForm.domain.trim(),
      pathRegex: urlRuleForm.pathRegex.trim(),
      clusterKeyFormat: urlRuleForm.clusterKeyFormat.trim(),
      variantGroup: urlRuleForm.variantGroup,
      priority: urlRuleForm.priority,
      enabled: urlRuleForm.enabled,
      description: urlRuleForm.description.trim() || undefined,
    };
    if (urlRuleForm.id) {
      await updateUrlClusterRule(urlRuleForm.id, payload);
      showSuccess('URL 聚类规则已更新');
    } else {
      await createUrlClusterRule(payload);
      showSuccess('URL 聚类规则已创建');
    }
    resetUrlRuleForm();
    urlClusterRules.value = await listUrlClusterRules();
  } catch (error) {
    showError(error);
  }
}

async function removeUrlRule(rule: UrlClusterRule) {
  try {
    await confirmAction(`确定删除规则「${rule.domain}」？`, '删除规则');
    await deleteUrlClusterRule(rule.id);
    showSuccess('规则已删除');
    urlClusterRules.value = await listUrlClusterRules();
  } catch (error) {
    showError(error);
  }
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

async function removeItem(item: ResourceItem) {
  try {
    await confirmAction(
      `确定从资源库移除「${item.title}」？页面中的引用不会因此删除。`,
      '移除资源实体',
    );
    await removeResourceItem(item.id);
    showSuccess('已从资源库移除该资源实体');
    if (selectedExcerptItemId.value === item.id) {
      clearExcerptPanel();
    }
    await refreshAll();
    await refreshReferences();
  } catch (error) {
    showError(error);
  }
}

async function removeExcerpt(excerpt: ResourceExcerpt) {
  try {
    await confirmAction(`确定删除节选「${excerpt.title}」？`, '删除节选');
    await deleteResourceExcerpt(excerpt.id);
    showSuccess('节选已删除');
    if (selectedExcerptItem.value) {
      await loadExcerpts(selectedExcerptItem.value.id);
    }
    await refreshReferences();
  } catch (error) {
    if (error !== 'cancel' && error !== 'close') showError(error);
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
  try {
    await confirmAction(
      `确定删除标注「${item.target.blockPreview || item.target.resourceItemTitle}」？`,
      '删除标注',
    );
    await deleteAnnotationReference(item.source.pageId, item.source.blockId, item.source.sourceLocator);
    showSuccess('标注已删除');
    await refreshReferences();
  } catch (error) {
    if (error !== 'cancel' && error !== 'close') showError(error);
  }
}

async function loadOrphanedAnnotations() {
  orphanedLoading.value = true;
  try {
    const result = await listOrphanedAnnotations(orphanedPage.value, orphanedPageSize.value);
    orphanedAnnotations.value = result.items ?? [];
    orphanedTotal.value = result.total ?? 0;
  } catch (error) {
    showError(error);
  } finally {
    orphanedLoading.value = false;
  }
}

async function removeOrphanedAnnotation(id: string) {
  try {
    await confirmAction('确定永久删除这条孤立标注？', '删除孤立标注');
    await deleteOrphanedAnnotation(id);
    showSuccess('孤立标注已删除');
    await loadOrphanedAnnotations();
  } catch (error) {
    if (error !== 'cancel' && error !== 'close') showError(error);
  }
}

async function clearOrphanedAnnotations() {
  try {
    await confirmAction(
      `确定永久清除全部 ${orphanedTotal.value} 条孤立标注？此操作不可恢复。`,
      '清除全部',
    );
    const count = await clearAllOrphanedAnnotations();
    showSuccess(`已清除 ${count} 条孤立标注`);
    await loadOrphanedAnnotations();
  } catch (error) {
    if (error !== 'cancel' && error !== 'close') showError(error);
  }
}

function onOrphanedPageChange(page: number) {
  orphanedPage.value = page - 1;
  void loadOrphanedAnnotations();
}

function onTabChange(name: TabPaneName) {
  const tab = name as ResourceTab;
  activeTab.value = tab;
  if (tab === 'orphaned') {
    void loadOrphanedAnnotations();
  }
  void router.replace({
    path: route.path,
    query: {
      ...route.query,
      tab,
    },
  });
}

function formatDateTime(value: string) {
  return value ? new Date(value).toLocaleString() : '-';
}

function referenceCategoryTagType(category: string) {
  if (category === 'internal') return 'primary';
  if (category === 'external') return 'danger';
  if (category === 'annotation') return 'warning';
  return 'info';
}

function referenceStatusTagType(status: string) {
  if (status === 'ok' || status === 'bound') return 'success';
  if (status === 'broken') return 'danger';
  if (status === 'unbound') return 'warning';
  return 'info';
}

function referenceSourceSummary(item: ReferenceItem) {
  if (item.category === 'annotation') {
    return `${item.source.pageTitle} · ${item.target.blockPreview || item.target.resourceItemTitle || '-'}`;
  }
  return `${item.source.pageTitle} · ${item.source.blockId} · ${item.source.sourceKind}`;
}

function referenceTargetSummary(item: ReferenceItem) {
  if (item.category === 'internal') {
    return `${item.target.kind} ${item.target.pageTitle || item.target.pageId || item.target.blockId || ''}`;
  }
  if (item.category === 'annotation') {
    return item.citation.note || '(无备注)';
  }
  const parts = [item.target.resourceItemTitle || '未绑定资源'];
  if (item.target.resourceTypeName) parts.push(item.target.resourceTypeName);
  if (item.target.resourceExcerptTitle) parts.push(`节选：${item.target.resourceExcerptTitle}`);
  if (item.target.resourceExcerptLocator) parts.push(item.target.resourceExcerptLocator);
  return parts.join(' · ');
}

function truncateText(value: string, max = 80) {
  const text = value.trim();
  if (text.length <= max) return text;
  return `${text.slice(0, max)}…`;
}

onMounted(async () => {
  await refreshAll();
  await refreshReferences();
  await loadOrphanedAnnotations();
});

watch(
  () => route.query.tab,
  () => {
    activeTab.value = getRouteTab();
    if (activeTab.value === 'orphaned') {
      void loadOrphanedAnnotations();
    }
  },
);
</script>

<template>
  <main class="resource-page">
    <el-breadcrumb separator="/" class="resource-breadcrumb">
      <el-breadcrumb-item :to="{ path: '/' }">工作区</el-breadcrumb-item>
      <el-breadcrumb-item>引用与外部资源</el-breadcrumb-item>
      <el-breadcrumb-item v-if="activeTabLabel">{{ activeTabLabel }}</el-breadcrumb-item>
    </el-breadcrumb>

    <div class="resource-header">
      <div class="resource-header__main">
        <h1>引用与外部资源</h1>
        <p>统一查看页面内部引用、外部链接引用，以及资源类型、归类和具体实体。</p>
      </div>
      <el-button @click="router.push('/')">返回工作区</el-button>
    </div>

    <el-card shadow="never" class="resource-filters">
      <el-form inline @submit.prevent>
        <el-form-item label="类型">
          <el-select v-model="selectedTypeId" clearable placeholder="全部类型" style="width: 200px" @change="onTypeFilterChange">
            <el-option
              v-for="type in types"
              :key="type.id"
              :label="`${type.icon || '·'} ${type.name}`"
              :value="type.id"
            />
          </el-select>
        </el-form-item>
        <el-form-item label="归类">
          <el-select v-model="selectedWorkId" clearable placeholder="全部归类" style="width: 220px" @change="refreshItems">
            <el-option v-for="work in filteredWorks" :key="work.id" :label="work.title" :value="work.id" />
          </el-select>
        </el-form-item>
      </el-form>
    </el-card>

    <el-tabs v-model="activeTab" class="resource-tabs" @tab-change="onTabChange">
      <el-tab-pane label="引用管理" name="references" />
      <el-tab-pane label="资源实体" name="items" />
      <el-tab-pane label="资源归类" name="works" />
      <el-tab-pane label="资源类型" name="types" />
      <el-tab-pane label="URL 聚类规则" name="urlRules" />
      <el-tab-pane label="对象管理" name="objects" />
      <el-tab-pane name="orphaned">
        <template #label>
          <span class="orphaned-tab-label">
            孤立标注
            <el-badge v-if="orphanedTotal > 0" :value="orphanedTotal" type="danger" />
          </span>
        </template>
      </el-tab-pane>
    </el-tabs>

    <section v-if="activeTab === 'references'" class="resource-layout reference-layout">
      <el-card shadow="never" class="resource-form-card">
        <template #header>
          <span>{{ referenceForm.id ? '编辑外部引用' : '筛选与编辑' }}</span>
        </template>
        <el-form class="resource-form" label-position="top" @submit.prevent="saveReference">
          <el-form-item label="引用类别">
            <el-select v-model="selectedReferenceCategory" style="width: 100%" @change="onReferenceFilterChange">
              <el-option label="全部" value="all" />
              <el-option label="标注引用" value="annotation" />
              <el-option label="内部引用" value="internal" />
              <el-option label="外部引用" value="external" />
            </el-select>
          </el-form-item>
          <el-form-item label="引用状态">
            <el-select v-model="selectedReferenceStatus" style="width: 100%" @change="onReferenceFilterChange">
              <el-option label="全部" value="all" />
              <el-option label="正常" value="ok" />
              <el-option label="失效" value="broken" />
              <el-option label="已绑定" value="bound" />
              <el-option label="未绑定" value="unbound" />
            </el-select>
          </el-form-item>
          <el-form-item label="关联资源实体">
            <el-select v-model="selectedReferenceResourceItemId" clearable placeholder="全部资源实体" style="width: 100%" @change="onReferenceFilterChange">
              <el-option v-for="item in items" :key="item.id" :label="item.title" :value="item.id" />
            </el-select>
          </el-form-item>
          <el-form-item label="关键字">
            <el-input v-model="referenceKeyword" maxlength="200" placeholder="页面、块、资源标题、URL" clearable @keyup.enter="onReferenceFilterChange" />
          </el-form-item>
          <el-form-item>
            <el-space wrap>
              <el-button type="primary" @click="onReferenceFilterChange">查询</el-button>
              <el-button @click="rebuildReferenceIndex">重建索引</el-button>
            </el-space>
          </el-form-item>

          <template v-if="referenceForm.id">
            <el-divider />
            <el-form-item label="绑定方式">
              <el-select v-model="referenceForm.bindingMode" style="width: 100%">
                <el-option label="自动匹配" value="auto" />
                <el-option label="手动绑定" value="manual_bound" />
                <el-option label="手动解绑" value="manual_unbound" />
              </el-select>
            </el-form-item>
            <el-form-item label="资源实体">
              <el-select v-model="referenceForm.resourceItemId" :disabled="referenceForm.bindingMode !== 'manual_bound'" clearable placeholder="选择资源实体" style="width: 100%">
                <el-option v-for="item in items" :key="item.id" :label="item.title" :value="item.id" />
              </el-select>
            </el-form-item>
            <el-form-item label="显示文案">
              <el-input v-model="referenceForm.displayText" maxlength="255" />
            </el-form-item>
            <el-form-item label="页码/定位">
              <el-input v-model="referenceForm.citationLocator" maxlength="255" placeholder="p. 18" />
            </el-form-item>
            <el-form-item label="引用说明">
              <el-input v-model="referenceForm.citationNote" type="textarea" :rows="4" maxlength="1024" />
            </el-form-item>
            <el-form-item>
              <el-space wrap>
                <el-button type="primary" native-type="submit">保存引用</el-button>
                <el-button @click="resetReferenceForm">清空</el-button>
              </el-space>
            </el-form-item>
          </template>
        </el-form>
      </el-card>

      <el-card shadow="never" class="resource-list-card">
        <template #header>
          <div class="list-card-header">
            <span>引用列表</span>
            <span class="row-meta">共 {{ totalReferences }} 条</span>
          </div>
        </template>
        <el-table
          v-loading="referencesLoading"
          class="resource-list"
          :data="references"
          :row-class-name="referenceRowClassName"
          empty-text="暂无引用记录"
          stripe
        >
          <el-table-column type="expand">
            <template #default="{ row }">
              <div class="table-expand">
                <p v-if="row.target.url" class="reference-url">{{ row.target.url }}</p>
                <p v-if="row.target.blockPreview && row.category !== 'annotation'" class="reference-preview">{{ row.target.blockPreview }}</p>
                <p v-if="row.citation.displayText || row.citation.locator || row.citation.note" class="reference-preview">
                  {{ row.citation.displayText || '未设置显示文案' }}
                  <span v-if="row.citation.locator"> · {{ row.citation.locator }}</span>
                  <span v-if="row.citation.note"> · {{ row.citation.note }}</span>
                </p>
              </div>
            </template>
          </el-table-column>
          <el-table-column label="类别" width="110">
            <template #default="{ row }">
              <el-tag :type="referenceCategoryTagType(row.category)" size="small">{{ categoryLabel(row.category) }}</el-tag>
            </template>
          </el-table-column>
          <el-table-column label="状态" width="90">
            <template #default="{ row }">
              <el-tag :type="referenceStatusTagType(row.status)" size="small">{{ row.status }}</el-tag>
            </template>
          </el-table-column>
          <el-table-column label="来源" min-width="180" show-overflow-tooltip>
            <template #default="{ row }">{{ referenceSourceSummary(row) }}</template>
          </el-table-column>
          <el-table-column label="目标" min-width="200" show-overflow-tooltip>
            <template #default="{ row }">{{ referenceTargetSummary(row) }}</template>
          </el-table-column>
          <el-table-column label="操作" width="280" fixed="right">
            <template #default="{ row }">
              <el-space wrap>
                <el-button size="small" @click="goToReferenceSource(row)">打开来源</el-button>
                <el-button v-if="row.editable && row.category !== 'annotation'" size="small" @click="editReference(row)">编辑</el-button>
                <el-button v-if="row.editable && row.category !== 'annotation'" size="small" @click="setReferenceBinding(row, 'auto')">自动匹配</el-button>
                <el-button v-if="row.editable && row.category !== 'annotation'" size="small" type="warning" plain @click="setReferenceBinding(row, 'manual_unbound')">解绑</el-button>
                <el-button v-if="row.editable && row.category === 'annotation'" size="small" type="danger" plain @click="deleteAnnotation(row)">删除</el-button>
              </el-space>
            </template>
          </el-table-column>
        </el-table>
        <div v-if="totalReferences > pageSize" class="table-pagination">
          <el-pagination
            :current-page="currentPage + 1"
            :page-size="pageSize"
            :total="totalReferences"
            layout="total, prev, pager, next, jumper"
            background
            @current-change="onReferencePageChange"
          />
        </div>
      </el-card>
    </section>

    <section v-if="activeTab === 'items'" class="resource-layout">
      <el-card shadow="never" class="resource-form-card">
        <template #header>
          <span>{{ itemForm.id ? '编辑资源实体' : '新增资源实体' }}</span>
        </template>
        <el-form class="resource-form" label-position="top" @submit.prevent="saveItem">
          <el-form-item label="类型" required>
            <el-select v-model="itemForm.typeId" placeholder="选择类型" style="width: 100%" @change="itemForm.workId = ''">
              <el-option v-for="type in types" :key="type.id" :label="type.name" :value="type.id" />
            </el-select>
          </el-form-item>
          <el-form-item label="归类 Work">
            <el-select v-model="itemForm.workId" clearable placeholder="不选择归类" style="width: 100%">
              <el-option
                v-for="work in works.filter((work) => work.typeId === itemForm.typeId)"
                :key="work.id"
                :label="work.title"
                :value="work.id"
              />
            </el-select>
          </el-form-item>
          <el-form-item label="标题" required>
            <el-input v-model="itemForm.title" maxlength="255" />
          </el-form-item>
          <el-form-item :label="itemFormType?.identityFieldLabel || '唯一标识'">
            <el-input v-model="itemForm.identityValue" maxlength="512" />
          </el-form-item>
          <el-form-item label="源 URL">
            <el-input v-model="itemForm.sourceUrl" maxlength="1024" />
          </el-form-item>
          <el-form-item label="版本/变体">
            <el-input v-model="itemForm.edition" maxlength="128" placeholder="规则推断或手动填写" />
          </el-form-item>
          <el-form-item label="变体类型">
            <el-select v-model="itemForm.variantKind" clearable placeholder="未指定" style="width: 100%">
              <el-option label="翻译" value="translation" />
              <el-option label="格式" value="format" />
              <el-option label="版次" value="edition" />
              <el-option label="镜像" value="mirror" />
              <el-option label="其他" value="other" />
            </el-select>
          </el-form-item>
          <el-form-item label="备注">
            <el-input v-model="itemForm.note" type="textarea" :rows="4" maxlength="1024" />
          </el-form-item>
          <template v-if="itemForm.id">
            <el-divider content-position="left">实体关系</el-divider>
            <el-table :data="itemRelations" size="small" empty-text="暂无关系">
              <el-table-column label="关系" width="100" prop="relationType" />
              <el-table-column label="目标" min-width="120" prop="toItemTitle" show-overflow-tooltip />
              <el-table-column label="操作" width="80">
                <template #default="{ row }">
                  <el-button size="small" type="danger" link @click="removeItemRelation(row)">删除</el-button>
                </template>
              </el-table-column>
            </el-table>
            <el-form-item label="关联到实体 ID">
              <el-input v-model="relationForm.toItemId" placeholder="目标资源实体 ID" />
            </el-form-item>
            <el-form-item label="关系类型">
              <el-select v-model="relationForm.relationType" style="width: 100%">
                <el-option label="翻译" value="translation" />
                <el-option label="格式" value="format" />
                <el-option label="版次" value="edition" />
                <el-option label="镜像" value="mirror" />
                <el-option label="其他" value="other" />
              </el-select>
            </el-form-item>
            <el-form-item>
              <el-button @click="addItemRelation">添加关系</el-button>
            </el-form-item>
          </template>
          <el-form-item>
            <el-space wrap>
              <el-button type="primary" native-type="submit">{{ itemForm.id ? '保存实体' : '创建实体' }}</el-button>
              <el-button @click="resetItemForm">清空</el-button>
            </el-space>
          </el-form-item>
        </el-form>
      </el-card>

      <div class="resource-items-panel">
        <el-card shadow="never" class="resource-list-card">
          <template #header>
            <div class="list-card-header">
              <span>资源实体</span>
              <span class="row-meta">{{ items.length }} 项</span>
            </div>
          </template>
          <el-table
            v-loading="loading"
            class="resource-list"
            :data="items"
            :row-class-name="({ row }: { row: ResourceItem }) => selectedExcerptItemId === row.id ? 'resource-row resource-row--active' : 'resource-row'"
            empty-text="暂无资源实体"
            stripe
          >
            <el-table-column prop="title" label="标题" min-width="140" show-overflow-tooltip />
            <el-table-column label="类型/标识" min-width="160" show-overflow-tooltip>
              <template #default="{ row }">{{ row.typeName }} · {{ row.identityFieldLabel }}: {{ row.identityValue || '未填写' }}</template>
            </el-table-column>
            <el-table-column label="归类/来源" min-width="140" show-overflow-tooltip>
              <template #default="{ row }">
                <div>{{ row.workTitle || '未归类' }}</div>
                <span class="row-meta">
                  {{ row.titleSource === 'manual' ? '标题·手动' : '标题·自动' }}
                  · {{ row.workIdSource === 'manual' ? '归类·手动' : '归类·自动' }}
                  <template v-if="row.variantKind"> · {{ row.variantKind }}</template>
                </span>
              </template>
            </el-table-column>
            <el-table-column label="URL" min-width="120" show-overflow-tooltip>
              <template #default="{ row }">
                <el-link v-if="row.sourceUrl" :href="row.sourceUrl" target="_blank" type="primary">{{ row.sourceUrl }}</el-link>
                <span v-else class="row-meta">-</span>
              </template>
            </el-table-column>
            <el-table-column label="操作" width="320" fixed="right">
              <template #default="{ row }">
                <el-space wrap>
                  <el-button v-if="supportsExcerptItem(row)" size="small" @click="selectExcerptItem(row)">节选</el-button>
                  <el-button size="small" @click="editItem(row)">编辑</el-button>
                  <el-button size="small" @click="openMergeWorkDialog(row)">合并归类</el-button>
                  <el-button size="small" @click="splitItemWork(row)">拆分</el-button>
                  <el-button size="small" @click="resetItemAuto(row)">重置自动</el-button>
                  <el-button size="small" type="danger" plain @click="removeItem(row)">移除</el-button>
                </el-space>
              </template>
            </el-table-column>
          </el-table>
        </el-card>

        <el-card v-if="selectedExcerptItem" v-loading="excerptsLoading" shadow="never" class="resource-excerpts-panel">
          <template #header>
            <div class="excerpt-panel__header">
              <div>
                <h2>资源节选</h2>
                <p>{{ selectedExcerptItem.title }} · {{ excerpts.length }} 个片段</p>
              </div>
              <el-button @click="clearExcerptPanel">关闭</el-button>
            </div>
          </template>
          <div class="excerpt-panel__body">
            <div class="excerpt-list">
              <el-table
                class="excerpt-table"
                :data="excerpts"
                :row-class-name="({ row }: { row: ResourceExcerpt }) => excerptForm.id === row.id ? 'excerpt-row excerpt-row--active' : 'excerpt-row'"
                empty-text="暂无节选"
              >
                <el-table-column prop="title" label="标题" min-width="120" />
                <el-table-column prop="locator" label="定位" width="100" show-overflow-tooltip />
                <el-table-column prop="excerptText" label="正文" min-width="180" show-overflow-tooltip />
                <el-table-column prop="note" label="备注" min-width="100" show-overflow-tooltip />
                <el-table-column label="操作" width="140" fixed="right">
                  <template #default="{ row }">
                    <el-space>
                      <el-button size="small" @click="editExcerpt(row)">编辑</el-button>
                      <el-button size="small" type="danger" plain @click="removeExcerpt(row)">删除</el-button>
                    </el-space>
                  </template>
                </el-table-column>
              </el-table>
            </div>
            <el-form class="excerpt-form resource-form" label-position="top" @submit.prevent="saveExcerpt">
              <h3>{{ excerptForm.id ? '编辑节选' : '新增节选' }}</h3>
              <el-form-item label="标题" required>
                <el-input v-model="excerptForm.title" maxlength="255" />
              </el-form-item>
              <el-form-item label="页码/定位">
                <el-input v-model="excerptForm.locator" maxlength="255" :placeholder="excerptLocatorPlaceholder" />
              </el-form-item>
              <el-form-item label="节选正文">
                <el-input v-model="excerptForm.excerptText" type="textarea" :rows="6" maxlength="20000" placeholder="可选" />
              </el-form-item>
              <el-form-item label="备注">
                <el-input v-model="excerptForm.note" type="textarea" :rows="3" maxlength="1024" />
              </el-form-item>
              <el-form-item label="排序">
                <el-input-number v-model="excerptForm.sortOrder" :min="0" :step="1" />
              </el-form-item>
              <el-form-item>
                <el-space wrap>
                  <el-button
                    type="primary"
                    native-type="submit"
                    :disabled="!excerptForm.title.trim()"
                  >
                    {{ excerptForm.id ? '保存节选' : '创建节选' }}
                  </el-button>
                  <el-button @click="resetExcerptForm">清空</el-button>
                </el-space>
              </el-form-item>
            </el-form>
          </div>
        </el-card>
      </div>
    </section>

    <section v-if="activeTab === 'works'" class="resource-layout">
      <el-card shadow="never" class="resource-form-card">
        <template #header>
          <span>{{ workForm.id ? '编辑资源归类' : '新增资源归类' }}</span>
        </template>
        <el-form class="resource-form" label-position="top" @submit.prevent="saveWork">
          <el-form-item label="类型" required>
            <el-select v-model="workForm.typeId" placeholder="选择类型" style="width: 100%">
              <el-option v-for="type in types" :key="type.id" :label="type.name" :value="type.id" />
            </el-select>
          </el-form-item>
          <el-form-item label="标题" required>
            <el-input v-model="workForm.title" maxlength="255" />
          </el-form-item>
          <el-form-item label="副标题">
            <el-input v-model="workForm.subtitle" maxlength="255" />
          </el-form-item>
          <el-form-item label="描述">
            <el-input v-model="workForm.description" type="textarea" :rows="4" maxlength="1024" />
          </el-form-item>
          <el-form-item>
            <el-space wrap>
              <el-button type="primary" native-type="submit">{{ workForm.id ? '保存归类' : '创建归类' }}</el-button>
              <el-button @click="resetWorkForm">清空</el-button>
            </el-space>
          </el-form-item>
        </el-form>
      </el-card>

      <el-card shadow="never" class="resource-list-card">
        <template #header>
          <span>资源归类列表</span>
        </template>
        <el-table
          class="resource-list"
          :data="filteredWorks"
          :row-class-name="referenceRowClassName"
          empty-text="暂无资源归类"
          stripe
        >
          <el-table-column prop="title" label="标题" min-width="140" />
          <el-table-column label="类型/副标题" min-width="160" show-overflow-tooltip>
            <template #default="{ row }">{{ row.typeName }}<span v-if="row.subtitle"> · {{ row.subtitle }}</span></template>
          </el-table-column>
          <el-table-column prop="description" label="描述" min-width="180" show-overflow-tooltip />
          <el-table-column label="操作" width="140" fixed="right">
            <template #default="{ row }">
              <el-space>
                <el-button size="small" @click="editWork(row)">编辑</el-button>
                <el-button size="small" type="danger" plain @click="removeWork(row.id)">删除</el-button>
              </el-space>
            </template>
          </el-table-column>
        </el-table>
      </el-card>
    </section>

    <section v-if="activeTab === 'urlRules'" class="resource-layout">
      <el-card shadow="never" class="resource-form-card">
        <template #header>
          <span>{{ urlRuleForm.id ? '编辑 URL 聚类规则' : '新增 URL 聚类规则' }}</span>
        </template>
        <el-form class="resource-form" label-position="top" @submit.prevent="saveUrlRule">
          <el-form-item label="域名" required>
            <el-input v-model="urlRuleForm.domain" placeholder="example.com 或 *" maxlength="255" />
          </el-form-item>
          <el-form-item label="路径正则" required>
            <el-input v-model="urlRuleForm.pathRegex" placeholder="^/books/([0-9]+)/([^/]+)$" maxlength="512" />
          </el-form-item>
          <el-form-item label="聚类键格式" required>
            <el-input v-model="urlRuleForm.clusterKeyFormat" placeholder="{domain}|books|{1}" maxlength="512" />
          </el-form-item>
          <el-form-item label="变体捕获组">
            <el-input-number v-model="urlRuleForm.variantGroup" :min="0" :max="9" />
          </el-form-item>
          <el-form-item label="优先级">
            <el-input-number v-model="urlRuleForm.priority" :min="0" :max="1000" />
          </el-form-item>
          <el-form-item label="启用">
            <el-switch v-model="urlRuleForm.enabled" />
          </el-form-item>
          <el-form-item label="说明">
            <el-input v-model="urlRuleForm.description" type="textarea" :rows="2" maxlength="512" />
          </el-form-item>
          <el-form-item>
            <el-space wrap>
              <el-button type="primary" native-type="submit">{{ urlRuleForm.id ? '保存规则' : '创建规则' }}</el-button>
              <el-button @click="resetUrlRuleForm">清空</el-button>
            </el-space>
          </el-form-item>
        </el-form>
      </el-card>

      <el-card shadow="never" class="resource-list-card">
        <template #header>
          <div class="list-card-header">
            <span>URL 聚类规则</span>
            <span class="row-meta">{{ urlClusterRules.length }} 条</span>
          </div>
        </template>
        <el-table v-loading="loading" :data="urlClusterRules" stripe empty-text="暂无规则">
          <el-table-column prop="domain" label="域名" width="140" />
          <el-table-column prop="pathRegex" label="路径正则" min-width="180" show-overflow-tooltip />
          <el-table-column prop="clusterKeyFormat" label="聚类键" min-width="140" show-overflow-tooltip />
          <el-table-column prop="priority" label="优先级" width="80" />
          <el-table-column label="状态" width="90">
            <template #default="{ row }">{{ row.enabled ? '启用' : '停用' }}</template>
          </el-table-column>
          <el-table-column label="来源" width="90">
            <template #default="{ row }">{{ row.builtIn ? '内置' : '自定义' }}</template>
          </el-table-column>
          <el-table-column label="操作" width="160" fixed="right">
            <template #default="{ row }">
              <el-space>
                <el-button size="small" @click="editUrlRule(row)">编辑</el-button>
                <el-button size="small" type="danger" plain :disabled="row.builtIn" @click="removeUrlRule(row)">删除</el-button>
              </el-space>
            </template>
          </el-table-column>
        </el-table>
      </el-card>
    </section>

    <section v-if="activeTab === 'types'" class="resource-layout">
      <el-card shadow="never" class="resource-form-card">
        <template #header>
          <span>{{ typeForm.id ? '编辑资源类型' : '新增资源类型' }}</span>
        </template>
        <el-form class="resource-form" label-position="top" @submit.prevent="saveType">
          <el-form-item label="代码" required>
            <el-input v-model="typeForm.code" maxlength="64" :disabled="Boolean(typeForm.id)" placeholder="book" />
          </el-form-item>
          <el-form-item label="名称" required>
            <el-input v-model="typeForm.name" maxlength="128" placeholder="图书" />
          </el-form-item>
          <el-form-item label="图标">
            <el-input v-model="typeForm.icon" maxlength="32" placeholder="📚" />
          </el-form-item>
          <el-form-item label="主标识字段" required>
            <el-input v-model="typeForm.identityFieldKey" maxlength="64" placeholder="isbn" />
          </el-form-item>
          <el-form-item label="主标识名称" required>
            <el-input v-model="typeForm.identityFieldLabel" maxlength="128" placeholder="ISBN" />
          </el-form-item>
          <el-form-item label="描述">
            <el-input v-model="typeForm.description" type="textarea" :rows="3" maxlength="255" />
          </el-form-item>
          <el-form-item>
            <el-space wrap>
              <el-button type="primary" native-type="submit">{{ typeForm.id ? '保存类型' : '创建类型' }}</el-button>
              <el-button @click="resetTypeForm">清空</el-button>
            </el-space>
          </el-form-item>
        </el-form>
      </el-card>

      <el-card shadow="never" class="resource-list-card">
        <template #header>
          <span>资源类型列表</span>
        </template>
        <el-table
          class="resource-list"
          :data="types"
          :row-class-name="referenceRowClassName"
          empty-text="暂无资源类型"
          stripe
        >
          <el-table-column label="名称" min-width="120">
            <template #default="{ row }">{{ row.icon }} {{ row.name }}</template>
          </el-table-column>
          <el-table-column label="代码/标识" min-width="160" show-overflow-tooltip>
            <template #default="{ row }">{{ row.code }} · {{ row.identityFieldLabel }} ({{ row.identityFieldKey }})</template>
          </el-table-column>
          <el-table-column prop="description" label="描述" min-width="180" show-overflow-tooltip />
          <el-table-column label="操作" width="140" fixed="right">
            <template #default="{ row }">
              <el-space>
                <el-button size="small" @click="editType(row)">编辑</el-button>
                <el-button size="small" type="danger" plain @click="removeType(row.id)">删除</el-button>
              </el-space>
            </template>
          </el-table-column>
        </el-table>
      </el-card>
    </section>

    <section v-if="activeTab === 'objects'" class="object-model-layout">
      <el-card shadow="never" class="resource-form-card">
        <template #header>
          <span>{{ classForm.id ? '编辑类定义' : '新增类定义' }}</span>
        </template>
        <el-form class="resource-form" label-position="top" @submit.prevent="saveClass">
          <el-form-item label="类名" required>
            <el-input v-model="classForm.name" maxlength="128" placeholder="User" />
          </el-form-item>
          <el-form-item label="属性">
            <el-input v-model="classForm.attributes" type="textarea" :rows="6" placeholder="id: string&#10;name: string" />
          </el-form-item>
          <el-form-item label="方法">
            <el-input v-model="classForm.methods" type="textarea" :rows="5" placeholder="login(): void&#10;logout(): void" />
          </el-form-item>
          <el-form-item>
            <el-space wrap>
              <el-button type="primary" native-type="submit">{{ classForm.id ? '保存类' : '创建类' }}</el-button>
              <el-button @click="resetClassForm">清空</el-button>
            </el-space>
          </el-form-item>
        </el-form>
      </el-card>

      <el-card shadow="never" class="resource-form-card">
        <template #header>
          <span>{{ objectForm.id ? '编辑对象实例' : '新增对象实例' }}</span>
        </template>
        <el-form class="resource-form" label-position="top" @submit.prevent="saveObject">
          <el-form-item label="对象名" required>
            <el-input v-model="objectForm.name" maxlength="128" placeholder="currentUser" />
          </el-form-item>
          <el-form-item label="所属类" required>
            <el-select v-model="objectForm.classId" placeholder="选择类定义" style="width: 100%">
              <el-option v-for="definition in objectModelStore.classes" :key="definition.id" :label="definition.name" :value="definition.id" />
            </el-select>
          </el-form-item>
          <el-form-item label="属性值 JSON">
            <el-input v-model="objectForm.propertyValues" type="textarea" :rows="8" placeholder="{&quot;id&quot;:&quot;u-001&quot;}" />
          </el-form-item>
          <el-form-item>
            <el-space wrap>
              <el-button type="primary" native-type="submit" :disabled="objectModelStore.classes.length === 0">
                {{ objectForm.id ? '保存对象' : '创建对象' }}
              </el-button>
              <el-button @click="resetObjectForm">清空</el-button>
            </el-space>
          </el-form-item>
        </el-form>
      </el-card>

      <el-card shadow="never" class="resource-list-card object-model-list">
        <el-tabs>
          <el-tab-pane :label="`类定义 (${objectModelStore.classes.length})`">
            <el-table
              class="resource-list"
              :data="objectModelStore.classes"
              :row-class-name="referenceRowClassName"
              empty-text="暂无类定义"
              stripe
            >
              <el-table-column prop="name" label="类名" min-width="120" />
              <el-table-column label="属性/方法" min-width="120">
                <template #default="{ row }">属性 {{ row.attributes.length }} · 方法 {{ row.methods.length }}</template>
              </el-table-column>
              <el-table-column label="属性列表" min-width="180" show-overflow-tooltip>
                <template #default="{ row }">{{ row.attributes.join('；') || '-' }}</template>
              </el-table-column>
              <el-table-column label="操作" width="140" fixed="right">
                <template #default="{ row }">
                  <el-space>
                    <el-button size="small" @click="editClass(row.id)">编辑</el-button>
                    <el-button size="small" type="danger" plain @click="removeClass(row.id)">删除</el-button>
                  </el-space>
                </template>
              </el-table-column>
            </el-table>
          </el-tab-pane>
          <el-tab-pane :label="`对象实例 (${objectModelStore.objects.length})`">
            <el-table
              class="resource-list"
              :data="objectModelStore.objects"
              :row-class-name="referenceRowClassName"
              empty-text="暂无对象实例"
              stripe
            >
              <el-table-column prop="name" label="对象名" min-width="120" />
              <el-table-column label="所属类" min-width="120">
                <template #default="{ row }">{{ classNameById.get(row.classId) || row.classId }}</template>
              </el-table-column>
              <el-table-column label="属性值" min-width="200" show-overflow-tooltip>
                <template #default="{ row }">{{ JSON.stringify(row.propertyValues) }}</template>
              </el-table-column>
              <el-table-column label="操作" width="140" fixed="right">
                <template #default="{ row }">
                  <el-space>
                    <el-button size="small" @click="editObject(row.id)">编辑</el-button>
                    <el-button size="small" type="danger" plain @click="removeObject(row.id)">删除</el-button>
                  </el-space>
                </template>
              </el-table-column>
            </el-table>
          </el-tab-pane>
        </el-tabs>
      </el-card>
    </section>

    <section v-if="activeTab === 'orphaned'" class="orphaned-layout">
      <el-page-header class="orphaned-page-header">
        <template #content>
          <div class="orphaned-header">
            <h2>孤立标注（{{ orphanedTotal }}）</h2>
            <p>以下标注来自已删除的页面。可以查看原文节选和备注，或永久删除。</p>
          </div>
        </template>
        <template #extra>
          <el-space>
            <el-button :loading="orphanedLoading" @click="loadOrphanedAnnotations">刷新</el-button>
            <el-button v-if="orphanedTotal > 0" type="danger" plain @click="clearOrphanedAnnotations">清除全部</el-button>
          </el-space>
        </template>
      </el-page-header>

      <el-card shadow="never" class="resource-list-card">
        <el-table
          v-loading="orphanedLoading"
          class="resource-list orphaned-table"
          :data="orphanedAnnotations"
          empty-text="暂无孤立标注"
          stripe
        >
          <el-table-column type="expand">
            <template #default="{ row }">
              <el-descriptions :column="1" border class="orphaned-descriptions">
                <el-descriptions-item v-if="row.selectedText" label="节选">
                  <blockquote class="orphaned-quote">{{ row.selectedText }}</blockquote>
                </el-descriptions-item>
                <el-descriptions-item v-if="row.note" label="备注">{{ row.note }}</el-descriptions-item>
                <el-descriptions-item v-if="row.contextBefore || row.contextAfter" label="上下文">
                  {{ row.contextBefore }} … {{ row.contextAfter }}
                </el-descriptions-item>
                <el-descriptions-item label="页面 ID">{{ row.pageId }}</el-descriptions-item>
                <el-descriptions-item label="块 ID">{{ row.blockId || '-' }}</el-descriptions-item>
                <el-descriptions-item label="创建时间">{{ formatDateTime(row.createdAt) }}</el-descriptions-item>
              </el-descriptions>
            </template>
          </el-table-column>
          <el-table-column label="原页面" min-width="140">
            <template #default="{ row }">
              <span class="orphaned-source">{{ row.pageTitle }}</span>
            </template>
          </el-table-column>
          <el-table-column prop="blockType" label="块类型" width="100" />
          <el-table-column label="节选摘要" min-width="200" show-overflow-tooltip>
            <template #default="{ row }">{{ row.selectedText ? truncateText(row.selectedText) : '-' }}</template>
          </el-table-column>
          <el-table-column label="备注" min-width="120" show-overflow-tooltip>
            <template #default="{ row }">{{ row.note || '-' }}</template>
          </el-table-column>
          <el-table-column label="孤立于" width="170">
            <template #default="{ row }">{{ formatDateTime(row.orphanedAt) }}</template>
          </el-table-column>
          <el-table-column label="操作" width="90" fixed="right">
            <template #default="{ row }">
              <el-button size="small" type="danger" plain @click="removeOrphanedAnnotation(row.id)">删除</el-button>
            </template>
          </el-table-column>
        </el-table>
        <div v-if="orphanedTotal > orphanedPageSize" class="table-pagination">
          <el-pagination
            :current-page="orphanedPage + 1"
            :page-size="orphanedPageSize"
            :total="orphanedTotal"
            layout="total, prev, pager, next, jumper"
            background
            @current-change="onOrphanedPageChange"
          />
        </div>
      </el-card>
    </section>

    <el-dialog
      v-model="mergeWorkDialogVisible"
      title="合并到资源归类"
      width="560px"
      destroy-on-close
      @closed="closeMergeWorkDialog"
    >
      <p v-if="mergeWorkSourceItem" class="merge-work-dialog__intro">
        将实体「<strong>{{ mergeWorkSourceItem.title }}</strong>」合并到以下归类之一。
        <span v-if="mergeWorkSourceItem.workTitle" class="row-meta">
          当前归类：{{ mergeWorkSourceItem.workTitle }}
        </span>
      </p>
      <el-table
        :data="mergeWorkCandidates"
        class="merge-work-dialog__table"
        max-height="320"
        highlight-current-row
        :row-class-name="({ row }: { row: ResourceWork }) => mergeWorkSelectedId === row.id ? 'merge-work-row--selected' : ''"
        @row-click="selectMergeWorkTarget"
      >
        <el-table-column width="48" align="center">
          <template #default="{ row }">
            <el-radio v-model="mergeWorkSelectedId" :label="row.id" @click.stop />
          </template>
        </el-table-column>
        <el-table-column prop="title" label="归类名称" min-width="160" show-overflow-tooltip />
        <el-table-column label="聚类键" min-width="140" show-overflow-tooltip>
          <template #default="{ row }">
            <span class="row-meta">{{ row.clusterKey || '-' }}</span>
          </template>
        </el-table-column>
        <el-table-column label="实体数" width="72" align="center">
          <template #default="{ row }">{{ countItemsInWork(row.id) }}</template>
        </el-table-column>
      </el-table>
      <template #footer>
        <el-button @click="closeMergeWorkDialog">取消</el-button>
        <el-button
          type="primary"
          :loading="mergeWorkSubmitting"
          :disabled="!mergeWorkSelectedId"
          @click="confirmMergeWork"
        >
          确认合并
        </el-button>
      </template>
    </el-dialog>
  </main>
</template>

<style scoped>
.resource-page {
  box-sizing: border-box;
  height: 100vh;
  min-height: 100vh;
  overflow-y: auto;
  padding: 20px 28px 36px;
  background: #f5f7fa;
  color: #1f2933;
}

.resource-breadcrumb {
  margin-bottom: 16px;
}

.resource-header {
  display: flex;
  align-items: flex-start;
  justify-content: space-between;
  gap: 20px;
  margin-bottom: 16px;
}

.resource-header h1 {
  margin: 0 0 6px;
  font-size: 26px;
  font-weight: 700;
}

.resource-header p,
.row-meta {
  margin: 0;
  color: #667085;
  font-size: 14px;
}

.resource-filters {
  margin-bottom: 16px;
}

.resource-filters :deep(.el-card__body) {
  padding-bottom: 2px;
}

.resource-tabs {
  margin-bottom: 16px;
}

.resource-tabs :deep(.el-tabs__header) {
  margin-bottom: 0;
}

.orphaned-tab-label {
  display: inline-flex;
  align-items: center;
  gap: 8px;
}

.resource-layout {
  display: grid;
  grid-template-columns: minmax(280px, 360px) minmax(0, 1fr);
  gap: 16px;
  align-items: start;
}

.reference-layout {
  grid-template-columns: minmax(300px, 380px) minmax(0, 1fr);
}

.object-model-layout {
  display: grid;
  grid-template-columns: minmax(260px, 320px) minmax(260px, 320px) minmax(0, 1fr);
  gap: 16px;
  align-items: start;
}

.resource-form-card,
.resource-list-card,
.resource-excerpts-panel {
  min-width: 0;
}

.resource-form {
  display: flex;
  flex-direction: column;
  gap: 4px;
}

.resource-form h3 {
  margin: 0 0 8px;
  font-size: 16px;
}

.list-card-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
}

.resource-list {
  width: 100%;
}

.resource-list :deep(.resource-row--active > td) {
  background: #eff6ff !important;
}

.resource-list :deep(.excerpt-row--active > td) {
  background: #eff6ff !important;
}

.table-expand {
  padding: 8px 12px 12px 48px;
}

.table-pagination {
  display: flex;
  justify-content: flex-end;
  padding: 12px 0 4px;
}

.resource-items-panel {
  display: grid;
  gap: 16px;
  min-width: 0;
}

.excerpt-panel__header {
  display: flex;
  align-items: flex-start;
  justify-content: space-between;
  gap: 16px;
}

.excerpt-panel__header h2,
.excerpt-panel__header p {
  margin: 0;
}

.excerpt-panel__header p {
  margin-top: 4px;
  color: #667085;
  font-size: 13px;
}

.excerpt-panel__body {
  display: grid;
  grid-template-columns: minmax(0, 1fr) minmax(260px, 340px);
  gap: 16px;
}

.excerpt-list {
  min-width: 0;
}

.excerpt-form {
  align-content: start;
}

.reference-url {
  margin: 0 0 6px;
  color: #0969da;
  word-break: break-all;
}

.reference-preview {
  margin: 0;
  color: #52606d;
}

.orphaned-layout {
  display: flex;
  flex-direction: column;
  gap: 16px;
}

.orphaned-page-header {
  padding: 0;
}

.orphaned-header h2 {
  margin: 0;
  font-size: 20px;
}

.orphaned-header p {
  margin: 6px 0 0;
  color: #667085;
  font-size: 14px;
}

.orphaned-source {
  font-weight: 600;
  color: #175cd3;
}

.orphaned-quote {
  margin: 0;
  padding: 8px 12px;
  border-left: 3px solid #1677ff;
  background: #f5f8fb;
  border-radius: 4px;
  white-space: pre-wrap;
}

.orphaned-descriptions {
  margin: 4px 0;
}

.merge-work-dialog__intro {
  margin: 0 0 12px;
  color: #344054;
  font-size: 14px;
  line-height: 1.5;
}

.merge-work-dialog__intro .row-meta {
  display: block;
  margin-top: 6px;
}

.merge-work-dialog__table :deep(.el-table__row) {
  cursor: pointer;
}

.merge-work-dialog__table :deep(.merge-work-row--selected > td) {
  background: #ecf5ff !important;
}

@media (max-width: 960px) {
  .resource-page {
    padding: 16px;
  }

  .resource-header {
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
