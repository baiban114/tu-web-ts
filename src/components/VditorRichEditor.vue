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

type LinkDisplayMode = 'link' | 'image';

interface InsertedResourceLink {
  url: string;
  label: string;
  display: LinkDisplayMode;
  markdown: string;
  widthPercent?: number;
}

const renderedHtml = ref('');
const editorRef = ref<HTMLDivElement | null>(null);

let renderTimer: number | null = null;
let inputTimer: number | null = null;
let layoutFrame: number | null = null;
let resizeObserver: ResizeObserver | null = null;
let vditorInstance: Vditor | null = null;
let savedMarkdownLinkRange: Range | null = null;
let lastInsertedResourceLink: InsertedResourceLink | null = null;

function escapeMarkdownLinkText(text: string): string {
  return text.replace(/([\[\]\\])/g, '\\$1').replace(/\n+/g, ' ').trim();
}

function escapeMarkdownLinkUrl(url: string): string {
  return url.trim().replace(/\)/g, '%29');
}

function escapeHtmlAttribute(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/"/g, '&quot;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
}

function clampImageWidth(widthPercent: number): number {
  return Math.max(10, Math.min(100, Math.round(widthPercent)));
}

function createResourceLinkMarkdown(
  label: string,
  url: string,
  display: LinkDisplayMode,
  widthPercent = 100,
): string {
  const safeUrl = escapeMarkdownLinkUrl(url);
  const safeLabel = escapeMarkdownLinkText(label) || safeUrl;
  if (display === 'image') {
    const width = clampImageWidth(widthPercent);
    return `<img src="${escapeHtmlAttribute(safeUrl)}" alt="${escapeHtmlAttribute(safeLabel)}" data-tu-resource-image="true" style="width: ${width}%; max-width: 100%; height: auto;" />`;
  }
  return `[${safeLabel}](${safeUrl})`;
}

function isFiniteRect(rect: DOMRect | null | undefined): rect is DOMRect {
  return Boolean(
    rect
    && Number.isFinite(rect.top)
    && Number.isFinite(rect.bottom)
    && Number.isFinite(rect.left)
    && Number.isFinite(rect.height),
  );
}

function pickCaretRect(range: Range): DOMRect | null {
  const inlineRect = Array.from(range.getClientRects()).find((rect) => {
    return isFiniteRect(rect) && rect.height > 0 && rect.height < 80;
  });
  if (inlineRect) return inlineRect;
  const fallbackRect = range.getBoundingClientRect();
  return isFiniteRect(fallbackRect) ? fallbackRect : null;
}

function getEditorContentRoot(): HTMLElement | null {
  return editorRef.value?.querySelector('.vditor-wysiwyg .vditor-reset')
    ?? editorRef.value?.querySelector('.vditor-wysiwyg')
    ?? null;
}

function getMarkdownLinkAnchor(): { top: number; left: number } | undefined {
  const contentRoot = getEditorContentRoot();
  const selection = window.getSelection();
  if (contentRoot && selection && selection.rangeCount > 0) {
    const range = selection.getRangeAt(0).cloneRange();
    const anchorNode = selection.focusNode ?? range.commonAncestorContainer;
    if (anchorNode && contentRoot.contains(anchorNode)) {
      savedMarkdownLinkRange = range.cloneRange();
      const rect = pickCaretRect(range);
      if (rect) {
        return {
          top: rect.bottom + 8,
          left: rect.left + 8,
        };
      }
    }
  }

  const editorRect = editorRef.value?.getBoundingClientRect();
  if (!editorRect) return undefined;
  return {
    top: editorRect.top + 12,
    left: editorRect.left + 12,
  };
}

