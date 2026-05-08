<script setup lang="ts">
import { nextTick, onBeforeUnmount, ref, watch } from 'vue';
import Vditor from 'vditor';

const VDITOR_CDN = '/vditor';

const props = withDefaults(defineProps<{
  modelValue: string;
  editing?: boolean;
  editable?: boolean;
  previewClass?: string;
  editorClass?: string;
  previewPointerEvents?: boolean;
}>(), {
  editing: false,
  editable: true,
  previewClass: '',
  editorClass: '',
  previewPointerEvents: false,
});

const emit = defineEmits<{
  (e: 'update:modelValue', value: string): void;
  (e: 'escape'): void;
  (e: 'focusout-editor'): void;
}>();

const renderedHtml = ref('');
const editorRef = ref<HTMLDivElement | null>(null);

let renderTimer: number | null = null;
let inputTimer: number | null = null;
let layoutFrame: number | null = null;
let resizeObserver: ResizeObserver | null = null;
let vditorInstance: Vditor | null = null;

async function renderMarkdown(markdown: string) {
  if (!markdown.trim()) {
    renderedHtml.value = '';
    return;
  }
  try {
    renderedHtml.value = await Vditor.md2html(markdown, { cdn: VDITOR_CDN, mode: 'light' });
  } catch {
    renderedHtml.value = markdown;
  }
}

function scheduleRender(markdown: string) {
  if (renderTimer) window.clearTimeout(renderTimer);
  renderTimer = window.setTimeout(() => {
    renderTimer = null;
    void renderMarkdown(markdown);
  }, 100);
}

function syncEditorLayout() {
  const host = editorRef.value;
  if (!host) return;

  const vditorRoot = host.querySelector('.vditor') as HTMLElement | null;
  const content = host.querySelector('.vditor-content') as HTMLElement | null;
  const wysiwyg = host.querySelector('.vditor-wysiwyg') as HTMLElement | null;
  const reset = host.querySelector('.vditor-wysiwyg .vditor-reset') as HTMLElement | null;

  if (vditorRoot) {
    vditorRoot.style.width = '100%';
    vditorRoot.style.height = '100%';
  }
  if (content) content.style.height = '100%';
  if (wysiwyg) wysiwyg.style.height = '100%';
  if (reset) reset.style.minHeight = '100%';
}

function scheduleEditorLayoutSync() {
  if (layoutFrame != null) window.cancelAnimationFrame(layoutFrame);
  layoutFrame = window.requestAnimationFrame(() => {
    layoutFrame = null;
    syncEditorLayout();
  });
}

function bindResizeObserver() {
  if (typeof ResizeObserver === 'undefined' || !editorRef.value) return;
  resizeObserver?.disconnect();
  resizeObserver = new ResizeObserver(() => scheduleEditorLayoutSync());
  resizeObserver.observe(editorRef.value);
}

function unbindResizeObserver() {
  resizeObserver?.disconnect();
  resizeObserver = null;
}

function initEditor() {
  if (!editorRef.value || !props.editable) return;

  if (vditorInstance) {
    vditorInstance.setValue(props.modelValue ?? '');
    vditorInstance.focus();
    bindResizeObserver();
    scheduleEditorLayoutSync();
    return;
  }

  vditorInstance = new Vditor(editorRef.value, {
    cdn: VDITOR_CDN,
    width: '100%',
    height: '100%',
    value: props.modelValue ?? '',
    mode: 'wysiwyg',
    cache: { enable: false },
    toolbarConfig: { hide: true, pin: false },
    toolbar: ['image'],
    after: () => {
      bindResizeObserver();
      scheduleEditorLayoutSync();
      vditorInstance?.focus();
    },
    input: (value: string) => {
      if (inputTimer) window.clearTimeout(inputTimer);
      inputTimer = window.setTimeout(() => {
        emit('update:modelValue', value);
        void renderMarkdown(value);
      }, 150);
    },
  });
}

function destroyEditor() {
  if (inputTimer) window.clearTimeout(inputTimer);
  inputTimer = null;
  if (layoutFrame != null) {
    window.cancelAnimationFrame(layoutFrame);
    layoutFrame = null;
  }
  unbindResizeObserver();
  if (vditorInstance) {
    try { vditorInstance.destroy(); } catch { /* ignore */ }
    vditorInstance = null;
  }
}

function handleEditorKeydown(event: KeyboardEvent) {
  event.stopPropagation();
  if (event.key === 'Escape') {
    event.preventDefault();
    emit('escape');
  }
}

function handleEditorFocusout() {
  window.setTimeout(() => {
    if (!props.editing) return;
    if (editorRef.value?.contains(document.activeElement)) return;
    emit('focusout-editor');
  }, 0);
}

watch(
  () => props.modelValue,
  (markdown) => {
    if (props.editing) return;
    scheduleRender(markdown ?? '');
  },
  { immediate: true },
);

watch(
  () => props.editing,
  (editing) => {
    if (editing) {
      nextTick(() => initEditor());
    } else if (vditorInstance) {
      void renderMarkdown(props.modelValue ?? '');
      destroyEditor();
    }
  },
  { immediate: true },
);

onBeforeUnmount(() => {
  if (renderTimer) window.clearTimeout(renderTimer);
  destroyEditor();
});
</script>

<template>
  <div
    v-if="editing && editable"
    class="shared-vditor-rich-editor"
    :class="editorClass"
    @mousedown.stop
    @click.stop
    @dblclick.stop
    @keydown="handleEditorKeydown"
    @focusout="handleEditorFocusout"
  >
    <div ref="editorRef" class="shared-vditor-rich-editor__host" />
  </div>

  <div
    v-else
    class="shared-vditor-rich-preview vditor-reset"
    :class="previewClass"
    :style="{ pointerEvents: previewPointerEvents ? 'auto' : 'none' }"
    v-html="renderedHtml"
  />
</template>

<style scoped>
.shared-vditor-rich-editor,
.shared-vditor-rich-editor__host {
  width: 100%;
  height: 100%;
}

.shared-vditor-rich-editor :deep(.vditor) {
  width: 100%;
  height: 100%;
  border: none;
  background: transparent;
  box-shadow: none;
}

.shared-vditor-rich-editor :deep(.vditor-toolbar) {
  display: none;
}

.shared-vditor-rich-editor :deep(.vditor-content) {
  height: 100%;
  border: none;
  background: transparent;
}

.shared-vditor-rich-editor :deep(.vditor-wysiwyg) {
  height: 100%;
  padding: 0;
  background: transparent;
}

.shared-vditor-rich-editor :deep(.vditor-wysiwyg .vditor-reset) {
  min-height: 100%;
  padding: 8px 10px !important;
  background: transparent;
  box-sizing: border-box;
}

.shared-vditor-rich-editor :deep(.vditor-panel),
.shared-vditor-rich-editor :deep(.vditor-hint),
.shared-vditor-rich-editor :deep(.vditor-tip) {
  z-index: 1002;
}

.shared-vditor-rich-preview {
  width: 100%;
  height: 100%;
}
</style>
