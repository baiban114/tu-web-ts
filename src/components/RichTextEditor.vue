<script setup lang="ts">
import HoverHandle from './HoverHandle.vue';
import Vditor from 'vditor';
import 'vditor/dist/index.css';
import { nextTick, onBeforeUnmount, onMounted, ref, watch } from 'vue';

interface Props {
  content: string;
  height?: number;
  width?: string;
  editable?: boolean;
  autoFocus?: boolean;
  lineHandleEnabled?: boolean;
}

type LineInsertBlockType = 'richtext' | 'graph' | 'line' | 'x6' | 'ref' | 'container';

interface LineInsertPayload {
  beforeContent: string;
  afterContent: string;
  blockType: LineInsertBlockType;
  layout?: 'horizontal' | 'vertical';
}

type LineHandleMode = 'editor-caret' | null;
type SplitContent = { beforeContent: string; afterContent: string };

const props = withDefaults(defineProps<Props>(), {
  height: undefined,
  width: '100%',
  editable: true,
  autoFocus: false,
  lineHandleEnabled: true,
});

const emit = defineEmits<{
  (e: 'content-change', content: string): void;
  (e: 'height-change', height: number): void;
  (e: 'extract-selection', text: string): void;
  (e: 'insert-block', position: number): void;
  (e: 'line-insert', payload: LineInsertPayload): void;
  (e: 'delete-block'): void;
  (e: 'click', event: MouseEvent): void;
  (e: 'lifecycle', method: string): void;
  (e: 'blur', content: string): void;
  (e: 'focused'): void;
}>();

const VDITOR_CDN = '/vditor';

const wrapperRef = ref<HTMLDivElement | null>(null);
const editorRef = ref<HTMLDivElement | null>(null);
const editorInstance = ref<Vditor | null>(null);
const isUnmounted = ref(false);
const isReady = ref(false);
const isInitializing = ref(false);
const hasActivatedEditor = ref(!props.editable || props.autoFocus);
const isEditorFocused = ref(false);
const lastEmittedContent = ref(props.content);
const pendingExternalContent = ref<string | null>(null);
const pendingFocusAfterReady = ref(false);
const activeLineElement = ref<HTMLElement | null>(null);
const lineHandleMode = ref<LineHandleMode>(null);
const lineHandleTop = ref<number | null>(null);
const lineHandleVisible = ref(false);
const lineMenuVisible = ref(false);
const lastEditorLineSplitContent = ref<SplitContent | null>(null);
let scheduledHandleSyncFrame = 0;
const lineHandleItems = [
  { key: 'insert-richtext', icon: '📝', label: '插入文本块' },
  { key: 'insert-ref', icon: '🔖', label: '插入引用块' },
  { key: 'insert-graph', icon: '🎨', label: '插入画板' },
  { key: 'insert-line', icon: '🕒', label: '插入时间轴' },
  { key: 'insert-x6', icon: '🧩', label: '插入 X6 图' },
  { key: 'insert-container-horizontal', icon: '📦', label: '插入水平容器' },
  { key: 'insert-container-vertical', icon: '📦', label: '插入垂直容器' },
  { key: 'delete', icon: '🗑️', label: '删除当前块', danger: true },
] ;

const LINE_BLOCK_SELECTOR = [
  '[data-block="0"]',
  'div.vditor-reset > div',
  'p',
  'h1',
  'h2',
  'h3',
  'h4',
  'h5',
  'h6',
  'li',
  'blockquote',
  'pre',
  'table',
].join(', ');

const escapeHtml = (value: string): string => {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
};

const previewHtml = ref('');

const renderPreviewHtml = async () => {
  if (isReady.value) return;
  try {
    previewHtml.value = await Vditor.md2html(props.content, { cdn: VDITOR_CDN, mode: 'light' });
  } catch {
    previewHtml.value = `<p>${escapeHtml(props.content)}</p>`;
  }
};

renderPreviewHtml();

