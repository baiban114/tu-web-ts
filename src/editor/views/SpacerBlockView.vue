<script setup lang="ts">
import { nodeViewProps } from '@tiptap/vue-3'
import TiptapBlockWrapper from '../components/TiptapBlockWrapper.vue'
import type { BlockActionHandleItem } from '@/components/BlockActionHandle.vue'

const props = defineProps(nodeViewProps)

const handleItems: BlockActionHandleItem[] = [
  { key: 'insert-richtext', icon: '📝', label: '插入文本块' },
  { key: 'insert-ref', icon: '🔖', label: '插入引用块' },
  { key: 'insert-line', icon: '🕒', label: '插入时间轴' },
  { key: 'insert-x6', icon: '🧩', label: '插入画板' },
  { key: 'insert-table', icon: '▦', label: '插入表格' },
  { key: 'edit-tags', icon: '🏷️', label: '编辑标签' },
  { key: 'divider-danger', divider: true },
  { key: 'delete', icon: '🗑️', label: '删除块', danger: true },
]
</script>

<template>
  <TiptapBlockWrapper
    v-bind="props"
    :handle-items="handleItems"
    block-type-label="spacer"
  />
</template>
