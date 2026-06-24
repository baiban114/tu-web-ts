<script setup lang="ts">
import { ref, nextTick, computed, watch, onMounted, onBeforeUnmount } from 'vue';
import {
  ElScrollbar,
  ElTree,
  ElButton,
  ElInput,
  ElDialog,
  ElMessageBox,
  ElMessage,
  ElDropdown,
  ElDropdownMenu,
  ElDropdownItem,
} from 'element-plus';
import { useWorkspaceStore } from '@/stores/workspace';
import type { PageItem } from '@/api/page';
import type { PageType } from '@/api/types';
import AuthPanel from './AuthPanel.vue';
import GlobalSearchBox from './GlobalSearchBox.vue';
import MarkdownImportButton from './MarkdownImportButton.vue';
import RoadmapImportButton from './RoadmapImportButton.vue';

const store = useWorkspaceStore();

const treeRef = ref<InstanceType<typeof ElTree>>()
const pageTreeFocusRef = ref<HTMLElement | null>(null)
const allTreeExpanded = ref(false)

const selectedPageIds = ref<Set<string>>(new Set())
const selectionAnchorId = ref<string | null>(null)

const showAddKbDialog = ref(false);
const newKbName = ref('');
const renamingId = ref<string | null>(null);
const renameValue = ref('');
const renameInputRef = ref<InstanceType<typeof ElInput> | null>(null);

function findPageInTree(nodes: PageItem[], pageId: string): PageItem | null {
  for (const node of nodes) {
    if (node.id === pageId) return node;
    if (node.children?.length) {
      const found = findPageInTree(node.children, pageId);
      if (found) return found;
    }
  }
  return null;
}

function findPageById(pageId: string): PageItem | null {
  return findPageInTree(store.pageTree, pageId);
}

function isTypingTarget(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) return false;
  const tag = target.tagName;
  return tag === 'INPUT' || tag === 'TEXTAREA' || target.isContentEditable;
}

function isPageSelected(pageId: string): boolean {
  return selectedPageIds.value.has(pageId);
}

function setSingleSelection(pageId: string) {
  selectedPageIds.value = new Set([pageId]);
  selectionAnchorId.value = pageId;
}

function togglePageSelection(pageId: string) {
  const next = new Set(selectedPageIds.value);
  if (next.has(pageId)) {
    next.delete(pageId);
  } else {
    next.add(pageId);
  }
  selectedPageIds.value = next;
}

function getVisiblePageOrder(): PageItem[] {
  const tree = treeRef.value;
  if (!tree) return [];

  const result: PageItem[] = [];
  const visit = (node: { data: PageItem; expanded: boolean; childNodes: Array<{ data: PageItem; expanded: boolean; childNodes: unknown[] }> }) => {
    result.push(node.data);
    if (node.expanded) {
      node.childNodes.forEach((child) => visit(child as typeof node));
    }
  };

  tree.store.root.childNodes.forEach((node) => visit(node as Parameters<typeof visit>[0]));
  return result;
}

function selectVisibleRange(fromId: string, toId: string) {
  const order = getVisiblePageOrder();
  const fromIdx = order.findIndex((page) => page.id === fromId);
  const toIdx = order.findIndex((page) => page.id === toId);
  if (fromIdx < 0 || toIdx < 0) return;

  const [start, end] = fromIdx <= toIdx ? [fromIdx, toIdx] : [toIdx, fromIdx];
  const next = new Set(selectedPageIds.value);
  for (let i = start; i <= end; i += 1) {
    next.add(order[i].id);
  }
  selectedPageIds.value = next;
}

function isDescendantOf(pageId: string, ancestorId: string): boolean {
  let parentId = findPageById(pageId)?.parentId ?? null;
  while (parentId) {
    if (parentId === ancestorId) return true;
    parentId = findPageById(parentId)?.parentId ?? null;
  }
  return false;
}

function getTopLevelSelectedIds(ids: Set<string>): string[] {
  return [...ids].filter((id) => (
    ![...ids].some((other) => other !== id && isDescendantOf(id, other))
  ));
}

