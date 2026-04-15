<script setup lang="ts">
import { computed, nextTick, onBeforeUnmount, ref, watch } from 'vue';
import Vditor from 'vditor';

const VDITOR_CDN = '/vditor';

interface Props {
  nodeId: string;
  styleProps: Record<string, string>;
  textMode: 'plain' | 'rich';
  label: string;
  richContent: string;
  isEditing: boolean;
  isEditable: boolean;
}

const props = defineProps<Props>();

const emit = defineEmits<{
  (e: 'commit-plain', text: string): void;
  (e: 'cancel'): void;
  (e: 'rich-change', markdown: string): void;
}>();

// ── Plain text state ──────────────────────────────────────────────────────────

const plainText = ref(props.label);
const textareaRef = ref<HTMLTextAreaElement | null>(null);

watch(() => props.label, (v) => { plainText.value = v; });

watch(
  () => props.isEditing,
  (editing) => {
    if (editing && props.textMode === 'plain') {
      plainText.value = props.label;
      nextTick(() => {
        textareaRef.value?.focus();
        textareaRef.value?.select();
      });
    }
  },
);

function handlePlainKeydown(e: KeyboardEvent) {
  e.stopPropagation();
  if (e.key === 'Escape') {
    e.preventDefault();
    emit('cancel');
  } else if (e.key === 'Enter' && !e.ctrlKey && !e.metaKey && !e.shiftKey) {
    e.preventDefault();
    emit('commit-plain', plainText.value);
  }
}

function handlePlainBlur() {
  if (props.isEditing && props.textMode === 'plain') {
    emit('commit-plain', plainText.value);
  }
}

// ── Rich text state ───────────────────────────────────────────────────────────

const renderedHtml = ref('');
let renderTimer: number | null = null;

async function renderMarkdown(md: string) {
  if (!md.trim()) { renderedHtml.value = ''; return; }
  try {
    renderedHtml.value = await Vditor.md2html(md, { cdn: VDITOR_CDN, mode: 'light' });
  } catch {
    renderedHtml.value = md;
  }
}

// Initial render + watch for external changes
renderMarkdown(props.richContent);
watch(() => props.richContent, (md) => {
  if (props.isEditing) return; // Vditor handles live update during edit
  if (renderTimer) clearTimeout(renderTimer);
  renderTimer = window.setTimeout(() => renderMarkdown(md), 100);
});

// ── Rich text editor (Vditor) ─────────────────────────────────────────────────

const richEditorRef = ref<HTMLDivElement | null>(null);
let vditorInstance: Vditor | null = null;
let richInputTimer: number | null = null;
let richLayoutFrame: number | null = null;
let richEditorResizeObserver: ResizeObserver | null = null;

const richOverlayStyle = computed<Record<string, string>>(() => ({
  ...props.styleProps,
  zIndex: props.isEditing && props.textMode === 'rich'
    ? '1001'
    : (props.styleProps.zIndex ?? '1000'),
}));

function syncRichEditorLayout() {
  const host = richEditorRef.value;
  if (!host) return;

  const vditorRoot = host.querySelector('.vditor') as HTMLElement | null;
  const content = host.querySelector('.vditor-content') as HTMLElement | null;
  const wysiwyg = host.querySelector('.vditor-wysiwyg') as HTMLElement | null;
  const reset = host.querySelector('.vditor-wysiwyg .vditor-reset') as HTMLElement | null;

  if (vditorRoot) {
    vditorRoot.style.width = '100%';
    vditorRoot.style.height = '100%';
  }

  if (content) {
    content.style.height = '100%';
  }

  if (wysiwyg) {
    wysiwyg.style.height = '100%';
  }

  if (reset) {
    reset.style.minHeight = '100%';
  }
}

function scheduleRichEditorLayoutSync() {
  if (richLayoutFrame != null) {
    window.cancelAnimationFrame(richLayoutFrame);
  }

  richLayoutFrame = window.requestAnimationFrame(() => {
    richLayoutFrame = null;
    syncRichEditorLayout();
  });
}

function bindRichEditorResizeObserver() {
  if (typeof ResizeObserver === 'undefined' || !richEditorRef.value) return;

  richEditorResizeObserver?.disconnect();
  richEditorResizeObserver = new ResizeObserver(() => {
    scheduleRichEditorLayoutSync();
  });
  richEditorResizeObserver.observe(richEditorRef.value);
}

function unbindRichEditorResizeObserver() {
  richEditorResizeObserver?.disconnect();
  richEditorResizeObserver = null;
}

watch(
  () => props.isEditing,
  (editing) => {
    if (editing && props.textMode === 'rich') {
      nextTick(() => initRichEditor());
    } else if (!editing && vditorInstance) {
      // Render final markdown before destroying
      renderMarkdown(props.richContent);
      destroyRichEditor();
    }
  },
);

watch(
  () => [
    props.styleProps.left,
    props.styleProps.top,
    props.styleProps.width,
    props.styleProps.height,
    props.styleProps.fontSize,
  ].join('|'),
  () => {
    if (props.isEditing && props.textMode === 'rich') {
      scheduleRichEditorLayoutSync();
    }
  },
);

function initRichEditor() {
  if (!richEditorRef.value) return;

  if (vditorInstance) {
    vditorInstance.setValue(props.richContent ?? '');
    vditorInstance.focus();
    bindRichEditorResizeObserver();
    scheduleRichEditorLayoutSync();
    return;
  }

  vditorInstance = new Vditor(richEditorRef.value, {
    cdn: VDITOR_CDN,
    width: '100%',
    height: '100%',
    value: props.richContent ?? '',
    mode: 'wysiwyg',
    cache: { enable: false },
    toolbarConfig: { hide: true, pin: false },
    toolbar: [],
    after: () => {
      bindRichEditorResizeObserver();
      scheduleRichEditorLayoutSync();
      vditorInstance?.focus();
    },
    input: (value: string) => {
      // Debounce to avoid excessive updates
      if (richInputTimer) clearTimeout(richInputTimer);
      richInputTimer = window.setTimeout(() => {
        emit('rich-change', value);
        renderMarkdown(value);
      }, 150);
    },
  });
}