const hideLineHandle = () => {
  if (lineMenuVisible.value) return;
  activeLineElement.value = null;
  lineHandleMode.value = null;
  lineHandleTop.value = null;
  lineHandleVisible.value = false;
};

const applyEditorContent = (content: string) => {
  if (!editorInstance.value) return;
  editorInstance.value.setValue(content);
  lastEmittedContent.value = content;
};

const updateHeight = () => {
  emit('lifecycle', 'updateHeight');

  if (!editorRef.value) return;

  const editorHeight = editorRef.value.scrollHeight;
  emit('height-change', editorHeight);
};

const getSelectedHtml = (): string => {
  if (!editorInstance.value) return '';

  try {
    const selection = window.getSelection();
    if (selection && selection.rangeCount > 0) {
      const range = selection.getRangeAt(0);
      const tempDiv = document.createElement('div');
      tempDiv.appendChild(range.cloneContents());
      return tempDiv.innerHTML;
    }
  } catch (error) {
    console.error('鑾峰彇閫変腑 HTML 澶辫触:', error);
  }

  return '';
};

const getSelectedVditorDOM = (): string => {
  if (!editorInstance.value || !editorRef.value) return '';

  try {
    const selection = window.getSelection();
    if (selection && selection.rangeCount > 0) {
      const range = selection.getRangeAt(0);
      const editorElement = editorRef.value.querySelector('.vditor-wysiwyg');
      if (!editorElement) return '';

      const commonAncestor = range.commonAncestorContainer;
      if (!editorElement.contains(commonAncestor as Node)) return '';

      const startElement = range.startContainer.nodeType === Node.ELEMENT_NODE
        ? range.startContainer as Element
        : range.startContainer.parentElement;

      const blockElement = startElement?.closest('[data-block="0"], p, h1, h2, h3, h4, h5, h6, li, blockquote, pre, table, div.vditor-reset > div');
      if (blockElement && range.toString().trim() === blockElement.textContent?.trim()) {
        return blockElement.outerHTML;
      }

      const tempDiv = document.createElement('div');
      tempDiv.appendChild(range.cloneContents());
      return tempDiv.innerHTML;
    }
  } catch (error) {
    console.error('鑾峰彇閫変腑 Vditor DOM 澶辫触:', error);
  }

  return '';
};

const getSelectionAsMarkdown = (): string => {
  if (!editorInstance.value) return '';

  try {
    const vditorDOM = getSelectedVditorDOM() || getSelectedHtml();
    if (!vditorDOM) return '';

    const vditor = (editorInstance.value as any).vditor;
    if (vditor?.lute) {
      const markdown = vditor.lute.VditorDOM2Md(vditorDOM);
      if (markdown && markdown.trim()) return markdown;
    }

    const markdown = editorInstance.value.html2md(vditorDOM);
    if (markdown && markdown.trim()) return markdown;
  } catch (_) {
    // ignore
  }

  try {
    const selection = editorInstance.value.getSelection();
    if (selection && selection.trim()) return selection;
  } catch (_) {
    // ignore
  }

  return '';
};

const getEditorContentRoot = (): HTMLElement | null => {
  return editorRef.value?.querySelector('.vditor-wysiwyg .vditor-reset')
    ?? editorRef.value?.querySelector('.vditor-wysiwyg')
    ?? null;
};

const getLineHeight = (element: HTMLElement | null): number => {
  if (!element) return 28;

  const computedStyle = window.getComputedStyle(element);
  const parsed = Number.parseFloat(computedStyle.lineHeight);
  if (Number.isFinite(parsed)) return parsed;

  const fallback = Number.parseFloat(computedStyle.fontSize);
  return Number.isFinite(fallback) ? fallback * 1.75 : 28;
};

const getElementPaddingTop = (element: HTMLElement | null): number => {
  if (!element) return 0;

  const computedStyle = window.getComputedStyle(element);
  const parsed = Number.parseFloat(computedStyle.paddingTop);
  return Number.isFinite(parsed) ? parsed : 0;
};

