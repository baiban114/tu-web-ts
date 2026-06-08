<script setup lang="ts">
import type { TocTreeItem } from '@/utils/toc/headings'

defineProps<{
  items: TocTreeItem[]
  highlightedBlockId: string | null
  isExpanded: (item: TocTreeItem) => boolean
}>()

const emit = defineEmits<{
  click: [item: TocTreeItem]
  toggle: [item: TocTreeItem]
}>()

const onItemClick = (item: TocTreeItem) => {
  emit('click', item)
}

const onToggleClick = (item: TocTreeItem) => {
  emit('toggle', item)
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
      >
        <span
          class="page-toc__bullet page-toc__bullet--group"
          @click.stop="onToggleClick(item)"
        >
          {{ isExpanded(item) ? '▼' : '▶' }}
        </span>
        <span class="page-toc__text">{{ item.text }}</span>
        <span v-if="item.sourceType === 'ref-group'" class="page-toc__group-count">{{ item.children.length }}</span>
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
    >
      <span class="page-toc__text">{{ item.text }}</span>
    </button>
  </template>
</template>

<script lang="ts">
export default {
  name: 'TocTreeList',
}
</script>