function getPagesToDelete(): PageItem[] {
  const ids = selectedPageIds.value.size > 0
    ? selectedPageIds.value
    : store.currentPageId
      ? new Set([store.currentPageId])
      : new Set<string>();

  return getTopLevelSelectedIds(ids)
    .map((id) => findPageById(id))
    .filter((page): page is PageItem => page != null);
}

function focusPageTree() {
  pageTreeFocusRef.value?.focus();
}

function buildDeleteConfirmMessage(pages: PageItem[]): string {
  if (pages.length === 1) {
    return `确认删除“${pages[0].title}”及其所有子页面？`;
  }
  return `确认删除选中的 ${pages.length} 个页面及其所有子页面？`;
}

async function confirmPageDelete(pages: PageItem[]): Promise<boolean> {
  let keyHandler: ((event: KeyboardEvent) => void) | null = null;

  const confirmPromise = ElMessageBox.confirm(
    buildDeleteConfirmMessage(pages),
    '删除确认',
    {
      confirmButtonText: '删除',
      cancelButtonText: '取消',
      type: 'warning',
      distinguishCancelAndClose: true,
    },
  );

  await nextTick();
  keyHandler = (event: KeyboardEvent) => {
    if (event.key !== 'Delete') return;
    if (isTypingTarget(event.target)) return;
    const messageBox = document.querySelector('.el-message-box');
    if (!messageBox) return;
    event.preventDefault();
    event.stopPropagation();
    const confirmBtn = messageBox.querySelector('.el-message-box__btns .el-button--primary') as HTMLButtonElement | null;
    confirmBtn?.click();
  };
  document.addEventListener('keydown', keyHandler, true);

  try {
    await confirmPromise;
    return true;
  } catch {
    return false;
  } finally {
    if (keyHandler) {
      document.removeEventListener('keydown', keyHandler, true);
    }
  }
}

async function deleteSelectedPages(pages: PageItem[]) {
  if (pages.length === 0) return;
  const confirmed = await confirmPageDelete(pages);
  if (!confirmed) return;

  for (let i = 0; i < pages.length; i += 1) {
    await store.removePage(pages[i].id, { refreshTree: i === pages.length - 1 });
  }
  selectedPageIds.value = new Set();
  selectionAnchorId.value = null;
  ElMessage.success(pages.length === 1 ? '已删除' : `已删除 ${pages.length} 个页面`);
}

function shouldHandlePageDeleteKey(event: KeyboardEvent): boolean {
  if (event.key !== 'Delete') return false;
  if (isTypingTarget(event.target)) return false;
  if (renamingId.value) return false;
  if (showAddKbDialog.value) return false;
  if (document.querySelector('.el-message-box')) return false;

  const inLeftPanel = (event.target as HTMLElement | null)?.closest('.left-panel');
  if (selectedPageIds.value.size <= 1 && !inLeftPanel) return false;

  return getPagesToDelete().length > 0;
}

function handlePageDeleteKeydown(event: KeyboardEvent) {
  if (!shouldHandlePageDeleteKey(event)) return;
  event.preventDefault();
  void deleteSelectedPages(getPagesToDelete());
}

watch(
  () => store.currentPageId,
  (pageId) => {
    if (selectedPageIds.value.size <= 1) {
      selectedPageIds.value = pageId ? new Set([pageId]) : new Set();
      if (pageId) selectionAnchorId.value = pageId;
    }
  },
);

watch(
  () => store.currentKbId,
  () => {
    selectedPageIds.value = new Set();
    selectionAnchorId.value = null;
  },
);

onMounted(() => {
  document.addEventListener('keydown', handlePageDeleteKeydown, true);
});

onBeforeUnmount(() => {
  document.removeEventListener('keydown', handlePageDeleteKeydown, true);
  document.removeEventListener('click', closeContextMenu);
  document.removeEventListener('keydown', closeContextMenuOnEscape);
});

async function onSelectKb(kbId: string) {
  if (store.currentKbId === kbId) return;
  await store.selectKb(kbId);
}

