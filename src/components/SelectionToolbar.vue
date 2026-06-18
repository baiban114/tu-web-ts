<script setup lang="ts">
import { computed, ref, watch, onBeforeUnmount, toRef } from 'vue'
import type { Editor } from '@tiptap/core'
import { BubbleMenu } from '@tiptap/vue-3/menus'
import { ElButton, ElDivider } from 'element-plus'
import { getSelectionToolbarActions, shouldShowSelectionBubbleMenu } from '@/editor/selectionToolbar'

interface Props {
  editor: Editor | null | undefined
  suppressed?: boolean
}

const props = withDefaults(defineProps<Props>(), {
  suppressed: false,
})

const emit = defineEmits<{
  (e: 'add-note'): void
  (e: 'mark-resource-excerpt'): void
  (e: 'set-excerpt-basis'): void
  (e: 'mark-heading-source'): void
  (e: 'clear-heading-source'): void
}>()

const menuRoot = ref<HTMLElement | null>(null)
const selectionRevision = ref(0)
const suppressedRef = toRef(props, 'suppressed')
let detachEditorListeners: (() => void) | null = null

watch(
  () => props.editor,
  (editor, _prev, onCleanup) => {
    detachEditorListeners?.()
    detachEditorListeners = null
    if (!editor) return

    const bump = () => {
      selectionRevision.value += 1
    }
    editor.on('selectionUpdate', bump)
    editor.on('transaction', bump)
    detachEditorListeners = () => {
      editor.off('selectionUpdate', bump)
      editor.off('transaction', bump)
    }
    onCleanup(() => {
      detachEditorListeners?.()
      detachEditorListeners = null
    })
  },
  { immediate: true },
)

onBeforeUnmount(() => {
  detachEditorListeners?.()
})

watch(suppressedRef, () => {
  selectionRevision.value += 1
  const editor = props.editor
  if (!editor) return
  editor.view.updateState(editor.state)
})

const actions = computed(() => {
  selectionRevision.value
  const editor = props.editor
  if (!editor) {
    return {
      canAddNote: false,
      canMarkResourceExcerpt: false,
      canSetExcerptBasis: false,
      canMarkHeadingSource: false,
      canClearHeadingSource: false,
      canShow: false,
    }
  }
  const { from, to } = editor.state.selection
  return getSelectionToolbarActions(editor, from, to)
})

const bubbleShouldShow = (ctx: {
  editor: Editor
  view: Editor['view']
  state: Editor['state']
  from: number
  to: number
}) => shouldShowSelectionBubbleMenu(
  ctx.editor,
  ctx.view,
  ctx.state,
  ctx.from,
  ctx.to,
  suppressedRef.value,
  menuRoot.value,
)

/** Anchor bubble menu inside the editor surface so it scrolls with content (not viewport-fixed). */
const appendToEditorSurface = (): HTMLElement => {
  const editor = props.editor
  if (!editor) return document.body
  return (
    (editor.view.dom.closest('.tu-editor-wrapper') as HTMLElement | null)
    ?? editor.view.dom.parentElement
    ?? document.body
  )
}

const bubbleFloatingOptions = computed(() => {
  const editor = props.editor
  const scrollTarget = editor
    ? ((editor.view.dom.closest('.content-scroll') as HTMLElement | null) ?? window)
    : window
  return {
    strategy: 'absolute' as const,
    placement: 'top' as const,
    offset: 8,
    flip: true,
    shift: { padding: 8 },
    inline: true,
    scrollTarget,
  }
})
</script>

<template>
  <BubbleMenu
    v-if="editor"
    class="selection-toolbar-host"
    :editor="editor"
    :update-delay="120"
    :append-to="appendToEditorSurface"
    :should-show="bubbleShouldShow"
    :options="bubbleFloatingOptions"
  >
    <div
      ref="menuRoot"
      class="selection-toolbar"
      @mousedown.prevent.stop
      @click.stop
    >
      <div class="selection-toolbar__group">
        <ElButton
          v-if="actions.canAddNote"
          size="small"
          text
          class="selection-toolbar__btn"
          @mousedown.prevent.stop
          @click="emit('add-note')"
        >
          添加笔记
        </ElButton>
        <template v-if="actions.canMarkHeadingSource">
          <ElDivider v-if="actions.canAddNote" direction="vertical" class="selection-toolbar__divider" />
          <ElButton
            size="small"
            text
            type="success"
            class="selection-toolbar__btn"
            @mousedown.prevent.stop
            @click="emit('mark-heading-source')"
          >
            标记来源
          </ElButton>
        </template>
        <template v-if="actions.canClearHeadingSource">
          <ElDivider
            v-if="actions.canAddNote || actions.canMarkHeadingSource"
            direction="vertical"
            class="selection-toolbar__divider"
          />
          <ElButton
            size="small"
            text
            type="danger"
            class="selection-toolbar__btn"
            @mousedown.prevent.stop
            @click="emit('clear-heading-source')"
          >
            解除来源
          </ElButton>
        </template>
        <template v-if="actions.canMarkResourceExcerpt">
          <ElDivider
            v-if="actions.canAddNote || actions.canMarkHeadingSource || actions.canClearHeadingSource"
            direction="vertical"
            class="selection-toolbar__divider"
          />
          <ElButton
            size="small"
            text
            type="primary"
            class="selection-toolbar__btn"
            @mousedown.prevent.stop
            @click="emit('mark-resource-excerpt')"
          >
            标记节选
          </ElButton>
        </template>
        <template v-if="actions.canSetExcerptBasis">
          <ElDivider
            v-if="actions.canAddNote || actions.canMarkHeadingSource || actions.canClearHeadingSource || actions.canMarkResourceExcerpt"
            direction="vertical"
            class="selection-toolbar__divider"
          />
          <ElButton
            size="small"
            text
            type="success"
            class="selection-toolbar__btn"
            @mousedown.prevent.stop
            @click="emit('set-excerpt-basis')"
          >
            设置依据
          </ElButton>
        </template>
      </div>
    </div>
  </BubbleMenu>
</template>

<style scoped>
.selection-toolbar-host {
  z-index: 50;
}

.selection-toolbar {
  display: flex;
  align-items: center;
  padding: 2px 4px;
  border: 1px solid var(--el-border-color-light);
  border-radius: 8px;
  background: var(--el-bg-color);
  box-shadow: var(--el-box-shadow-light);
}

.selection-toolbar__group {
  display: flex;
  align-items: center;
  gap: 2px;
}

.selection-toolbar__btn {
  margin: 0;
  padding: 4px 10px;
  font-size: 13px;
  font-weight: 500;
}

.selection-toolbar__divider {
  height: 16px;
  margin: 0 2px;
}
</style>
