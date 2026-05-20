<script setup lang="ts">
import { computed } from 'vue'
import { nodeViewProps, NodeViewWrapper } from '@tiptap/vue-3'
import ResizableBlockWrapper from '../components/ResizableBlockWrapper.vue'
import X6Component from '@/components/X6Component.vue'

const props = defineProps(nodeViewProps)

const graphData = computed({
  get: () => props.node.attrs.graphData,
  set: (val) => props.updateAttributes({ graphData: val }),
})

const onResize = (width: number | null, height: number | null) => {
  props.updateAttributes({ width, height })
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
      @resize="onResize"
    >
      <X6Component
        :graph-data="graphData"
        @update:graph-data="graphData = $event"
      />
    </ResizableBlockWrapper>
  </node-view-wrapper>
</template>