async function onAddKb() {
  const name = newKbName.value.trim();
  if (!name) return;
  await store.addKb(name);
  newKbName.value = '';
  showAddKbDialog.value = false;
  ElMessage.success('知识库已创建');
}

async function onDeleteKb(id: string, name: string) {
  try {
    await ElMessageBox.confirm(
      `确认删除知识库“${name}”？此操作不可撤销。`,
      '删除确认',
      {
        confirmButtonText: '删除',
        cancelButtonText: '取消',
        type: 'warning',
      },
    );
    await store.removeKb(id);
    ElMessage.success('已删除');
  } catch {
    // ignore cancel
  }
}

const selectedPageCount = computed(() => selectedPageIds.value.size);

const treeProps = {
  label: 'title',
  children: 'children',
};

const contextMenu = ref({ visible: false, x: 0, y: 0, node: null as PageItem | null });

function onNodeContextMenu(event: Event, data: unknown) {
  (event as MouseEvent).preventDefault();
  const e = event as MouseEvent;
  const node = data as PageItem;
  if (!isPageSelected(node.id) && !(e.ctrlKey || e.metaKey || e.shiftKey)) {
    setSingleSelection(node.id);
    void store.selectPage(node.id);
  }
  contextMenu.value = { visible: true, x: e.clientX, y: e.clientY, node };
}

function closeContextMenu() {
  contextMenu.value.visible = false;
}

function closeContextMenuOnEscape(event: KeyboardEvent) {
  if (event.key === 'Escape') closeContextMenu();
}

watch(
  () => contextMenu.value.visible,
  (visible) => {
    if (visible) {
      document.addEventListener('click', closeContextMenu);
      document.addEventListener('keydown', closeContextMenuOnEscape);
    } else {
      document.removeEventListener('click', closeContextMenu);
      document.removeEventListener('keydown', closeContextMenuOnEscape);
    }
  },
);

function onNodeClick(data: PageItem, _node: unknown, _instance: unknown, event: MouseEvent) {
  const multi = event.ctrlKey || event.metaKey;
  const range = event.shiftKey;

  if (range) {
    const anchor = selectionAnchorId.value ?? store.currentPageId ?? data.id;
    selectionAnchorId.value = anchor;
    selectVisibleRange(anchor, data.id);
    void store.selectPage(data.id);
    focusPageTree();
    return;
  }

  if (multi) {
    togglePageSelection(data.id);
    selectionAnchorId.value = data.id;
    void store.selectPage(data.id);
    focusPageTree();
    return;
  }

  setSingleSelection(data.id);
  void store.selectPage(data.id);
  focusPageTree();
}

async function onCreateChild(parentId: string, pageType: PageType = 'document') {
  closeContextMenu();
  await store.addPage(parentId, undefined, pageType);
  ElMessage.success(createSuccessMessage(pageType));
}

async function onCreateRootPage(pageType: PageType) {
  await store.addPage(null, undefined, pageType);
  ElMessage.success(createSuccessMessage(pageType));
}

function createSuccessMessage(pageType: PageType): string {
  if (pageType === 'mindmap') return '思维导图已创建';
  if (pageType === 'x6board') return '画板已创建';
  return '页面已创建';
}

function onCreateRootCommand(command: string | number | object) {
  const pageType = command === 'mindmap'
    ? 'mindmap'
    : command === 'x6board'
      ? 'x6board'
      : 'document';
  void onCreateRootPage(pageType);
}

async function onDeletePage(node: PageItem) {
  closeContextMenu();
  if (selectedPageIds.value.size > 1 && isPageSelected(node.id)) {
    await deleteSelectedPages(getPagesToDelete());
    return;
  }
  await deleteSelectedPages([node]);
}

async function onDeleteSelectedPages() {
  closeContextMenu();
  await deleteSelectedPages(getPagesToDelete());
}

function onStartRename(node: PageItem) {
  closeContextMenu();
  renamingId.value = node.id;
  renameValue.value = node.title;
  nextTick(() => {
    renameInputRef.value?.focus();
  });
}

