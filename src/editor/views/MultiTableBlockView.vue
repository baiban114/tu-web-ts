<script setup lang="ts">
import { computed, inject, unref, type Ref } from 'vue'
import { nodeViewProps, NodeViewWrapper } from '@tiptap/vue-3'
import ResizableBlockWrapper from '../components/ResizableBlockWrapper.vue'
import MultiTableBlock from '@/components/MultiTableBlock.vue'
import type { MultiTableData } from '@/api/types'

const props = defineProps(nodeViewProps)

interface CompoundBadge {
  annotationId: string
  color: string
}

const compoundAnnotationBadges = inject<Record<string, CompoundBadge[]> | Ref<Record<string, CompoundBadge[]>>>('compoundAnnotationBadges', {})
const onCompoundBadgeClick = inject<((blockId: string, annotationId: string, event: MouseEvent) => void)>('onCompoundBadgeClick', () => {})
const flushEditorContentChange = inject<() => void>('flushEditorContentChange', () => {})

const blockId = computed(() => props.node.attrs.blockId || '')
const compoundBadges = computed(() => unref(compoundAnnotationBadges)[blockId.value] || [])
const headingLevel = computed(() => props.node.attrs.headingLevel || 0)
const headingText = computed(() => props.node.attrs.title || '')

const multiTableData = computed<MultiTableData>({
  get: () => props.node.attrs.multiTableData,
  set: (val) => props.updateAttributes({ multiTableData: val }),
})

const updateMultiTableData = (data: MultiTableData) => {
  props.updateAttributes({ multiTableData: data })
  flushEditorContentChange()
}

const onResize = (width: number | null, _height: number | null) => {
  props.updateAttributes({ width })
}
</script>

<template>
  <node-view-wrapper class="multi-table-block-view">
    <ResizableBlockWrapper
      :selected="selected"
      :resizable-axes="{ width: true, height: false }"
      :min-width="320"
      block-type-label="多维表格"
      :block-id="blockId"
      block-type="multiTable"
      :compound-badges="compoundBadges"
      :heading-level="headingLevel"
      :heading-text="headingText"
      @resize="onResize"
      @compound-badge-click="(bid, annotationId, event) => onCompoundBadgeClick(bid, annotationId, event)"
    >
      <MultiTableBlock
        :data="multiTableData"
        :editable="editor.isEditable"
        @change="updateMultiTableData"
      />
    </ResizableBlockWrapper>
  </node-view-wrapper>
</template>