const isFiniteRect = (rect: DOMRect | null | undefined): rect is DOMRect => {
  return Boolean(
    rect
    && Number.isFinite(rect.top)
    && Number.isFinite(rect.bottom)
    && Number.isFinite(rect.height),
  );
};

const pickCaretRect = (range: Range, lineHeight: number): DOMRect | null => {
  const inlineRect = Array.from(range.getClientRects()).find((rect) => {
    return isFiniteRect(rect) && rect.height > 0 && rect.height <= lineHeight * 1.5;
  });

  if (inlineRect) return inlineRect;

  const fallbackRect = range.getBoundingClientRect();
  return isFiniteRect(fallbackRect) ? fallbackRect : null;
};

const serializeFragmentToMarkdown = (fragment: DocumentFragment): string => {
  if (!editorInstance.value) return '';

  const container = document.createElement('div');
  container.appendChild(fragment);
  const html = container.innerHTML;
  if (!html.trim()) return '';

  try {
    const vditor = (editorInstance.value as any).vditor;
    if (vditor?.lute) {
      return vditor.lute.VditorDOM2Md(html).trim();
    }
  } catch (_) {
    // ignore
  }

  try {
    return editorInstance.value.html2md(html).trim();
  } catch (_) {
    return '';
  }
};

const createSplitContent = (beforeContent: string, afterContent: string): SplitContent => ({
  beforeContent,
  afterContent,
});

const getRangeSplitContent = (
  contentRoot: HTMLElement,
  setRangeBoundaries: (beforeRange: Range, afterRange: Range) => void,
): SplitContent => {
  const beforeRange = document.createRange();
  beforeRange.selectNodeContents(contentRoot);

  const afterRange = document.createRange();
  afterRange.selectNodeContents(contentRoot);

  setRangeBoundaries(beforeRange, afterRange);

  return createSplitContent(
    serializeFragmentToMarkdown(beforeRange.cloneContents()),
    serializeFragmentToMarkdown(afterRange.cloneContents()),
  );
};

const getEditorCaretRange = (contentRoot: HTMLElement): Range | null => {
  const selection = window.getSelection();
  if (!selection || selection.rangeCount === 0) return null;

  const focusNode = selection.focusNode;
  if (focusNode && contentRoot.contains(focusNode)) {
    try {
      const caretRange = document.createRange();
      caretRange.setStart(focusNode, selection.focusOffset);
      caretRange.collapse(true);
      return caretRange;
    } catch (_) {
      // fallback below
    }
  }

  const range = selection.getRangeAt(0).cloneRange();
  if (contentRoot.contains(range.startContainer)) return range;

  // Caret may be in a parent of contentRoot (e.g. empty Vditor with caret in
  // .vditor-wysiwyg instead of .vditor-reset). Try to anchor the range to the
  // first child of contentRoot so the handle can still be positioned.
  if (focusNode && focusNode.contains(contentRoot)) {
    try {
      const fallbackRange = document.createRange();
      if (contentRoot.firstChild) {
        fallbackRange.setStart(contentRoot.firstChild, 0);
      } else {
        fallbackRange.setStart(contentRoot, 0);
      }
      fallbackRange.collapse(true);
      return fallbackRange;
    } catch (_) {
      // ignore
    }
  }

  return null;
};

const resolveLineBlockFromNode = (
  node: Node | null | undefined,
  contentRoot: HTMLElement,
): HTMLElement | null => {
  if (!node) return null;

  const element = node.nodeType === Node.ELEMENT_NODE
    ? node as Element
    : node.parentElement;

  const blockElement = element?.closest(LINE_BLOCK_SELECTOR) as HTMLElement | null;
  if (!blockElement || !contentRoot.contains(blockElement)) return null;
  return blockElement;
};