async function onFinishRename(node: PageItem) {
  const title = renameValue.value.trim();
  if (title && title !== node.title) {
    await store.renameCurrentPage(node.id, title);
    ElMessage.success('已重命名');
  }
  renamingId.value = null;
}

function allowDrop() {
  return true;
}

async function onNodeDrop(draggingNode: any, dropNode: any, dropType: 'before' | 'after' | 'inner') {
  const dragging = draggingNode.data as PageItem;
  const drop = dropNode.data as PageItem;
  const newParentId = dropType === 'inner' ? drop.id : drop.parentId;
  await store.reorderPage(dragging.id, newParentId, 0);
}

function expandAllTree() {
  const nodesMap = treeRef.value?.store?.nodesMap
  if (!nodesMap) return
  for (const key of Object.keys(nodesMap)) {
    const node = nodesMap[key]
    if (!node.isLeaf) {
      node.expanded = true
    }
  }
  allTreeExpanded.value = true
}

function collapseAllTree() {
  const nodesMap = treeRef.value?.store?.nodesMap
  if (!nodesMap) return
  for (const key of Object.keys(nodesMap)) {
    const node = nodesMap[key]
    if (!node.isLeaf) {
      node.expanded = false
    }
  }
  allTreeExpanded.value = false
}
</script>

