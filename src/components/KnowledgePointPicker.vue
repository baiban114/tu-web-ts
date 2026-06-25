<script setup lang="ts">
import { computed, ref, watch } from 'vue';
import {
  ElButton,
  ElDialog,
  ElInput,
  ElOption,
  ElPagination,
  ElSelect,
  ElTabPane,
  ElTabs,
  ElTree,
} from 'element-plus';
import type { KnowledgeAnchor, KnowledgePoint, RelationTypeDef } from '@/api/types';
import { DEFAULT_PAGE_SIZE } from '@/constants/pagination';
import { createKnowledgeRelation, listRelationTypes } from '@/api/knowledgeRelation';
import {
  createKnowledgePoint,
  getKnowledgePointTree,
  listKnowledgePoints,
  listKnowledgePointsByLocator,
} from '@/api/knowledgePoint';
import { anchorLabel } from '@/utils/knowledgeAnchor';

const props = defineProps<{
  visible: boolean;
  kbId: string;
  sourceAnchor: KnowledgeAnchor | null;
}>();

const emit = defineEmits<{
  (e: 'update:visible', value: boolean): void;
  (e: 'created'): void;
}>();

const activeTab = ref('tree');
const relationTypes = ref<RelationTypeDef[]>([]);
const selectedTypeKey = ref('case');
const selectedTargetPoint = ref<KnowledgePoint | null>(null);
const saving = ref(false);

const pointTree = ref<KnowledgePoint[]>([]);
const searchKeyword = ref('');
const searchPage = ref(0);
const searchTotal = ref(0);
const searchItems = ref<KnowledgePoint[]>([]);

const sourcePoints = ref<KnowledgePoint[]>([]);
const sourceMode = ref<'existing' | 'new'>('new');
const selectedSourcePointId = ref('');
const newSourceTitle = ref('');

const treeProps = { label: 'title', children: 'children' };

const sourceLabel = computed(() => (props.sourceAnchor ? anchorLabel(props.sourceAnchor) : ''));

watch(
  () => props.visible,
  async (visible) => {
    if (!visible) {
      selectedTargetPoint.value = null;
      selectedTypeKey.value = 'case';
      activeTab.value = 'tree';
      searchKeyword.value = '';
      searchPage.value = 0;
      sourceMode.value = 'new';
      selectedSourcePointId.value = '';
      newSourceTitle.value = '';
      return;
    }
    relationTypes.value = await listRelationTypes(props.kbId);
    if (!relationTypes.value.some((item) => item.typeKey === selectedTypeKey.value)) {
      selectedTypeKey.value = relationTypes.value[0]?.typeKey ?? 'case';
    }
    pointTree.value = await getKnowledgePointTree(props.kbId);
    if (props.sourceAnchor) {
      sourcePoints.value = await listKnowledgePointsByLocator(props.kbId, props.sourceAnchor.locator);
      sourceMode.value = sourcePoints.value.length ? 'existing' : 'new';
      selectedSourcePointId.value = sourcePoints.value[0]?.id ?? '';
      newSourceTitle.value = sourceLabel.value;
    }
    await loadSearch();
  },
);

async function loadSearch() {
  const result = await listKnowledgePoints(props.kbId, {
    q: searchKeyword.value.trim() || undefined,
    page: searchPage.value,
    pageSize: DEFAULT_PAGE_SIZE,
  });
  searchItems.value = result.items;
  searchTotal.value = result.total;
}

function handleTreeNodeClick(data: KnowledgePoint) {
  selectedTargetPoint.value = data;
}

function selectSearchItem(item: KnowledgePoint) {
  selectedTargetPoint.value = item;
}

function close() {
  emit('update:visible', false);
}

async function handleSave() {
  if (!props.sourceAnchor || !selectedTargetPoint.value || saving.value) return;
  saving.value = true;
  try {
    let fromPointId = selectedSourcePointId.value;
    if (sourceMode.value === 'new') {
      const created = await createKnowledgePoint(props.kbId, {
        title: newSourceTitle.value.trim() || sourceLabel.value || '未命名知识点',
        sourceAnchor: props.sourceAnchor,
      });
      fromPointId = created.id;
    } else if (!fromPointId) {
      return;
    }
    await createKnowledgeRelation(props.kbId, {
      relationTypeKey: selectedTypeKey.value,
      fromPointId,
      toPointId: selectedTargetPoint.value.id,
      from: props.sourceAnchor,
    });
    emit('created');
    close();
  } finally {
    saving.value = false;
  }
}

async function onSearchPageChange(page: number) {
  searchPage.value = Math.max(0, page - 1);
  await loadSearch();
}
</script>