const resolveLineBlockFromCaretRange = (
  caretRange: Range,
  contentRoot: HTMLElement,
): HTMLElement | null => {
  const directBlock = resolveLineBlockFromNode(caretRange.startContainer, contentRoot);
  if (directBlock) return directBlock;

  if (caretRange.startContainer.nodeType === Node.ELEMENT_NODE) {
    const container = caretRange.startContainer as Element;
    const childNodes = Array.from(container.childNodes);
    const candidateNodes: Node[] = [];

    if (caretRange.startOffset < childNodes.length) {
      candidateNodes.push(childNodes[caretRange.startOffset]);
    }
    if (caretRange.startOffset > 0) {
      candidateNodes.push(childNodes[caretRange.startOffset - 1]);
    }

    for (const candidateNode of candidateNodes) {
      const candidateBlock = resolveLineBlockFromNode(candidateNode, contentRoot);
      if (candidateBlock) return candidateBlock;
    }
  }

  return null;
};

const resolveLineBlockFromSelection = (): HTMLElement | null => {
  const editorContentRoot = getEditorContentRoot();
  if (!editorContentRoot) return null;

  const caretRange = getEditorCaretRange(editorContentRoot);
  if (!caretRange) return null;
  return resolveLineBlockFromCaretRange(caretRange, editorContentRoot);
};

const updateLineHandlePosition = (lineElement: HTMLElement) => {
  if (!wrapperRef.value) return;

  const wrapperRect = wrapperRef.value.getBoundingClientRect();
  const lineRect = lineElement.getBoundingClientRect();
  lineHandleTop.value = lineRect.top - wrapperRect.top + lineRect.height / 2;
  lineHandleVisible.value = true;
};

const updateHandlePositionFromCaret = (contentRoot: HTMLElement) => {
  if (!wrapperRef.value) return;

  const range = getEditorCaretRange(contentRoot);
  const lineHeight = getLineHeight(contentRoot);
  const rect = range ? pickCaretRect(range, lineHeight) : null;
  const wrapperRect = wrapperRef.value.getBoundingClientRect();
  const contentRect = contentRoot.getBoundingClientRect();
  const rectLooksOversized = Boolean(
    rect
    && (
      rect.height > lineHeight * 1.5
      || (
        Math.abs(rect.top - contentRect.top) <= 2
        && Math.abs(rect.bottom - contentRect.bottom) <= 2
      )
    ),
  );
  const currentLineElement = activeLineElement.value;
  const canUseCurrentLineElement = Boolean(
    currentLineElement
    && contentRoot.contains(currentLineElement),
  );

  let visualCenter = 0;
  if (rectLooksOversized) {
    if (canUseCurrentLineElement) {
      updateLineHandlePosition(currentLineElement!);
      return;
    }
    visualCenter = contentRect.top + getElementPaddingTop(contentRoot) + lineHeight / 2;
  } else if (rect && rect.height > 0 && Number.isFinite(rect.top)) {
    visualCenter = rect.top + rect.height / 2;
  } else {
    if (canUseCurrentLineElement) {
      updateLineHandlePosition(currentLineElement!);
      return;
    }
    visualCenter = contentRect.top + getElementPaddingTop(contentRoot) + lineHeight / 2;
  }

  lineHandleTop.value = visualCenter - wrapperRect.top;
  lineHandleVisible.value = true;
};

const cancelScheduledHandleSync = () => {
  if (!scheduledHandleSyncFrame) return;
  window.cancelAnimationFrame(scheduledHandleSyncFrame);
  scheduledHandleSyncFrame = 0;
};

const syncEditorHandleToCaret = () => {
  scheduledHandleSyncFrame = 0;

  if (!isReady.value || !isEditorFocused.value || !props.editable || !props.lineHandleEnabled) return;

  const editorContentRoot = getEditorContentRoot();
  if (!editorContentRoot) {
    hideLineHandle();
    return;
  }

  activeLineElement.value = resolveLineBlockFromSelection();
  lineHandleMode.value = 'editor-caret';
  lastEditorLineSplitContent.value = activeLineElement.value ? getActiveLineSplitContent() : null;
  updateHandlePositionFromCaret(editorContentRoot);
};

const scheduleEditorHandleSync = (frames = 1) => {
  cancelScheduledHandleSync();

  const run = (remainingFrames: number) => {
    scheduledHandleSyncFrame = window.requestAnimationFrame(() => {
      if (remainingFrames > 1) {
        run(remainingFrames - 1);
        return;
      }

      syncEditorHandleToCaret();
    });
  };

  run(Math.max(1, frames));
};

