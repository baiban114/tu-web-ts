<script setup lang="ts">
import { computed } from 'vue'
import { nodeViewProps, NodeViewWrapper } from '@tiptap/vue-3'
import Line from '@/components/line.vue'

const props = defineProps(nodeViewProps)

const timelineData = computed({
  get: () => props.node.attrs.timelineData,
  set: (val) => props.updateAttributes({ timelineData: val }),
})
</script>

<template>
  <node-view-wrapper class="timeline-block-view">
    <Line
      :timeline-data="timelineData"
      @update:timeline-data="timelineData = $event"
    />
  </node-view-wrapper>
</template>