<template>
  <div class="left-panel">
    <AuthPanel />

    <div class="search-section">
      <GlobalSearchBox />
    </div>

    <div class="section">
      <div class="section-header">
        <span class="section-title">知识库</span>
        <div class="section-actions">
          <RoadmapImportButton />
          <el-button
            link
            size="small"
            title="新建知识库"
            @click.stop="showAddKbDialog = true"
          >
            +
          </el-button>
        </div>
      </div>

      <el-scrollbar class="kb-list">
        <div
          v-for="kb in store.kbList"
          :key="kb.id"
          class="kb-item"
          :class="{ 'kb-item--active': store.currentKbId === kb.id }"
          @click.stop="onSelectKb(kb.id)"
        >
          <span class="kb-icon">{{ kb.icon ?? '📚' }}</span>
          <span class="kb-name">{{ kb.name }}</span>
          <el-button
            class="kb-delete"
            link
            size="small"
            title="删除知识库"
            @click.stop="onDeleteKb(kb.id, kb.name)"
          >
            ×
          </el-button>
        </div>

        <div v-if="store.kbList.length === 0" class="empty-hint">
          暂无知识库
        </div>
      </el-scrollbar>
    </div>

    <div class="divider" />

    <div class="section section--grow">
      <div class="section-header">
        <span class="section-title">页面</span>
        <div class="section-actions">
          <button
            v-if="store.pageTree.length > 0"
            type="button"
            class="tree-action-btn"
            :title="allTreeExpanded ? '全部收起' : '全部展开'"
            @click.stop="allTreeExpanded ? collapseAllTree() : expandAllTree()"
          >
            {{ allTreeExpanded ? '收起' : '展开' }}
          </button>
          <MarkdownImportButton />
          <el-dropdown
            trigger="click"
            :disabled="!store.currentKbId"
            @command="onCreateRootCommand"
          >
            <el-button
              link
              size="small"
              title="新建页面"
              :disabled="!store.currentKbId"
              @click.stop
            >
              +
            </el-button>
            <template #dropdown>
              <el-dropdown-menu>
                <el-dropdown-item command="document">文档</el-dropdown-item>
                <el-dropdown-item command="mindmap">思维导图</el-dropdown-item>
                <el-dropdown-item command="x6board">画板</el-dropdown-item>
              </el-dropdown-menu>
            </template>
          </el-dropdown>
        </div>
      </div>

      <div
        ref="pageTreeFocusRef"
        class="page-tree-scroll-host"
        tabindex="-1"
      >
      <el-scrollbar class="page-tree-scroll">
        <el-tree
          ref="treeRef"
          v-if="store.pageTree.length > 0"
          :data="store.pageTree"
          :props="treeProps"
          node-key="id"
          draggable
          :allow-drop="allowDrop"
          :highlight-current="true"
          :current-node-key="store.currentPageId ?? undefined"
          @node-click="onNodeClick"
          @node-contextmenu="onNodeContextMenu"
          @node-drop="onNodeDrop"
          class="page-tree"
        >
          <template #default="{ node, data }">
            <span
              class="tree-node"
              :class="{ 'tree-node--selected': isPageSelected(data.id) }"
            >
              <span
                class="node-icon"
                aria-hidden="true"
              >
                <svg
                  v-if="data.pageType === 'mindmap'"
                  class="node-icon__mindmap"
                  viewBox="0 0 12 12"
                  fill="none"
                >
                  <path
                    d="M6 1.5v3.5M6 5H2.5M6 5h3.5M2.5 5v4.5M9.5 5v4.5"
                    stroke="currentColor"
                    stroke-width="1.2"
                    stroke-linecap="round"
                  />
                </svg>
                <svg
                  v-else-if="data.pageType === 'x6board'"
                  class="node-icon__x6board"
                  viewBox="0 0 12 12"
                  fill="none"
                >
                  <rect x="1.5" y="1.5" width="9" height="9" rx="1.5" stroke="currentColor" stroke-width="1.2" />
                  <path d="M4 8V4h4" stroke="currentColor" stroke-width="1.2" stroke-linecap="round" />
                </svg>
                <span v-else class="node-icon__doc">📄</span>
              </span>
              <el-input
                v-if="renamingId === data.id"
                ref="renameInputRef"
                v-model="renameValue"
                size="small"
                class="rename-input"
                @blur="onFinishRename(data)"
                @keyup.enter="onFinishRename(data)"
                @keyup.esc="renamingId = null"
                @click.stop
              />
              <span v-else class="node-label">{{ node.label }}</span>
            </span>
          </template>
        </el-tree>

        <div v-else-if="store.currentKbId" class="empty-hint">
          暂无页面，点击上方按钮新建或导入 Markdown
        </div>
        <div v-else class="empty-hint">
          请先选择知识库
        </div>
      </el-scrollbar>
      </div>
    </div>

    <Teleport to="body">
      <div
        v-if="contextMenu.visible && contextMenu.node"
        class="context-menu"
        :style="{ left: contextMenu.x + 'px', top: contextMenu.y + 'px' }"
        @mousedown.stop
        @click.stop
      >
        <div class="context-menu-item" @click="onCreateChild(contextMenu.node!.id, 'document')">
          文档
        </div>
        <div class="context-menu-item" @click="onCreateChild(contextMenu.node!.id, 'mindmap')">
          思维导图
        </div>
        <div class="context-menu-item" @click="onCreateChild(contextMenu.node!.id, 'x6board')">
          画板
        </div>
        <div class="context-menu-item" @click="onStartRename(contextMenu.node!)">
          重命名
        </div>
        <div class="context-menu-divider" />
        <div
          class="context-menu-item context-menu-item--danger"
          @click="selectedPageCount > 1 && contextMenu.node && isPageSelected(contextMenu.node.id) ? onDeleteSelectedPages() : onDeletePage(contextMenu.node!)"
        >
          {{ selectedPageCount > 1 && contextMenu.node && isPageSelected(contextMenu.node.id) ? `删除 ${selectedPageCount} 个页面` : '删除' }}
        </div>
      </div>
    </Teleport>

    <el-dialog v-model="showAddKbDialog" title="新建知识库" width="360px" @click.stop>
      <el-input
        v-model="newKbName"
        placeholder="请输入知识库名称"
        @keyup.enter="onAddKb"
        autofocus
      />
      <template #footer>
        <el-button @click="showAddKbDialog = false">取消</el-button>
        <el-button type="primary" :disabled="!newKbName.trim()" @click="onAddKb">
          创建
        </el-button>
      </template>
    </el-dialog>
  </div>
</template>

<style scoped>
.left-panel {
  display: flex;
  flex-direction: column;
  height: 100%;
  background: #f7f8fa;
  overflow: hidden;
  user-select: none;
}

.search-section {
  padding: 8px 12px;
  flex-shrink: 0;
}

