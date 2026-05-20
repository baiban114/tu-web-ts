<script setup lang="ts">
import { nodeViewProps, NodeViewWrapper } from '@tiptap/vue-3'
import ResizableBlockWrapper from '../components/ResizableBlockWrapper.vue'

const props = defineProps(nodeViewProps)

const onResize = (_width: number | null, height: number | null) => {
  props.updateAttributes({ height, spacerHeight: height })
}
</script>

<template>
  <node-view-wrapper class="spacer-block-nv">
    <ResizableBlockWrapper
      :selected="selected"
      :resizable-axes="{ width: false, height: true }"
      :min-height="20"
      :max-height="600"
      block-type-label="分割空白"
      @resize="onResize"
    >
      <div
        class="spacer-block-view"
        :style="{ height: (node.attrs.height || 40) + 'px' }"
      />
    </ResizableBlockWrapper>
  </node-view-wrapper>
</template>

<style scoped>
.spacer-block-view {
  background: repeating-linear-gradient(
    90deg,
    transparent,
    transparent 10px,
    rgba(0, 0, 0, 0.03) 10px,
    rgba(0, 0, 0, 0.03) 11px
  );
  cursor: ns-resize;
  min-height: 20px;
}
</style>
