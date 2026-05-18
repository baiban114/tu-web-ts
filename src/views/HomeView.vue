<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref, watch } from 'vue';
import { ElEmpty } from 'element-plus';
import { useRoute, useRouter } from 'vue-router';
import type { Block } from '@/api/types';
import DevModePanel from '@/components/DevModePanel.vue';
import LeftPanel from '@/components/LeftPanel.vue';
import Page from '@/components/Page.vue';
import { useWorkspaceStore } from '@/stores/workspace';

const store = useWorkspaceStore();
const route = useRoute();
const router = useRouter();

onMounted(() => {
  void initializeWorkspace();
});

async function initializeWorkspace() {
  await store.reloadWorkspace();
  await applyRouteSelection();
}

async function applyRouteSelection() {
  const pageId = typeof route.query.pageId === 'string' ? route.query.pageId : '';
  const blockId = typeof route.query.blockId === 'string' ? route.query.blockId : null;
  if (!pageId) return;
  await store.openPageAtBlock(pageId, blockId);
}

const leftWidth = ref(240);
const MIN_WIDTH = 160;
const MAX_WIDTH = 480;
let dragging = false;
let startX = 0;
let startWidth = 0;

const localFileStatusText = computed(() => {
  const binding = store.currentLocalFileBinding;
  if (!binding) return '';

  switch (binding.status) {
    case 'pending':
      return '检测到改动，等待自动保存。';
    case 'saving':
      return '正在保存到本地文件。';
    case 'saved':
      return binding.lastSavedAt
        ? `已保存到本地文件 ${new Date(binding.lastSavedAt).toLocaleTimeString()}`
        : '已保存到本地文件';
    case 'error':
      return binding.error || '本地文件保存失败';
    case 'unsupported':
      return binding.error || '当前浏览器不支持自动保存回原始本地文件';
    default:
      return '已绑定本地文件';
  }
});

function onResizerMousedown(e: MouseEvent) {
  dragging = true;
  startX = e.clientX;
  startWidth = leftWidth.value;
  document.addEventListener('mousemove', onMousemove);
  document.addEventListener('mouseup', onMouseup);
}

function onMousemove(e: MouseEvent) {
  if (!dragging) return;
  const delta = e.clientX - startX;
  leftWidth.value = Math.min(MAX_WIDTH, Math.max(MIN_WIDTH, startWidth + delta));
}

function onMouseup() {
  dragging = false;
  document.removeEventListener('mousemove', onMousemove);
  document.removeEventListener('mouseup', onMouseup);
}

onBeforeUnmount(() => {
  document.removeEventListener('mousemove', onMousemove);
  document.removeEventListener('mouseup', onMouseup);
});

function onContentChange(blocks: Block[]) {
  void store.saveCurrentPage(blocks);
}

watch(
  () => [route.query.pageId, route.query.blockId],
  async ([nextPageId, nextBlockId]) => {
    if (typeof nextPageId !== 'string' || !nextPageId) return;
    if (store.currentPageId === nextPageId && typeof nextBlockId !== 'string') return;
    await store.openPageAtBlock(nextPageId, typeof nextBlockId === 'string' ? nextBlockId : null);
  },
);
</script>

<template>
  <div class="workspace">
    <div class="workspace__left" :style="{ width: `${leftWidth}px` }">
      <LeftPanel />
    </div>

    <div class="workspace__resizer" @mousedown.prevent="onResizerMousedown" />

    <div class="workspace__right">
      <div class="workspace-topbar">
        <RouterLink class="workspace-topbar__link" to="/resources">引用与资源</RouterLink>
        <RouterLink class="workspace-topbar__link" :to="{ path: '/resources', query: { tab: 'objects' } }">对象管理</RouterLink>
        <button
          v-if="route.query.pageId"
          class="workspace-topbar__link workspace-topbar__link--button"
          type="button"
          @click="router.replace({ path: '/', query: {} })"
        >
          清除定位
        </button>
      </div>
      <div v-if="store.currentPageId" class="content-scroll">
        <div
          v-if="store.currentLocalFileBinding"
          class="local-file-status"
          :class="`local-file-status--${store.currentLocalFileBinding.status}`"
        >
          <div class="local-file-status__title">
            <span class="local-file-status__name">{{ store.currentLocalFileBinding.fileName }}</span>
            <span class="local-file-status__tag">LOCAL FILE</span>
          </div>
          <div class="local-file-status__message">{{ localFileStatusText }}</div>
        </div>

        <Page
          :contentList="store.currentBlocks"
          :editable="true"
          @content-change="onContentChange"
        />
      </div>

      <div v-else class="content-placeholder">
        <el-empty description="请在左侧选择或新建一个页面" :image-size="80" />
      </div>
    </div>

    <DevModePanel />
  </div>
