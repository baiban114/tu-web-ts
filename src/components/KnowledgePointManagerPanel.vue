<script setup lang="ts">
import { computed, ref, watch } from 'vue';
import { useRouter } from 'vue-router';
import {
  ElButton,
  ElCard,
  ElInput,
  ElPagination,
  ElTree,
} from 'element-plus';
import type { KnowledgeAnchor, KnowledgePoint, KnowledgePointAnchor, KnowledgeRelation } from '@/api/types';
import { DEFAULT_PAGE_SIZE } from '@/constants/pagination';
import {
  createKnowledgePoint,
  getKnowledgePointTree,
  listKnowledgePointAnchors,
  listKnowledgePoints,
} from '@/api/knowledgePoint';
import { listKnowledgeRelationsByPoint } from '@/api/knowledgeRelation';
import {
  anchorLabel,
  navigateKnowledgeAnchor,
  navigateKnowledgePoint,
  relationEndpointLabel,
} from '@/utils/knowledgeAnchor';
import { useWorkspaceStore } from '@/stores/workspace';

const props = defineProps<{
  kbId: string;
}>();

const router = useRouter();
const workspaceStore = useWorkspaceStore();

const pointTree = ref<KnowledgePoint[]>([]);
const treeLoading = ref(false);
const listLoading = ref(false);
const keyword = ref('');
const listPage = ref(0);
const listTotal = ref(0);
const listItems = ref<KnowledgePoint[]>([]);
const selectedParentId = ref<string | null>(null);
const selectedPoint = ref<KnowledgePoint | null>(null);
const anchors = ref<KnowledgePointAnchor[]>([]);
const relationsLoading = ref(false);
const outgoing = ref<KnowledgeRelation[]>([]);
const incoming = ref<KnowledgeRelation[]>([]);
const newPointTitle = ref('');
const creating = ref(false);

const treeProps = { label: 'title', children: 'children' };

const navigateHandlers = computed(() => ({
  router,
  selectPage: async (pageId: string) => {
    await router.push({ path: '/', query: { pageId } });
  },
  currentPageId: workspaceStore.currentPageId,
}));

async function refreshTree() {
  treeLoading.value = true;
  try {
    pointTree.value = await getKnowledgePointTree(props.kbId);
  } finally {
    treeLoading.value = false;
  }
}

async function refreshList() {
  listLoading.value = true;
  try {
    const result = await listKnowledgePoints(props.kbId, {
      q: keyword.value.trim() || undefined,
      page: listPage.value,
      pageSize: DEFAULT_PAGE_SIZE,
    });
    let items = result.items;
    if (selectedParentId.value) {
      items = items.filter((item) => item.parentId === selectedParentId.value);
    }
    listItems.value = items;
    listTotal.value = selectedParentId.value ? items.length : result.total;
    listPage.value = result.page;
  } finally {
    listLoading.value = false;
  }
}

async function refreshDetail(point: KnowledgePoint) {
  selectedPoint.value = point;
  relationsLoading.value = true;
  try {
    anchors.value = await listKnowledgePointAnchors(point.id);
    const relations = await listKnowledgeRelationsByPoint(props.kbId, point.id);
    outgoing.value = relations.outgoing;
    incoming.value = relations.incoming;
  } finally {
    relationsLoading.value = false;
  }
}

async function refreshAll() {
  await refreshTree();
  await refreshList();
}

watch(
  () => props.kbId,
  () => { void refreshAll(); },
  { immediate: true },
);

function onTreeNodeClick(data: KnowledgePoint) {
  selectedParentId.value = data.id;
  listPage.value = 0;
  void refreshList();
}

function clearTreeFilter() {
  selectedParentId.value = null;
  listPage.value = 0;
  void refreshList();
}

function onListPageChange(page: number) {
  listPage.value = page - 1;
  void refreshList();
}

function onKeywordChange() {
  listPage.value = 0;
  void refreshList();
}

async function handleCreatePoint() {
  const title = newPointTitle.value.trim();
  if (!title || creating.value) return;
  creating.value = true;
  try {
    const created = await createKnowledgePoint(props.kbId, {
      title,
      parentId: selectedParentId.value,
    });
    newPointTitle.value = '';
    await refreshAll();
    await refreshDetail(created);
  } finally {
    creating.value = false;
  }
}

function onNavigateAnchor(anchor: KnowledgeAnchor) {
  void navigateKnowledgeAnchor(anchor, navigateHandlers.value);
}

function onNavigatePoint(pointId: string) {
  void navigateKnowledgePoint(pointId, navigateHandlers.value);
}
</script>