function selectInsertedResourceLink(url: string) {
  window.setTimeout(() => {
    const contentRoot = getEditorContentRoot();
    if (!contentRoot) return;

    const img = Array.from(contentRoot.querySelectorAll<HTMLImageElement>('img[data-tu-resource-image]'))
      .reverse()
      .find((el) => el.getAttribute('src') === url);
    if (img) {
      return;
    }

    const anchor = Array.from(contentRoot.querySelectorAll<HTMLAnchorElement>('a[href]'))
      .reverse()
      .find((el) => el.getAttribute('href') === url);
    if (!anchor) return;

    const selection = window.getSelection();
    const range = document.createRange();
    range.selectNode(anchor);
    selection?.removeAllRanges();
    selection?.addRange(range);
  }, 120);
}

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

function syncValueFromEditor() {
  if (!vditorInstance) return;
  const value = vditorInstance.getValue();
  emit('update:modelValue', value);
  void renderMarkdown(value);
}

function insertMarkdown(markdown: string) {
  if (!props.editable || !markdown) return;

  if (!vditorInstance && props.editing) {
    initEditor();
  }

  nextTick(() => {
    if (!vditorInstance) return;
    if (savedMarkdownLinkRange) {
      const selection = window.getSelection();
      selection?.removeAllRanges();
      selection?.addRange(savedMarkdownLinkRange);
      savedMarkdownLinkRange = null;
    }
    vditorInstance.focus();
    vditorInstance.insertValue(markdown, true);
    syncValueFromEditor();
  });
}

function insertMarkdownLink(label: string, url: string, display: LinkDisplayMode = 'link') {
  const safeUrl = escapeMarkdownLinkUrl(url);
  if (!safeUrl) return;
  const markdown = createResourceLinkMarkdown(label, url, display);
  lastInsertedResourceLink = { url: safeUrl, label: label || safeUrl, display, markdown, widthPercent: 100 };
  insertMarkdown(markdown);
  selectInsertedResourceLink(safeUrl);
}

function updateInsertedLinkDisplay(display: LinkDisplayMode): boolean {
  if (!vditorInstance || !lastInsertedResourceLink) return false;
  const current = vditorInstance.getValue();
  const nextMarkdown = createResourceLinkMarkdown(
    lastInsertedResourceLink.label,
    lastInsertedResourceLink.url,
    display,
    lastInsertedResourceLink.widthPercent ?? 100,
  );
  if (!current.includes(lastInsertedResourceLink.markdown)) return false;

  const next = current.replace(lastInsertedResourceLink.markdown, nextMarkdown);
  vditorInstance.setValue(next);
  emit('update:modelValue', next);
  void renderMarkdown(next);
  lastInsertedResourceLink = {
    ...lastInsertedResourceLink,
    display,
    markdown: nextMarkdown,
  };
  selectInsertedResourceLink(lastInsertedResourceLink.url);
  return true;
}

function updateInsertedImageWidth(widthPercent: number): boolean {
  if (!vditorInstance || !lastInsertedResourceLink || lastInsertedResourceLink.display !== 'image') return false;
  const current = vditorInstance.getValue();
  const nextWidth = clampImageWidth(widthPercent);
  const nextMarkdown = createResourceLinkMarkdown(
    lastInsertedResourceLink.label,
    lastInsertedResourceLink.url,
    'image',
    nextWidth,
  );
  if (!current.includes(lastInsertedResourceLink.markdown)) return false;

  const next = current.replace(lastInsertedResourceLink.markdown, nextMarkdown);
  vditorInstance.setValue(next);
  emit('update:modelValue', next);
  void renderMarkdown(next);
  lastInsertedResourceLink = {
    ...lastInsertedResourceLink,
    widthPercent: nextWidth,
    markdown: nextMarkdown,
  };
  selectInsertedResourceLink(lastInsertedResourceLink.url);
  return true;
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
    if ((document.activeElement as HTMLElement | null)?.closest('.link-popover')) return;
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

defineExpose({
  getMarkdownLinkAnchor,
  insertMarkdown,
  insertMarkdownLink,
  updateInsertedLinkDisplay,
  updateInsertedImageWidth,
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
