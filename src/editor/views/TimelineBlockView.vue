<script setup lang="ts">
import { computed } from 'vue'
import { nodeViewProps, NodeViewWrapper } from '@tiptap/vue-3'
import ResizableBlockWrapper from '../components/ResizableBlockWrapper.vue'
import Line from '@/components/line.vue'

const props = defineProps(nodeViewProps)

const timelineData = computed({
  get: () => props.node.attrs.timelineData,
  set: (val) => props.updateAttributes({ timelineData: val }),
})

const onResize = (width: number | null, _height: number | null) => {
  props.updateAttributes({ width })
}
</script>

<template>
  <node-view-wrapper class="timeline-block-view">
    <ResizableBlockWrapper
      :selected="selected"
      :resizable-axes="{ width: true, height: false }"
      :min-width="300"
      block-type-label="时间轴"
      @resize="onResize"
    >
      <Line
        :timeline-data="timelineData"
        @update:timeline-data="timelineData = $event"
      />
    </ResizableBlockWrapper>
  </node-view-wrapper>
</template>
