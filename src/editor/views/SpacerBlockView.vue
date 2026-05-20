<script setup lang="ts">
import { nodeViewProps, NodeViewWrapper } from '@tiptap/vue-3'

const props = defineProps(nodeViewProps)
</script>

<template>
  <node-view-wrapper
    class="spacer-block-view"
    :style="{ height: (node.attrs.spacerHeight || 40) + 'px' }"
  />
</template>