function destroyRichEditor() {
  if (richInputTimer) clearTimeout(richInputTimer);
  if (richLayoutFrame != null) {
    window.cancelAnimationFrame(richLayoutFrame);
    richLayoutFrame = null;
  }
  unbindRichEditorResizeObserver();
  if (vditorInstance) {
    try { vditorInstance.destroy(); } catch { /* ignore */ }
    vditorInstance = null;
  }
}

// Handle click-outside to close rich editor
function handleRichEditorMousedown(e: MouseEvent) {
  e.stopPropagation();
}

function handleRichEditorKeydown(e: KeyboardEvent) {
  e.stopPropagation();
  if (e.key === 'Escape') {
    e.preventDefault();
    emit('cancel');
  }
}

function handleRichEditorFocusout() {
  window.setTimeout(() => {
    if (!props.isEditing || props.textMode !== 'rich') return;
    if (richEditorRef.value?.contains(document.activeElement)) return;
    emit('cancel');
  }, 0);
}

// ── Cleanup ───────────────────────────────────────────────────────────────────

onBeforeUnmount(() => {
  if (renderTimer) clearTimeout(renderTimer);
  destroyRichEditor();
});
</script>

<template>
  <!-- Rich text: editing state — expanded Vditor overlay -->
  <div
    v-if="isEditing && textMode === 'rich'"
    class="x6-node-overlay x6-node-overlay--rich-edit"
    :style="richOverlayStyle"
    @mousedown="handleRichEditorMousedown"
    @click.stop
    @dblclick.stop
    @keydown="handleRichEditorKeydown"
    @focusout="handleRichEditorFocusout"
  >
    <div ref="richEditorRef" class="x6-node-rich-editor" />
  </div>

  <!-- Rich text: preview state — rendered HTML, pointer-events none -->
  <div
    v-else-if="textMode === 'rich'"
    class="x6-node-overlay x6-node-overlay--rich-preview"
    :style="richOverlayStyle"
  >
    <div class="x6-node-rich-preview vditor-reset" v-html="renderedHtml" />
  </div>

  <!-- Plain text: editing state — textarea overlay -->
  <div
    v-else-if="isEditing && textMode === 'plain'"
    class="x6-node-overlay x6-node-overlay--plain-edit"
    :style="styleProps"
    @mousedown.stop
    @click.stop
    @dblclick.stop
    @keydown.stop
  >
    <textarea
      ref="textareaRef"
      v-model="plainText"
      class="x6-node-plain-input"
      @keydown="handlePlainKeydown"
      @blur="handlePlainBlur"
    />
  </div>

  <!-- Plain text: no overlay needed (X6 SVG label handles display) -->
</template>

<style scoped>
.x6-node-overlay {
  pointer-events: none;
}

/* Rich text preview */
.x6-node-overlay--rich-preview {
  position: absolute;
  overflow: hidden;
  border-radius: 4px;
  pointer-events: none;
  z-index: 10;
}

.x6-node-rich-preview {
  width: 100%;
  height: 100%;
  overflow: hidden;
  padding: 8px 10px;
  font-size: 12px;
  box-sizing: border-box;
  line-height: 1.3;
  word-break: break-word;
}

.x6-node-rich-preview :deep(p) { margin: 0; }
.x6-node-rich-preview :deep(h1),
.x6-node-rich-preview :deep(h2),
.x6-node-rich-preview :deep(h3) { margin: 0 0 2px; font-size: 14px; }
.x6-node-rich-preview :deep(ul),
.x6-node-rich-preview :deep(ol) { margin: 0; padding-left: 16px; }

/* Rich text editor */
.x6-node-overlay--rich-edit {
  position: absolute;
  pointer-events: auto;
  overflow: hidden;
  z-index: 1001;
}

.x6-node-rich-editor {
  width: 100%;
  height: 100%;
}

.x6-node-rich-editor :deep(.vditor) {
  width: 100%;
  height: 100%;
  border: none;
  background: transparent;
  box-shadow: none;
}

.x6-node-rich-editor :deep(.vditor-toolbar) {
  display: none;
}

.x6-node-rich-editor :deep(.vditor-content) {
  height: 100%;
  border: none;
  background: transparent;
}

.x6-node-rich-editor :deep(.vditor-wysiwyg) {
  height: 100%;
  padding: 0;
  background: transparent;
}

.x6-node-rich-editor :deep(.vditor-wysiwyg .vditor-reset) {
  min-height: 100%;
  padding: 8px 10px !important;
  background: transparent;
  box-sizing: border-box;
}

.x6-node-rich-editor :deep(.vditor-panel),
.x6-node-rich-editor :deep(.vditor-hint),
.x6-node-rich-editor :deep(.vditor-tip) {
  z-index: 1002;
}

/* Plain text editor */
.x6-node-overlay--plain-edit {
  position: absolute;
  display: flex;
  align-items: center;
  justify-content: center;
  pointer-events: auto;
}

.x6-node-plain-input {
  width: 100%;
  height: 100%;
  border: 2px solid #1677ff;
  border-radius: 4px;
  background: rgba(255, 255, 255, 0.96);
  font-weight: 600;
  text-align: center;
  resize: none;
  outline: none;
  padding: 4px 8px;
  box-sizing: border-box;
  font-family: inherit;
  font-size: inherit;
  line-height: 1.4;
}
</style>
