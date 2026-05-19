<script setup lang="ts">
import { ref, onMounted } from 'vue'
import { nodeViewProps, NodeViewContent } from '@tiptap/vue-3'
import TiptapBlockWrapper from '../components/TiptapBlockWrapper.vue'
import type { BlockActionHandleItem } from '@/components/BlockActionHandle.vue'

const props = defineProps(nodeViewProps)

const handleItems: BlockActionHandleItem[] = [
  { key: 'insert-richtext', icon: '📝', label: '插入文本块' },
  { key: 'insert-ref', icon: '🔖', label: '插入引用块' },
  { key: 'insert-line', icon: '🕒', label: '插入时间轴' },
  { key: 'insert-x6', icon: '🧩', label: '插入画板' },
  { key: 'insert-kb-roadmap', icon: '🗺️', label: '生成知识库路线图' },
  { key: 'insert-table', icon: '▦', label: '插入表格' },
  { key: 'insert-container', icon: '📦', label: '插入容器' },
  { key: 'insert-task-panel', icon: '✅', label: '插入任务面板' },
  { key: 'edit-tags', icon: '🏷️', label: '编辑标签' },
  { key: 'divider', divider: true },
  { key: 'delete', icon: '🗑️', label: '删除块', danger: true },
]
</script>

<template>
  <TiptapBlockWrapper
    v-bind="props"
    :handle-items="handleItems"
    block-type-label="richtext"
  >
    <node-view-content class="paragraph-content" />
  </TiptapBlockWrapper>
</template>

<style scoped>
.paragraph-content {
  padding: 4px 8px;
  min-height: 1.7em;
  outline: none;
}

.paragraph-content:empty::before {
  content: '输入 / 查看更多选项...';
  color: #adb5bd;
  pointer-events: none;
}
</style>
