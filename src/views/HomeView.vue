<script setup lang="ts">
import { ref, onMounted, onBeforeUnmount } from 'vue';
import { ElEmpty } from 'element-plus';
import type { Block } from '@/api/types';
import DevModePanel from '@/components/DevModePanel.vue';
import LeftPanel from '@/components/LeftPanel.vue';
import Page from '@/components/Page.vue';
import { useWorkspaceStore } from '@/stores/workspace';

const store = useWorkspaceStore();

onMounted(() => {
  store.reloadWorkspace();
});

const leftWidth = ref(240);
const MIN_WIDTH = 160;
const MAX_WIDTH = 480;
let dragging = false;
let startX = 0;
let startWidth = 0;

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
  store.saveCurrentPage(blocks);
}
</script>

<template>
  <div class="workspace">
    <div class="workspace__left" :style="{ width: `${leftWidth}px` }">
      <LeftPanel />
    </div>

    <div class="workspace__resizer" @mousedown.prevent="onResizerMousedown" />

    <div class="workspace__right">
      <div v-if="store.currentPageId" class="content-scroll">
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

.content-scroll {
  flex: 1;
  display: flex;
  flex-direction: column;
  overflow-y: auto;
  padding: 32px 48px;
}

.content-placeholder {
  flex: 1;
  display: flex;
  align-items: center;
  justify-content: center;
  color: #bbb;
  font-size: 14px;
}
</style>
