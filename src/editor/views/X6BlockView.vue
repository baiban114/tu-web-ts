<script setup lang="ts">
import { computed, inject, unref, type Ref } from 'vue'
import { nodeViewProps, NodeViewWrapper } from '@tiptap/vue-3'
import ResizableBlockWrapper from '../components/ResizableBlockWrapper.vue'
import X6Component from '@/components/X6Component.vue'

const props = defineProps(nodeViewProps)

interface CompoundBadge {
  annotationId: string
  color: string
}

const compoundAnnotationBadges = inject<Record<string, CompoundBadge[]> | Ref<Record<string, CompoundBadge[]>>>('compoundAnnotationBadges', {})
const onCompoundBadgeClick = inject<((blockId: string, annotationId: string, event: MouseEvent) => void)>('onCompoundBadgeClick', () => {})

const blockId = computed(() => props.node.attrs.blockId || '')
const compoundBadges = computed(() => unref(compoundAnnotationBadges)[blockId.value] || [])

const graphData = computed({
  get: () => props.node.attrs.graphData,
  set: (val) => props.updateAttributes({ graphData: val }),
})

const onResize = (width: number | null, height: number | null) => {
  props.updateAttributes({ width, height })
}

const handleBadgeClick = (bid: string, annotationId: string, event: MouseEvent) => {
  onCompoundBadgeClick(bid, annotationId, event)
}
</script>

<template>
  <node-view-wrapper class="x6-block-view">
    <ResizableBlockWrapper
      :selected="selected"
      :resizable-axes="{ width: true, height: true }"
      :min-width="200"
      :min-height="150"
      block-type-label="X6 画板"
      :block-id="blockId"
      block-type="x6"
      :compound-badges="compoundBadges"
      @resize="onResize"
      @compound-badge-click="handleBadgeClick"
    >
      <X6Component
        :graph-data="graphData"
        :width="props.node.attrs.width"
        :height="props.node.attrs.height"
        @graph-data-change="graphData = $event"
      />
    </ResizableBlockWrapper>
  </node-view-wrapper>
</template>
