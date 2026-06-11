<script setup lang="ts">
import type { TocTreeItem } from '@/utils/toc/headings'
import { headingSourceBadgeLabel } from '@/utils/headingSource'

defineProps<{
  items: TocTreeItem[]
  highlightedBlockId: string | null
  isExpanded: (item: TocTreeItem) => boolean
}>()

const emit = defineEmits<{
  click: [item: TocTreeItem]
  toggle: [item: TocTreeItem]
  'context-menu': [item: TocTreeItem, event: MouseEvent]
  'source-click': [item: TocTreeItem]
}>()

const onItemClick = (item: TocTreeItem) => {
  emit('click', item)
}

const onToggleClick = (item: TocTreeItem) => {
  emit('toggle', item)
}

const onContextMenu = (item: TocTreeItem, event: MouseEvent) => {
  emit('context-menu', item, event)
}

const onSourceClick = (item: TocTreeItem, event: MouseEvent) => {
  event.preventDefault()
  event.stopPropagation()
  emit('source-click', item)
}

const itemClasses = (item: TocTreeItem, highlightedBlockId: string | null) => [
  'page-toc__item',
  item.sourceType === 'ref-group' && item.level === 0
    ? 'page-toc__item--ref'
    : `page-toc__item--level-${item.level}`,
  { 'page-toc__item--active': highlightedBlockId === item.blockId },
]
</script>

<template>
  <template v-for="item in items" :key="item.id">
    <div
      v-if="item.children?.length"
      :class="item.sourceType === 'ref-group' ? 'page-toc__group' : 'page-toc__local-group'"
    >
      <button
        type="button"
        :class="itemClasses(item, highlightedBlockId)"
        @click="onItemClick(item)"
        @contextmenu="onContextMenu(item, $event)"
      >
        <span
          class="page-toc__bullet page-toc__bullet--group"
          @click.stop="onToggleClick(item)"
        >
          {{ isExpanded(item) ? '▼' : '▶' }}
        </span>
        <span class="page-toc__text">{{ item.text }}</span>
        <button
          v-if="item.sourceBinding"
          type="button"
          class="page-toc__source"
          :title="headingSourceBadgeLabel(item.sourceBinding)"
          @click="onSourceClick(item, $event)"
        >
          来源
        </button>
      </button>
      <div
        v-if="isExpanded(item)"
        :class="item.sourceType === 'ref-group' ? 'page-toc__children' : 'page-toc__local-children'"
      >
        <TocTreeList
          :items="item.children"
          :highlighted-block-id="highlightedBlockId"
          :is-expanded="isExpanded"
          @click="emit('click', $event)"
          @toggle="emit('toggle', $event)"
          @context-menu="(tocItem, event) => emit('context-menu', tocItem, event)"
          @source-click="emit('source-click', $event)"
        />
      </div>
    </div>

    <div v-else-if="item.sourceType === 'ref-child'" class="page-toc__inline-ref-child">
      <button
        type="button"
        class="page-toc__item"
        :class="{
          'page-toc__item--active': highlightedBlockId === item.blockId,
          [`page-toc__item--level-${item.level}`]: true,
        }"
        @click="onItemClick(item)"
      >
        <span class="page-toc__text">{{ item.text }}</span>
      </button>
    </div>

    <button
      v-else
      type="button"
      class="page-toc__item"
      :class="{
        'page-toc__item--active': highlightedBlockId === item.blockId,
        [`page-toc__item--level-${item.level}`]: true,
      }"
      @click="onItemClick(item)"
      @contextmenu="onContextMenu(item, $event)"
    >
      <span class="page-toc__text">{{ item.text }}</span>
      <span
        v-if="item.sourceBinding"
        class="page-toc__source"
        role="button"
        tabindex="0"
        :title="headingSourceBadgeLabel(item.sourceBinding)"
        @click="onSourceClick(item, $event)"
        @keydown.enter.prevent="emit('source-click', item)"
      >
        来源
      </span>
    </button>
  </template>
</template>

<script lang="ts">
export default {
  name: 'TocTreeList',
}
</script>

<style scoped>
.page-toc__source {
  flex-shrink: 0;
  margin-left: 6px;
  padding: 0 6px;
  border: 1px solid #bfdbfe;
  border-radius: 999px;
  background: #eff6ff;
  color: #075985;
  font-size: 10px;
  line-height: 1.6;
  cursor: pointer;
}

.page-toc__source:hover {
  background: #dbeafe;
}
</style>
