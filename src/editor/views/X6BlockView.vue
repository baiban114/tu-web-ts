<script setup lang="ts">
import { computed } from 'vue'
import { nodeViewProps } from '@tiptap/vue-3'
import TiptapBlockWrapper from '../components/TiptapBlockWrapper.vue'
import X6Component from '@/components/X6Component.vue'
import type { BlockActionHandleItem } from '@/components/BlockActionHandle.vue'

const props = defineProps(nodeViewProps)

const graphData = computed({
  get: () => props.node.attrs.graphData,
  set: (val) => props.updateAttributes({ graphData: val }),
})

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
  { key: 'divider-danger', divider: true },
  { key: 'delete', icon: '🗑️', label: '删除块', danger: true },
]
</script>

<template>
  <TiptapBlockWrapper
    v-bind="props"
    :handle-items="handleItems"
    block-type-label="x6"
  >
    <X6Component
      :graph-data="graphData"
      @update:graph-data="graphData = $event"
    />
  </TiptapBlockWrapper>
</template>
