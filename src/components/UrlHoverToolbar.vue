<script setup lang="ts">
import type { Editor } from '@tiptap/core'
import { computed, nextTick, ref, watch } from 'vue'
import { ElButton, ElDivider } from 'element-plus'
import { useAnchoredFloating } from '@/composables/useAnchoredFloating'
import type { UrlHoverTarget } from '@/editor/urlHoverTarget'
import { resolveUrlHoverTargetAnchorRect } from '@/editor/urlHoverTarget'
import type { UrlDisplayMode } from '@/utils/urlDisplay'

interface Props {
  visible: boolean
  target: UrlHoverTarget | null
  editor?: Editor | null
  suppressed?: boolean
  pinning?: boolean
}

const props = withDefaults(defineProps<Props>(), {
  suppressed: false,
  pinning: false,
})

const emit = defineEmits<{
  (e: 'select-mode', mode: UrlDisplayMode): void
  (e: 'mouseenter'): void
  (e: 'mouseleave'): void
}>()

const toolbarRef = ref<HTMLElement | null>(null)
const measuredSize = ref({ width: 280, height: 76 })

const toolbarVisible = computed(() => props.visible && !props.suppressed && Boolean(props.target))

const getAnchorRect = () => resolveUrlHoverTargetAnchorRect(props.editor, props.target)

const getScrollRoots = () => {
  const editorDom = props.editor?.view.dom
  const scrollRoot = editorDom?.closest('.content-scroll') as HTMLElement | null
  return scrollRoot ? [scrollRoot] : []
}

const { position, updatePosition } = useAnchoredFloating({
  visible: toolbarVisible,
  getAnchorRect,
  getScrollRoots,
  placement: 'top',
  offset: 8,
  zIndex: 26,
  floatingWidth: computed(() => measuredSize.value.width),
  floatingHeight: computed(() => measuredSize.value.height),
})

const measureToolbar = () => {
  const el = toolbarRef.value
  if (!el) return
  const rect = el.getBoundingClientRect()
  if (rect.width > 0 && rect.height > 0) {
    measuredSize.value = {
      width: Math.ceil(rect.width),
      height: Math.ceil(rect.height),
    }
  }
  updatePosition()
}

watch(
  () => props.target,
  () => {
    nextTick(() => {
      measureToolbar()
    })
  },
  { deep: true },
)

watch(toolbarVisible, (visible) => {
  if (!visible) return
  nextTick(() => {
    measureToolbar()
  })
})

watch(measuredSize, () => {
  updatePosition()
}, { deep: true })

const displayUrl = computed(() => props.target?.url || '')
const currentMode = computed(() => props.target?.displayMode || 'link')
const canUseIframe = computed(() => {
  const url = props.target?.url || ''
  return !/\.(png|jpe?g|gif|webp|svg|avif|bmp)(\?.*)?$/i.test(url)
})
</script>

<template>
  <Teleport to="body">
    <div
      v-if="toolbarVisible && target"
      ref="toolbarRef"
      class="url-hover-toolbar"
      :style="{ top: `${position.top}px`, left: `${position.left}px`, zIndex: position.zIndex }"
      @mousedown.prevent.stop
      @click.stop
      @mouseenter="emit('mouseenter')"
      @mouseleave="emit('mouseleave')"
    >
      <div class="url-hover-toolbar__url" :title="displayUrl">
        {{ displayUrl }}
      </div>
      <div class="url-hover-toolbar__group">
        <ElButton
          size="small"
          text
          :type="currentMode === 'link' ? 'primary' : 'default'"
          class="url-hover-toolbar__btn"
          @mousedown.prevent.stop
          @click="emit('select-mode', 'link')"
        >
          链接
        </ElButton>
        <ElDivider direction="vertical" class="url-hover-toolbar__divider" />
        <ElButton
          size="small"
          text
          :disabled="!canUseIframe"
          :type="currentMode === 'iframe' ? 'primary' : 'default'"
          class="url-hover-toolbar__btn"
          @mousedown.prevent.stop
          @click="emit('select-mode', 'iframe')"
        >
          iframe
        </ElButton>
        <ElDivider direction="vertical" class="url-hover-toolbar__divider" />
        <ElButton
          size="small"
          text
          :type="currentMode === 'title' ? 'primary' : 'default'"
          class="url-hover-toolbar__btn"
          @mousedown.prevent.stop
          @click="emit('select-mode', 'title')"
        >
          标题
        </ElButton>
      </div>
    </div>
  </Teleport>
</template>

<style scoped>
.url-hover-toolbar {
  position: fixed;
  display: flex;
  flex-direction: column;
  gap: 4px;
  min-width: 220px;
  max-width: min(420px, calc(100vw - 24px));
  padding: 8px 10px;
  border: 1px solid var(--el-border-color-light);
  border-radius: 8px;
  background: var(--el-bg-color);
  box-shadow: var(--el-box-shadow-light);
}

.url-hover-toolbar__url {
  font-size: 12px;
  color: #6b7280;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

.url-hover-toolbar__group {
  display: flex;
  align-items: center;
  gap: 2px;
}

.url-hover-toolbar__btn {
  margin: 0;
  padding: 4px 10px;
  font-size: 13px;
  font-weight: 500;
}

.url-hover-toolbar__divider {
  height: 16px;
  margin: 0 2px;
}
</style>
