<script setup lang="ts">
import { computed } from 'vue'
import { nodeViewProps, NodeViewWrapper } from '@tiptap/vue-3'
import X6Component from '@/components/X6Component.vue'

const props = defineProps(nodeViewProps)

const graphData = computed({
  get: () => props.node.attrs.graphData,
  set: (val) => props.updateAttributes({ graphData: val }),
})
</script>

<template>
  <node-view-wrapper class="x6-block-view">
    <X6Component
      :graph-data="graphData"
      @update:graph-data="graphData = $event"
    />
  </node-view-wrapper>
</template>
