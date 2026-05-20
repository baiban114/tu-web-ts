<script setup lang="ts">
import { nodeViewProps, NodeViewWrapper } from '@tiptap/vue-3'
import ReferencedBlockRenderer from '@/components/ReferencedBlockRenderer.vue'

const props = defineProps(nodeViewProps)
</script>

<template>
  <node-view-wrapper class="ref-block-view">
    <ReferencedBlockRenderer
      :ref-id="node.attrs.refId"
      :ref-type="node.attrs.refType"
    />
  </node-view-wrapper>
</template>
