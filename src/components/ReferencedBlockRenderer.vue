<script setup lang="ts">
import RichTextEditor from './RichTextEditor.vue';
import Line from './line.vue';
import TableBlock from './TableBlock.vue';
import X6Component from './X6Component.vue';
import type { Block, GraphData, TableBlockData } from '@/api/types';

const props = withDefaults(defineProps<{
  block?: Block;
  editable?: boolean;
}>(), {
  editable: true,
});

const emit = defineEmits<{
  (e: 'update-block', block: Block): void;
}>();

const isRichTextBlock = (block: Block | undefined): boolean => {
  return Boolean(block && (block.type === 'richtext' || block.type === 'richText'));
};

const renderFallbackText = (block: Block): string => {
  if (block.type === 'x6') return block.title?.trim() || '画板';
  if (block.type === 'table') return block.title?.trim() || '表格';
  if (block.type === 'line') return block.title?.trim() || '时间轴';
  if (block.type === 'container') return block.title?.trim() || '组合单元';
  return block.content ?? '';
};

const updateBlock = (patch: Partial<Block>) => {
  if (!props.block) return;
  emit('update-block', { ...props.block, ...patch });
};

const updateChildBlock = (childIndex: number, child: Block) => {
  if (!props.block?.children) return;
  const children = [...props.block.children];
  children[childIndex] = child;
  updateBlock({ children });
};
</script>

<template>
  <div v-if="block" class="referenced-block-renderer">
    <RichTextEditor
      v-if="isRichTextBlock(block)"
      :key="`ref-richtext-${block.id}`"
      :content="block.content ?? ''"
      :editable="editable"
      :line-handle-enabled="false"
      class="block-content"
      @content-change="(content: string) => updateBlock({ content })"
    />
    <X6Component
      v-else-if="block.type === 'x6'"
      :key="`ref-x6-${block.id}`"
      :graphData="block.graphData"
      :editable="editable"
      :block-actions-enabled="false"
      class="block-content board-content"
      @graph-data-change="(graphData: GraphData) => updateBlock({ graphData })"
    />
    <TableBlock
      v-else-if="block.type === 'table'"
      :key="`ref-table-${block.id}`"
      :data="block.tableData"
      :editable="editable"
      class="block-content"
      @change="(tableData: TableBlockData) => updateBlock({ tableData })"
    />
    <Line
      v-else-if="block.type === 'line'"
      :key="`ref-line-${block.id}`"
      :timelineData="block.timelineData"
      class="block-content board-content"
    />
    <div
      v-else-if="block.type === 'container'"
      :key="`ref-container-${block.id}`"
      class="referenced-container"
    >
      <ReferencedBlockRenderer
        v-for="(child, childIndex) in block.children ?? []"
        :key="child.id"
        :block="child"
        :editable="editable"
        class="referenced-container__child"
        @update-block="(updatedChild: Block) => updateChildBlock(childIndex, updatedChild)"
      />
    </div>
    <div v-else-if="block.type !== 'ref'" class="referenced-block-renderer__fallback">
      {{ renderFallbackText(block) }}
    </div>
  </div>
  <div v-else class="referenced-block-renderer__fallback">引用内容未加载</div>
</template>

<style scoped>
.referenced-block-renderer {
  display: flex;
  flex-direction: column;
  gap: 10px;
  min-width: 0;
}

.referenced-container {
  display: flex;
  flex-direction: column;
  gap: 12px;
  padding: 10px 12px;
  border: 1px solid #d6e4ff;
  border-radius: 6px;
  background: #fff;
}

.referenced-container__child {
  min-width: 0;
}

.referenced-block-renderer__fallback {
  padding: 10px 12px;
  border-radius: 6px;
  background: #fff;
  color: #595959;
  font-size: 13px;
  line-height: 1.5;
  white-space: pre-wrap;
  word-break: break-word;
}
</style>
