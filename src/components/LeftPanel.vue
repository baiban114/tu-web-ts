<script setup lang="ts">
import { ref, watch, nextTick } from 'vue';
import {
  ElScrollbar,
  ElTree,
  ElButton,
  ElInput,
  ElDialog,
  ElMessageBox,
  ElMessage,
} from 'element-plus';
import { useWorkspaceStore } from '@/stores/workspace';
import type { PageItem } from '@/api/page';

const store = useWorkspaceStore();

// ─── 知识库操作 ────────────────────────────────────────────────────────────────
const showAddKbDialog = ref(false);
const newKbName = ref('');

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
    await ElMessageBox.confirm(`确认删除知识库「${name}」？此操作不可撤销。`, '删除确认', {
      confirmButtonText: '删除',
      cancelButtonText: '取消',
      type: 'warning',
    });
    await store.removeKb(id);
    ElMessage.success('已删除');
  } catch {
    // 用户取消
  }
}

// ─── 页面树操作 ────────────────────────────────────────────────────────────────
const treeProps = {
  label: 'title',
  children: 'children',
};

// 右键菜单
const contextMenu = ref({ visible: false, x: 0, y: 0, node: null as PageItem | null });

// el-tree 事件签名: (evt, data, node, instance)
function onNodeContextMenu(event: Event, data: any) {
  (event as MouseEvent).preventDefault();
  const e = event as MouseEvent;
  contextMenu.value = { visible: true, x: e.clientX, y: e.clientY, node: data as PageItem };
}

function closeContextMenu() {
  contextMenu.value.visible = false;
}

// 点击页面节点
function onNodeClick(data: PageItem) {
  store.selectPage(data.id);
}

// 创建子页面
async function onCreateChild(parentId: string) {
  closeContextMenu();
  await store.addPage(parentId);
  ElMessage.success('子页面已创建');
}

// 创建根页面
async function onCreateRootPage() {
  await store.addPage(null);
  ElMessage.success('页面已创建');
}

// 删除页面
async function onDeletePage(node: PageItem) {
  closeContextMenu();
  try {
    await ElMessageBox.confirm(
      `确认删除「${node.title}」及其所有子页面？`,
      '删除确认',
      { confirmButtonText: '删除', cancelButtonText: '取消', type: 'warning' },
    );
    await store.removePage(node.id);
    ElMessage.success('已删除');
  } catch {
    // 用户取消
  }
}

// 内联重命名
const renamingId = ref<string | null>(null);
const renameValue = ref('');
const renameInputRef = ref<InstanceType<typeof ElInput> | null>(null);

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

// 拖拽移动
function allowDrop() {
  return true;
}

// el-tree 拖拽落下事件
async function onNodeDrop(draggingNode: any, dropNode: any, dropType: 'before' | 'after' | 'inner') {
  const dragging = draggingNode.data as PageItem;
  const drop = dropNode.data as PageItem;
  const newParentId = dropType === 'inner' ? drop.id : drop.parentId;
  await store.reorderPage(dragging.id, newParentId, 0);
}

// 点击页面外部关闭右键菜单
function onDocumentClick() {
  closeContextMenu();
}
</script>

<template>
  <div class="left-panel" @click="onDocumentClick">
    <!-- ── 知识库区域 ─────────────────────────── -->
    <div class="section">
      <div class="section-header">
        <span class="section-title">知识库</span>
        <el-button
          link
          size="small"
          title="新建知识库"
          @click.stop="showAddKbDialog = true"
        >
          +
        </el-button>
      </div>

      <el-scrollbar class="kb-list">
        <div
          v-for="kb in store.kbList"
          :key="kb.id"
          class="kb-item"
          :class="{ 'kb-item--active': store.currentKbId === kb.id }"
          @click.stop="onSelectKb(kb.id)"
        >
          <span class="kb-icon">{{ kb.icon ?? '📄' }}</span>
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

    <!-- ── 页面树区域 ─────────────────────────── -->
    <div class="section section--grow">
      <div class="section-header">
        <span class="section-title">页面</span>
        <el-button
          link
          size="small"
          title="新建根页面"
          :disabled="!store.currentKbId"
          @click.stop="onCreateRootPage"
        >
          +
        </el-button>
      </div>

      <el-scrollbar class="page-tree-scroll">
        <el-tree
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
            <span class="tree-node">
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
          暂无页面，点击 + 新建
        </div>
        <div v-else class="empty-hint">
          请先选择知识库
        </div>
      </el-scrollbar>
    </div>

    <!-- ── 右键菜单 ───────────────────────────── -->
    <Teleport to="body">
      <div
        v-if="contextMenu.visible && contextMenu.node"
        class="context-menu"
        :style="{ left: contextMenu.x + 'px', top: contextMenu.y + 'px' }"
        @click.stop
      >
        <div class="context-menu-item" @click="onCreateChild(contextMenu.node!.id)">
          📄 新建子页面
        </div>
        <div class="context-menu-item" @click="onStartRename(contextMenu.node!)">
          ✏️ 重命名
        </div>
        <div class="context-menu-divider" />
        <div class="context-menu-item context-menu-item--danger" @click="onDeletePage(contextMenu.node!)">
          🗑 删除
        </div>
      </div>
    </Teleport>

    <!-- ── 新建知识库弹窗 ─────────────────────── -->
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

/* ── 区域 ── */
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

/* ── 知识库列表 ── */
.kb-list {
  max-height: 200px;
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

/* ── 分隔线 ── */
.divider {
  height: 1px;
  background: #e4e4e4;
  margin: 4px 0;
  flex-shrink: 0;
}

/* ── 页面树 ── */
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

.tree-node {
  display: flex;
  align-items: center;
  flex: 1;
  overflow: hidden;
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

/* ── 右键菜单 ── */
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

/* ── 空状态 ── */
.empty-hint {
  padding: 16px 12px;
  font-size: 12px;
  color: #bbb;
  text-align: center;
}
</style>