</template>

<style scoped>
.workspace {
  display: flex;
  height: 100vh;
  overflow: hidden;
  background: #fff;
}

.workspace__left {
  flex-shrink: 0;
  overflow: hidden;
  border-right: 1px solid #e4e4e4;
  background: #f7f8fa;
}

.workspace__resizer {
  width: 4px;
  flex-shrink: 0;
  cursor: col-resize;
  background: transparent;
  transition: background 0.15s;
  position: relative;
  z-index: 10;
}

.workspace__resizer:hover,
.workspace__resizer:active {
  background: #1677ff40;
}

.workspace__right {
  flex: 1;
  min-width: 0;
  display: flex;
  flex-direction: column;
  overflow: hidden;
}

.workspace-topbar {
  display: flex;
  justify-content: flex-end;
  gap: 8px;
  flex-shrink: 0;
  padding: 10px 18px;
  border-bottom: 1px solid #edf0f5;
  background: #fff;
}

.workspace-topbar__link {
  padding: 6px 10px;
  border: 1px solid #d0d7de;
  border-radius: 6px;
  color: #1f2933;
  text-decoration: none;
  font-size: 13px;
  background: #fff;
}

.workspace-topbar__link--button {
  font: inherit;
  cursor: pointer;
}

.content-scroll {
  flex: 1;
  display: flex;
  flex-direction: column;
  overflow-y: auto;
  padding: 0 48px 32px;
}

.local-file-status {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 16px;
  padding: 12px 16px;
  margin-bottom: 20px;
  border-radius: 10px;
  border: 1px solid #d9e8ff;
  background:
    linear-gradient(135deg, rgba(9, 105, 218, 0.08), rgba(9, 105, 218, 0.02)),
    #f8fbff;
}

.local-file-status--saving,
.local-file-status--pending {
  border-color: #91caff;
  background:
    linear-gradient(135deg, rgba(22, 119, 255, 0.12), rgba(22, 119, 255, 0.03)),
    #f8fbff;
}

.local-file-status--saved {
  border-color: #b7eb8f;
  background:
    linear-gradient(135deg, rgba(82, 196, 26, 0.12), rgba(82, 196, 26, 0.02)),
    #fbfff8;
}

.local-file-status--error,
.local-file-status--unsupported {
  border-color: #ffccc7;
  background:
    linear-gradient(135deg, rgba(245, 34, 45, 0.1), rgba(245, 34, 45, 0.02)),
    #fff8f8;
}

.local-file-status__title {
  display: flex;
  align-items: center;
  gap: 10px;
  min-width: 0;
}

.local-file-status__name {
  font-size: 14px;
  font-weight: 600;
  color: #1f1f1f;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.local-file-status__tag {
  flex-shrink: 0;
  font-size: 11px;
  font-weight: 700;
  letter-spacing: 0.08em;
  color: #0958d9;
}

.local-file-status__message {
  flex-shrink: 0;
  font-size: 12px;
  color: #595959;
  text-align: right;
}

.content-placeholder {
  flex: 1;
  display: flex;
  align-items: center;
  justify-content: center;
  color: #bbb;
  font-size: 14px;
}

@media (max-width: 960px) {
  .content-scroll {
    padding: 0 18px 24px;
  }

  .local-file-status {
    flex-direction: column;
    align-items: flex-start;
  }

  .local-file-status__message {
    text-align: left;
  }
}
</style>