.section {
  display: flex;
  flex-direction: column;
  min-height: 0;
}

.section--grow {
  flex: 1;
  overflow: hidden;
}

.section-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 10px 12px 6px;
  flex-shrink: 0;
}

.section-title {
  font-size: 11px;
  font-weight: 600;
  color: #8c8c8c;
  text-transform: uppercase;
  letter-spacing: 0.06em;
}

.section-actions {
  display: inline-flex;
  align-items: center;
  gap: 4px;
}

.tree-action-btn {
  border: 0;
  background: transparent;
  color: #1677ff;
  font-size: 11px;
  cursor: pointer;
  padding: 2px 6px;
  border-radius: 4px;
  transition: background 0.15s;
}

.tree-action-btn:hover {
  background: rgba(22, 119, 255, 0.08);
}

.kb-list {
  max-height: 180px;
  padding: 0 8px 8px;
}

.kb-item {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 6px 8px;
  border-radius: 6px;
  cursor: pointer;
  transition: background 0.15s;
}

.kb-item:hover {
  background: #ebebeb;
}

.kb-item--active {
  background: #e6f4ff;
  color: #1677ff;
}

.kb-icon {
  font-size: 16px;
  flex-shrink: 0;
}

.kb-name {
  flex: 1;
  font-size: 13px;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.kb-delete {
  opacity: 0;
  transition: opacity 0.15s;
  color: #999;
  font-size: 16px !important;
  padding: 0 !important;
}

.kb-item:hover .kb-delete {
  opacity: 1;
}

.divider {
  height: 1px;
  background: #e4e4e4;
  margin: 4px 0;
  flex-shrink: 0;
}

.page-tree-scroll-host {
  flex: 1;
  min-height: 0;
  display: flex;
  flex-direction: column;
  outline: none;
}

.page-tree-scroll-host:focus-visible {
  box-shadow: inset 0 0 0 2px rgba(22, 119, 255, 0.25);
  border-radius: 6px;
}

.page-tree-scroll {
  flex: 1;
  padding: 0 4px 8px;
}

.page-tree {
  background: transparent;
}

.page-tree :deep(.el-tree-node__content) {
  height: 32px;
  border-radius: 6px;
  padding-right: 4px;
}

.page-tree :deep(.el-tree-node__content:hover) {
  background: #ebebeb;
}

.page-tree :deep(.el-tree-node.is-current > .el-tree-node__content) {
  background: #e6f4ff;
  color: #1677ff;
}

.page-tree :deep(.el-tree-node__content:has(.tree-node--selected)) {
  background: #d6eaff;
}

.page-tree :deep(.el-tree-node.is-current > .el-tree-node__content:has(.tree-node--selected)) {
  background: #bae0ff;
  color: #1677ff;
}

.tree-node {
  display: flex;
  align-items: center;
  flex: 1;
  overflow: hidden;
  gap: 4px;
}

.node-icon {
  flex-shrink: 0;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 14px;
  height: 14px;
  line-height: 1;
}

.node-icon__doc {
  font-size: 12px;
}

.node-icon__mindmap,
.node-icon__x6board {
  width: 12px;
  height: 12px;
  color: #6b7280;
}

.node-label {
  font-size: 13px;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.rename-input {
  flex: 1;
  font-size: 13px;
}

.context-menu {
  position: fixed;
  z-index: 9999;
  background: #fff;
  border: 1px solid #e4e4e4;
  border-radius: 8px;
  box-shadow: 0 4px 16px rgba(0, 0, 0, 0.12);
  padding: 4px 0;
  min-width: 140px;
}

.context-menu-item {
  padding: 7px 14px;
  font-size: 13px;
  cursor: pointer;
  transition: background 0.12s;
}

.context-menu-item:hover {
  background: #f5f5f5;
}

.context-menu-item--danger {
  color: #ff4d4f;
}

.context-menu-divider {
  height: 1px;
  background: #f0f0f0;
  margin: 4px 0;
}

.empty-hint {
  padding: 16px 12px;
  font-size: 12px;
  color: #bbb;
  text-align: center;
}
</style>