<template>
  <ElDialog
    :model-value="visible"
    title="建立知识关联"
    width="min(560px, calc(100vw - 48px))"
    class="tu-dialog-viewport"
    destroy-on-close
    @update:model-value="(value: boolean) => emit('update:visible', value)"
  >
    <div class="kpp-body">
      <div v-if="sourceAnchor" class="kpp-source">
        <span class="kpp-label">证据</span>
        <span class="kpp-value">{{ sourceLabel }}</span>
      </div>

      <div class="kpp-source-point">
        <div class="kpp-label">源知识点</div>
        <div v-if="sourcePoints.length" class="kpp-source-modes">
          <label><input v-model="sourceMode" type="radio" value="existing" /> 绑定已有</label>
          <label><input v-model="sourceMode" type="radio" value="new" /> 新建并绑定</label>
        </div>
        <ElSelect
          v-if="sourceMode === 'existing' && sourcePoints.length"
          v-model="selectedSourcePointId"
          class="kpp-select"
        >
          <ElOption
            v-for="point in sourcePoints"
            :key="point.id"
            :label="point.title"
            :value="point.id"
          />
        </ElSelect>
        <ElInput
          v-else
          v-model="newSourceTitle"
          placeholder="新知识点标题"
        />
      </div>

      <label class="kpp-field-label">关系类型</label>
      <ElSelect v-model="selectedTypeKey" class="kpp-select">
        <ElOption
          v-for="type in relationTypes"
          :key="type.typeKey"
          :label="type.label"
          :value="type.typeKey"
        />
      </ElSelect>

      <ElTabs v-model="activeTab" class="kpp-tabs">
        <ElTabPane label="知识点树" name="tree">
          <div class="kpp-scroll">
            <ElTree
              :data="pointTree"
              node-key="id"
              :props="treeProps"
              highlight-current
              @node-click="handleTreeNodeClick"
            />
          </div>
        </ElTabPane>
        <ElTabPane label="搜索" name="search">
          <div class="kpp-search-bar">
            <ElInput
              v-model="searchKeyword"
              clearable
              placeholder="搜索知识点"
              @change="searchPage = 0; loadSearch()"
              @clear="searchPage = 0; loadSearch()"
            />
          </div>
          <div class="kpp-scroll">
            <button
              v-for="item in searchItems"
              :key="item.id"
              type="button"
              class="kpp-list-item"
              :class="{ 'kpp-list-item--active': selectedTargetPoint?.id === item.id }"
              @click="selectSearchItem(item)"
            >
              {{ item.title }}
            </button>
          </div>
          <ElPagination
            v-if="searchTotal > DEFAULT_PAGE_SIZE"
            small
            layout="prev, pager, next"
            :total="searchTotal"
            :page-size="DEFAULT_PAGE_SIZE"
            :current-page="searchPage + 1"
            @current-change="onSearchPageChange"
          />
        </ElTabPane>
      </ElTabs>

      <div v-if="selectedTargetPoint" class="kpp-target">
        <span class="kpp-label">目标知识点</span>
        <span class="kpp-value">{{ selectedTargetPoint.title }}</span>
      </div>
    </div>

    <template #footer>
      <ElButton @click="close">取消</ElButton>
      <ElButton
        type="primary"
        :disabled="!sourceAnchor || !selectedTargetPoint || (sourceMode === 'existing' && sourcePoints.length > 0 && !selectedSourcePointId)"
        :loading="saving"
        @click="handleSave"
      >
        建立关联
      </ElButton>
    </template>
  </ElDialog>
</template>

<style scoped>
.kpp-body {
  display: flex;
  flex-direction: column;
  gap: 10px;
  min-height: 0;
}

.kpp-source,
.kpp-target,
.kpp-source-point {
  display: flex;
  flex-direction: column;
  gap: 6px;
}

.kpp-label {
  color: #8c8c8c;
  font-size: 12px;
}

.kpp-value {
  color: #1f1f1f;
  word-break: break-word;
}

.kpp-field-label {
  font-size: 12px;
  color: #8c8c8c;
}

.kpp-select {
  width: 100%;
}

.kpp-scroll {
  max-height: min(40vh, 280px);
  overflow: auto;
  border: 1px solid #f0f0f0;
  border-radius: 8px;
  padding: 8px;
}

.kpp-source-modes {
  display: flex;
  gap: 12px;
  font-size: 13px;
}

.kpp-list-item {
  display: block;
  width: 100%;
  border: none;
  background: transparent;
  text-align: left;
  padding: 8px;
  border-radius: 6px;
  cursor: pointer;
}

.kpp-list-item:hover,
.kpp-list-item--active {
  background: #f0f5ff;
}

.kpp-search-bar {
  margin-bottom: 8px;
}
</style>
