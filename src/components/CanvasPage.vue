<script setup lang="ts">
import { computed, onBeforeUnmount } from 'vue'
import X6BoardBlock from '@/components/X6BoardBlock.vue'
import type { GraphData, PageContent, PageType } from '@/api/types'
import { resolvePrimaryEmbed } from '@/utils/boardPageContent'

const props = defineProps<{
  pageType: Extract<PageType, 'mindmap' | 'x6board'>
  content: PageContent
  pageTitle: string
}>()

const emit = defineEmits<{
  'content-change': [content: PageContent]
  'page-title-change': [title: string]
}>()

const primaryEmbed = computed(() => resolvePrimaryEmbed(props.content, props.pageType))
const graphData = computed(() => primaryEmbed.value?.graphData)

let saveTimer: number | null = null
const SAVE_DELAY = 500

function scheduleSave(next: PageContent) {
  if (saveTimer !== null) window.clearTimeout(saveTimer)
  saveTimer = window.setTimeout(() => {
    saveTimer = null
    emit('content-change', next)
  }, SAVE_DELAY)
}

function onGraphDataChange(data: GraphData) {
  const embed = primaryEmbed.value
  if (!embed) return
  const nextEmbeds = props.content.embeds.map((item) => (
    item.id === embed.id ? { ...item, graphData: data } : item
  ))
  scheduleSave({ ...props.content, embeds: nextEmbeds })
}

function onPageTitleChange(title: string) {
  emit('page-title-change', title)
}

onBeforeUnmount(() => {
  if (saveTimer !== null) window.clearTimeout(saveTimer)
})
</script>

<template>
  <div class="canvas-page">
    <X6BoardBlock
      v-if="primaryEmbed && graphData"
      class="canvas-page__board"
      mode="page"
      :graph-data="graphData"
      :page-title="pageTitle"
      @graph-data-change="onGraphDataChange"
      @page-title-change="onPageTitleChange"
    />
  </div>
</template>

<style scoped>
.canvas-page {
  flex: 1;
  min-height: 0;
  display: flex;
  flex-direction: column;
  overflow: hidden;
}

.canvas-page__board {
  flex: 1;
  min-height: 0;
}
</style>
