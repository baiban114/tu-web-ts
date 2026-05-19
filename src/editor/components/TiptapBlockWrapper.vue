<script setup lang="ts">
import { computed, ref } from 'vue'
import { nodeViewProps } from '@tiptap/vue-3'
import BlockActionHandle from '@/components/BlockActionHandle.vue'
import type { BlockActionHandleItem } from '@/components/BlockActionHandle.vue'

const props = defineProps({
  ...nodeViewProps,
  handleItems: { type: Array as () => BlockActionHandleItem[], required: true },
  blockTypeLabel: { type: String, default: '' },
})

const lineHandleVisible = ref(false)
const lineHandleTop = ref<number | null>(null)
const lineHandleHeight = ref<number | null>(null)
const lineMenuVisible = ref(false)

const actionHandleStyle = computed(() => {
  if (lineHandleVisible.value && lineHandleTop.value != null) {
    return {
      '--hover-handle-left': 'calc(var(--block-handle-gutter, 36px) / 2)',
      '--hover-handle-top': `${lineHandleTop.value}px`,
      '--hover-handle-height': `${Math.max(1, lineHandleHeight.value ?? 28)}px`,
      '--hover-handle-transform': 'translateX(-50%)',
    }
  }
  return {
    '--hover-handle-left': 'calc(var(--block-handle-gutter, 36px) / 2)',
    '--hover-handle-top': 'calc(var(--block-shell-pad-y, 20px) + 6px)',
    '--hover-handle-transform': 'translateX(-50%)',
  }
})

const handleSelect = (action: string) => {
  const blockId = props.node.attrs.blockId
  ;(props.editor.storage as any).blockActions.onBlockAction(action, blockId)
}

const handleMenuVisibility = (visible: boolean) => {
  lineMenuVisible.value = visible
}
</script>

<template>
  <node-view-wrapper
    class="tiptap-block"
    :class="{
      'tiptap-block--selected': selected,
      [`tiptap-block--${blockTypeLabel}`]: blockTypeLabel,
    }"
  >
    <BlockActionHandle
      :mode="lineHandleVisible ? 'richtext-line' : 'block'"
      :position-style="actionHandleStyle"
      :items="handleItems"
      :drag-enabled="true"
      @select="handleSelect"
      @menu-visibility-change="handleMenuVisibility"
    />

    <div class="tiptap-block__header" v-if="blockTypeLabel || node.attrs.title">
      <span class="tiptap-block__title">{{ node.attrs.title }}</span>
      <span class="tiptap-block__type-badge">{{ blockTypeLabel }}</span>
    </div>

    <slot />
  </node-view-wrapper>
</template>