const getLineSplitContentFromElement = (
  contentRoot: HTMLElement,
  lineElement: HTMLElement,
): SplitContent | null => {
  if (!contentRoot.contains(lineElement)) return null;

  return getRangeSplitContent(contentRoot, (beforeRange, afterRange) => {
    beforeRange.setEndAfter(lineElement);
    afterRange.setStartAfter(lineElement);
  });
};

const getActiveLineSplitContent = (): SplitContent | null => {
  const editorContentRoot = getEditorContentRoot();
  const lineElement = activeLineElement.value;
  if (!editorContentRoot || !lineElement) return null;

  return getLineSplitContentFromElement(editorContentRoot, lineElement);
};

const getEditorLineSplitContentForInsert = (): SplitContent | null => {
  const editorContentRoot = getEditorContentRoot();
  if (!editorContentRoot) return lastEditorLineSplitContent.value;

  const operationLineElement = resolveLineBlockFromSelection() ?? activeLineElement.value;
  if (!operationLineElement) return lastEditorLineSplitContent.value;

  return getLineSplitContentFromElement(editorContentRoot, operationLineElement)
    ?? lastEditorLineSplitContent.value;
};

const getOperationLineSplitContentForInsert = (): SplitContent | null => {
  return getEditorLineSplitContentForInsert();
};

const emitLineInsert = (blockType: LineInsertBlockType, layout?: 'horizontal' | 'vertical') => {
  const splitContent = getOperationLineSplitContentForInsert();

  if (!splitContent) return;

  emit('line-insert', {
    ...splitContent,
    blockType,
    layout,
  });

  lineMenuVisible.value = false;
  activeLineElement.value = null;
  lineHandleMode.value = null;
  lineHandleTop.value = null;
  lineHandleVisible.value = false;
};

const emitDeleteBlock = () => {
  emit('delete-block');
  lineMenuVisible.value = false;
  hideLineHandle();
};

const handleLineHandleSelect = (action: string) => {
  switch (action) {
    case 'insert-richtext':
      emitLineInsert('richtext');
      return;
    case 'insert-ref':
      emitLineInsert('ref');
      return;
    case 'insert-graph':
      emitLineInsert('graph');
      return;
    case 'insert-line':
      emitLineInsert('line');
      return;
    case 'insert-x6':
      emitLineInsert('x6');
      return;
    case 'insert-container-horizontal':
      emitLineInsert('container', 'horizontal');
      return;
    case 'insert-container-vertical':
      emitLineInsert('container', 'vertical');
      return;
    case 'delete':
      emitDeleteBlock();
      return;
    default:
      return;
  }
};

const handleLineMenuVisibilityChange = (visible: boolean) => {
  lineMenuVisible.value = visible;
};

const updateHandleFromSelection = () => {
  syncEditorHandleToCaret();
};

const extractSelection = () => {
  const markdown = getSelectionAsMarkdown();
  if (markdown) emit('extract-selection', markdown);
};

const removeEditorDomListeners = () => {
  if (!editorRef.value) return;

  const focusHandler = (editorRef.value as any)._focusHandler;
  const blurHandler = (editorRef.value as any)._blurHandler;
  const clickHandler = (editorRef.value as any)._clickHandler;
  const mouseUpHandler = (editorRef.value as any)._mouseUpHandler;
  const keyUpHandler = (editorRef.value as any)._keyUpHandler;
  const selectionChangeHandler = (editorRef.value as any)._selectionChangeHandler;
  const wrapperLeaveHandler = (wrapperRef.value as any)?._wrapperLeaveHandler;

  if (focusHandler) {
    editorRef.value.removeEventListener('focusin', focusHandler);
    delete (editorRef.value as any)._focusHandler;
  }

  if (blurHandler) {
    editorRef.value.removeEventListener('focusout', blurHandler);
    delete (editorRef.value as any)._blurHandler;
  }

  if (clickHandler) {
    editorRef.value.removeEventListener('click', clickHandler);
    delete (editorRef.value as any)._clickHandler;
  }

  if (mouseUpHandler) {
    editorRef.value.removeEventListener('mouseup', mouseUpHandler);
    delete (editorRef.value as any)._mouseUpHandler;
  }

  if (keyUpHandler) {
    editorRef.value.removeEventListener('keyup', keyUpHandler);
    delete (editorRef.value as any)._keyUpHandler;
  }

  if (selectionChangeHandler) {
    document.removeEventListener('selectionchange', selectionChangeHandler);
    delete (editorRef.value as any)._selectionChangeHandler;
  }

  if (wrapperRef.value && wrapperLeaveHandler) {
    wrapperRef.value.removeEventListener('mouseleave', wrapperLeaveHandler);
    delete (wrapperRef.value as any)._wrapperLeaveHandler;
  }
};