<template>
  <section class="kpm-layout">
    <aside class="kpm-sidebar">
      <div class="kpm-sidebar__toolbar">
        <span class="kpm-sidebar__title">分类树</span>
        <ElButton link type="primary" @click="clearTreeFilter">全部</ElButton>
      </div>
      <div v-loading="treeLoading" class="kpm-tree-wrap">
        <ElTree
          :data="pointTree"
          node-key="id"
          :props="treeProps"
          highlight-current
          @node-click="onTreeNodeClick"
        />
      </div>
    </aside>

    <div class="kpm-main">
      <div class="kpm-toolbar">
        <ElInput
          v-model="keyword"
          clearable
          placeholder="搜索知识点"
          style="max-width: 280px"
          @change="onKeywordChange"
          @clear="onKeywordChange"
        />
        <ElInput
          v-model="newPointTitle"
          placeholder="新建知识点标题"
          style="max-width: 220px"
          @keyup.enter="handleCreatePoint"
        />
        <ElButton type="primary" :loading="creating" :disabled="!newPointTitle.trim()" @click="handleCreatePoint">
          新建
        </ElButton>
        <ElButton @click="refreshAll">刷新</ElButton>
      </div>

      <div class="kpm-content">
        <div v-loading="listLoading" class="kpm-list">
          <button
            v-for="item in listItems"
            :key="item.id"
            type="button"
            class="kpm-list-item"
            :class="{ 'kpm-list-item--active': selectedPoint?.id === item.id }"
            @click="refreshDetail(item)"
          >
            <span class="kpm-list-item__title">{{ item.title }}</span>
            <span v-if="item.summary" class="kpm-list-item__summary">{{ item.summary }}</span>
          </button>
          <div v-if="!listLoading && listItems.length === 0" class="kpm-empty">暂无知识点</div>
        </div>

        <ElCard v-if="selectedPoint" v-loading="relationsLoading" shadow="never" class="kpm-detail">
          <template #header>
            <span>{{ selectedPoint.title }}</span>
          </template>
          <p v-if="selectedPoint.summary" class="kpm-detail__summary">{{ selectedPoint.summary }}</p>

          <div v-if="anchors.length" class="kpm-section">
            <div class="kpm-section__title">证据</div>
            <button
              v-for="anchor in anchors"
              :key="anchor.id"
              type="button"
              class="kpm-link"
              @click="onNavigateAnchor({ kind: anchor.kind, locator: anchor.locator, snapshot: anchor.snapshot })"
            >
              {{ anchorLabel({ kind: anchor.kind, locator: anchor.locator, snapshot: anchor.snapshot }) }}
            </button>
          </div>

          <div v-if="outgoing.length" class="kpm-section">
            <div class="kpm-section__title">关联到</div>
            <button
              v-for="relation in outgoing"
              :key="relation.id"
              type="button"
              class="kpm-link"
              @click="relation.toPointId && onNavigatePoint(relation.toPointId)"
            >
              {{ relation.relationTypeLabel }} · {{ relationEndpointLabel(relation, 'out') }}
            </button>
          </div>

          <div v-if="incoming.length" class="kpm-section">
            <div class="kpm-section__title">被关联</div>
            <button
              v-for="relation in incoming"
              :key="relation.id"
              type="button"
              class="kpm-link"
              @click="relation.fromPointId && onNavigatePoint(relation.fromPointId)"
            >
              {{ relation.relationTypeLabel }} · {{ relationEndpointLabel(relation, 'in') }}
            </button>
          </div>
        </ElCard>
      </div>

      <div class="kpm-pagination">
        <ElPagination
          layout="total, prev, pager, next"
          :total="listTotal"
          :page-size="DEFAULT_PAGE_SIZE"
          :current-page="listPage + 1"
          @current-change="onListPageChange"
        />
      </div>
    </div>
  </section>
</template>

<style scoped>
.kpm-layout {
  display: grid;
  grid-template-columns: minmax(200px, 280px) minmax(0, 1fr);
  gap: 16px;
  min-height: 0;
}

.kpm-sidebar {
  display: flex;
  flex-direction: column;
  min-height: 0;
  border: 1px solid #f0f0f0;
  border-radius: 8px;
  background: #fff;
}

.kpm-sidebar__toolbar {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 10px 12px;
  border-bottom: 1px solid #f0f0f0;
}

.kpm-sidebar__title {
  font-size: 13px;
  color: #595959;
}

.kpm-tree-wrap {
  flex: 1;
  overflow: auto;
  padding: 8px;
  max-height: min(70vh, 640px);
}

.kpm-main {
  display: flex;
  flex-direction: column;
  gap: 12px;
  min-width: 0;
}

.kpm-toolbar {
  display: flex;
  flex-wrap: wrap;
  gap: 8px;
  align-items: center;
}

.kpm-content {
  display: grid;
  grid-template-columns: minmax(220px, 1fr) minmax(280px, 1.2fr);
  gap: 12px;
  min-height: 0;
}

.kpm-list {
  border: 1px solid #f0f0f0;
  border-radius: 8px;
  background: #fff;
  max-height: min(70vh, 640px);
  overflow: auto;
}

.kpm-list-item {
  display: flex;
  flex-direction: column;
  gap: 4px;
  width: 100%;
  border: none;
  background: transparent;
  text-align: left;
  padding: 10px 12px;
  border-bottom: 1px solid #f5f5f5;
  cursor: pointer;
}

.kpm-list-item:hover,
.kpm-list-item--active {
  background: #f0f5ff;
}

.kpm-list-item__title {
  font-size: 14px;
  color: #1f1f1f;
}

.kpm-list-item__summary {
  font-size: 12px;
  color: #8c8c8c;
}

.kpm-detail {
  max-height: min(70vh, 640px);
  overflow: auto;
}

.kpm-detail__summary {
  margin: 0 0 12px;
  color: #595959;
  font-size: 13px;
}

.kpm-section + .kpm-section {
  margin-top: 12px;
}

.kpm-section__title {
  font-size: 12px;
  color: #8c8c8c;
  margin-bottom: 6px;
}

.kpm-link {
  display: block;
  width: 100%;
  border: none;
  background: #fafafa;
  border-radius: 6px;
  padding: 6px 8px;
  margin-bottom: 4px;
  text-align: left;
  cursor: pointer;
  font-size: 12px;
  color: #1677ff;
}

.kpm-link:hover {
  background: #f0f5ff;
}

.kpm-empty {
  padding: 24px;
  text-align: center;
  color: #8c8c8c;
  font-size: 13px;
}

.kpm-pagination {
  display: flex;
  justify-content: flex-end;
}
</style>