const attachEditorDomListeners = () => {
  if (!editorRef.value) return;

  removeEditorDomListeners();

  const handleClick = (event: MouseEvent) => {
    emit('click', event);
    scheduleEditorHandleSync(1);
  };

  const handleFocusOut = () => {
    setTimeout(() => {
      if (!editorRef.value?.contains(document.activeElement)) {
        isEditorFocused.value = false;
        if (pendingExternalContent.value != null && editorInstance.value) {
          const content = pendingExternalContent.value;
          pendingExternalContent.value = null;
          if (content !== editorInstance.value.getValue()) {
            applyEditorContent(content);
          }
        }
        const value = (editorInstance.value as any)?.getValue?.() ?? '';
        emit('blur', value);
        cancelScheduledHandleSync();
        hideLineHandle();
      }
    }, 0);
  };

  const handleFocusIn = () => {
    isEditorFocused.value = true;
    pendingExternalContent.value = null;
    scheduleEditorHandleSync(2);
  };

  const handleMouseUp = () => {
    scheduleEditorHandleSync(1);
  };

  const handleKeyUp = () => {
    scheduleEditorHandleSync(1);
  };

  const handleSelectionChange = () => {
    scheduleEditorHandleSync(1);
  };

  const handleWrapperMouseLeave = () => {
    if (isReady.value && isEditorFocused.value) return;
    hideLineHandle();
  };

  editorRef.value.addEventListener('click', handleClick);
  editorRef.value.addEventListener('focusin', handleFocusIn);
  editorRef.value.addEventListener('focusout', handleFocusOut);
  editorRef.value.addEventListener('mouseup', handleMouseUp);
  editorRef.value.addEventListener('keyup', handleKeyUp);
  document.addEventListener('selectionchange', handleSelectionChange);
  wrapperRef.value?.addEventListener('mouseleave', handleWrapperMouseLeave);
  (editorRef.value as any)._clickHandler = handleClick;
  (editorRef.value as any)._focusHandler = handleFocusIn;
  (editorRef.value as any)._blurHandler = handleFocusOut;
  (editorRef.value as any)._mouseUpHandler = handleMouseUp;
  (editorRef.value as any)._keyUpHandler = handleKeyUp;
  (editorRef.value as any)._selectionChangeHandler = handleSelectionChange;
  if (wrapperRef.value) {
    (wrapperRef.value as any)._wrapperLeaveHandler = handleWrapperMouseLeave;
  }
};

const initEditor = () => {
  if (!editorRef.value || editorInstance.value || isInitializing.value || isUnmounted.value) return;

  isInitializing.value = true;

  editorInstance.value = new Vditor(editorRef.value, {
    cdn: VDITOR_CDN,
    width: props.width,
    value: props.content,
    mode: 'wysiwyg' as const,
    cache: { enable: false },
    toolbarConfig: {
      hide: true,
    },
    toolbar: [],
    customWysiwygToolbar: () => {},
    after: () => {
      isInitializing.value = false;
      if (isUnmounted.value) return;

      isReady.value = true;
      attachEditorDomListeners();
      updateHeight();

      if ((props.autoFocus || pendingFocusAfterReady.value) && editorInstance.value) {
        nextTick(() => {
          if (isUnmounted.value) return;

          pendingFocusAfterReady.value = false;
          editorInstance.value?.focus();
          scheduleEditorHandleSync(2);
          emit('focused');
        });
      }
    },
    input: (value: string) => {
      lastEmittedContent.value = value;
      emit('content-change', value);
      setTimeout(() => {
        updateHeight();
        scheduleEditorHandleSync(1);
      }, 0);
    },
  });

  if (!props.editable) {
    editorInstance.value.disabled();
  }
};

const activateEditor = (shouldFocus = false) => {
  hasActivatedEditor.value = true;
  if (shouldFocus) {
    pendingFocusAfterReady.value = true;
  }

  nextTick(() => {
    initEditor();

    if (shouldFocus && isReady.value) {
      editorInstance.value?.focus();
      pendingFocusAfterReady.value = false;
    }
  });
};

const focusEditor = () => {
  if (editorInstance.value) {
    editorInstance.value.focus();
    return;
  }

  activateEditor(true);
};

const handlePreviewClick = (event: MouseEvent) => {
  emit('click', event);
  if (!props.editable) return;
  activateEditor(true);
};

const destroyEditorSafely = () => {
  const instance = editorInstance.value as any;

  if (!instance || instance.isDestroyed) {
    editorInstance.value = null;
    return;
  }

  try {
    if (instance.vditor?.element) {
      instance.destroy();
    }
  } catch (error) {
    console.warn('Failed to destroy Vditor cleanly:', error);
  } finally {
    editorInstance.value = null;
  }
};

defineExpose({
  extractSelection,
  focusEditor,
  getSelectionAsMarkdown,
});

onMounted(() => {
  emit('lifecycle', 'onMounted');

  if (hasActivatedEditor.value) {
    initEditor();
  }
});

onBeforeUnmount(() => {
  isUnmounted.value = true;
  emit('lifecycle', 'onBeforeUnmount');
  cancelScheduledHandleSync();
  removeEditorDomListeners();
  destroyEditorSafely();
});

watch(
  () => props.content,
  (newContent) => {
    emit('lifecycle', 'watch:content');

    if (!editorInstance.value) {
      lastEmittedContent.value = newContent;
      return;
    }

    if (newContent === lastEmittedContent.value) return;

    const currentValue = editorInstance.value.getValue();
    if (newContent === currentValue) {
      lastEmittedContent.value = newContent;
      return;
    }

    if (isEditorFocused.value) {
      pendingExternalContent.value = newContent;
      return;
    }

    applyEditorContent(newContent);
  }
);

watch(() => props.content, renderPreviewHtml);

watch(
  () => props.autoFocus,
  (shouldAutoFocus) => {
    if (shouldAutoFocus) {
      activateEditor(true);
    }
  }
);
</script>

<template>
  <div ref="wrapperRef" class="rich-text-editor-wrapper">
    <div v-if="hasActivatedEditor" ref="editorRef" class="rich-text-editor-container"></div>

    <HoverHandle
      v-if="editable && lineHandleEnabled && lineHandleVisible && lineHandleTop != null"
      class="editor-line-handle"
      :style="{
        '--hover-handle-left': 'calc(var(--line-handle-gutter) / 2)',
        '--hover-handle-top': `${lineHandleTop}px`,
        '--hover-handle-z-index': 4,
        '--hover-handle-item-hover-bg': '#f5f5f5',
        '--hover-handle-item-hover-color': '#333',
      }"
      :items="lineHandleItems"
      :prevent-mouse-down="true"
      @menu-visibility-change="handleLineMenuVisibilityChange"
      @select="handleLineHandleSelect"
    />


    <Transition name="preview-fade">
      <div
        v-if="!isReady"
        class="editor-preview"
        :class="{ 'editor-preview--overlay': hasActivatedEditor, 'editor-preview--editable': editable }"
        :tabindex="editable ? 0 : -1"
        @click="handlePreviewClick"
        @keydown.enter.prevent="activateEditor(true)"
      >
        <div class="editor-preview__content vditor-reset" v-html="previewHtml" />
      </div>
    </Transition>
  </div>
</template>

<style scoped>
.rich-text-editor-wrapper {
  --line-handle-gutter: var(--block-handle-gutter, 36px);
  --editor-block-padding: var(--block-content-pad-y, 10px);
  --editor-inline-padding: var(--block-content-pad-x, 15px);
  position: relative;
  width: 100%;
  min-width: 0;
  overflow: visible;
  box-sizing: border-box;
}

.editor-preview {
  position: relative;
  margin-left: var(--line-handle-gutter);
  background: #fff;
  padding: var(--editor-block-padding) var(--editor-inline-padding);
  overflow: visible;
  box-sizing: border-box;
}

.editor-preview--overlay {
  position: absolute;
  top: 0;
  right: 0;
  bottom: 0;
  left: var(--line-handle-gutter);
  margin-left: 0;
  z-index: 2;
}

.editor-preview--editable {
  cursor: text;
}

.editor-preview__content {
  padding: 0 !important;
  min-height: 24px;
}

.preview-fade-leave-active {
  transition: opacity 0.15s ease;
}

.preview-fade-leave-to {
  opacity: 0;
}

.rich-text-editor-container {
  border: none;
  border-radius: 0;
  overflow: visible;
  width: calc(100% - var(--line-handle-gutter));
  max-width: calc(100% - var(--line-handle-gutter));
  min-height: 44px;
  margin: 0;
  margin-left: var(--line-handle-gutter);
  padding: 0;
  display: block;
  position: relative;
  min-width: 0;
  box-sizing: border-box;
}

.rich-text-editor-container :deep(.vditor) {
  border: none;
  border-radius: 0;
  height: auto !important;
  width: 100% !important;
  box-sizing: border-box;
  margin: 0;
  padding: 0;
  overflow: visible;
}

.rich-text-editor-container :deep(.vditor-wysiwyg) {
  border: none;
  padding: 0;
  margin: 0;
  min-height: 44px;
  height: auto !important;
  width: 100% !important;
  box-sizing: border-box;
}

.rich-text-editor-container :deep(.vditor-toolbar) {
  border: none;
  border-bottom: 1px solid #f0f0f0;
  margin: 0;
  padding: 0;
  width: 100% !important;
  min-height: 40px;
}

.rich-text-editor-container :deep(.vditor-wysiwyg__toolbar) {
  display: none;
}

.rich-text-editor-container :deep(.vditor-preview) {
  border: none;
  margin: 0;
  padding: 0;
  height: auto !important;
}

.rich-text-editor-container :deep(.vditor-reset) {
  padding: var(--editor-block-padding) var(--editor-inline-padding) !important;
  margin: 0;
  height: auto !important;
  min-height: 44px;
  box-sizing: border-box;
}

.rich-text-editor-container :deep(.vditor-content) {
  height: auto !important;
  min-height: 44px;
  overflow-y: visible !important;
  margin: 0;
  padding: 0;
  width: 100% !important;
  box-sizing: border-box;
}

.rich-text-editor-container :deep(.vditor-wysiwyg .vditor-reset) {
  min-height: 44px;
  height: auto;
}

.rich-text-editor-container :deep(.vditor-toolbar__items) {
  margin: 0;
  padding: 8px 12px;
}

.rich-text-editor-container :deep(.vditor-toolbar) {
  display: none !important;
  height: 0 !important;
  min-height: 0 !important;
  overflow: hidden !important;
}

.rich-text-editor-container :deep(.vditor-toolbar:hover) {
  display: none !important;
  height: 0 !important;
  min-height: 0 !important;
  overflow: hidden !important;
}

.rich-text-editor-container :deep(.vditor-toolbar--hide) {
  display: none !important;
  height: 0 !important;
  min-height: 0 !important;
  overflow: hidden !important;
}

.rich-text-editor-container :deep(.vditor-panel) {
  display: none !important;
}
</style>
