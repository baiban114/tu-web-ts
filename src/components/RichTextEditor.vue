<script setup lang="ts">
import Vditor from 'vditor';
import 'vditor/dist/index.css';
import { computed, nextTick, onBeforeUnmount, onMounted, ref, watch } from 'vue';
import type { TextAnnotation } from '@/api/types';
import { applyAnnotations } from '@/utils/annotations';

interface Props {
  content: string;
  height?: number;
  width?: string;
  editable?: boolean;
  autoFocus?: boolean;
  lineHandleEnabled?: boolean;
  compact?: boolean;
  annotations?: TextAnnotation[];
}

type LineInsertBlockType = 'richtext' | 'line' | 'x6' | 'ref' | 'container' | 'table';

interface LineInsertPayload {
  beforeContent: string;
  afterContent: string;
  blockType: LineInsertBlockType;
  layout?: 'horizontal' | 'vertical';
}

interface TagEditorOpenPayload {
  top?: number;
  left?: number;
}

type LineHandleMode = 'editor-caret' | null;
type SplitContent = { beforeContent: string; afterContent: string };
type LinkDisplayMode = 'link' | 'image';

interface LineHandleChangePayload {
  visible: boolean;
  top: number | null;
  height: number | null;
  splitContent: SplitContent | null;
}

interface InsertedResourceLink {
  url: string;
  label: string;
  display: LinkDisplayMode;
  markdown: string;
  widthPercent?: number;
}

const props = withDefaults(defineProps<Props>(), {
  height: undefined,
  width: '100%',
  editable: true,
  autoFocus: false,
  lineHandleEnabled: true,
  compact: false,
});

const emit = defineEmits<{
  (e: 'content-change', content: string): void;
  (e: 'height-change', height: number): void;
  (e: 'extract-selection', text: string): void;
  (e: 'insert-block', position: number): void;
  (e: 'line-insert', payload: LineInsertPayload): void;
  (e: 'open-tag-editor', payload?: TagEditorOpenPayload): void;
  (e: 'delete-block'): void;
  (e: 'click', event: MouseEvent): void;
  (e: 'annotation-click', payload: { annotationId: string; event: MouseEvent }): void;
  (e: 'lifecycle', method: string): void;
  (e: 'blur', content: string): void;
  (e: 'focused'): void;
  (e: 'line-handle-change', payload: LineHandleChangePayload): void;
  (e: 'line-handle-menu-visibility-change', visible: boolean): void;
}>();

const VDITOR_CDN = '/vditor';

const wrapperRef = ref<HTMLDivElement | null>(null);
const editorRef = ref<HTMLDivElement | null>(null);
const previewContentRef = ref<HTMLDivElement | null>(null);
const editorInstance = ref<Vditor | null>(null);
const isUnmounted = ref(false);
const isReady = ref(false);
const isInitializing = ref(false);
const hasActivatedEditor = ref(!props.editable || props.autoFocus);
const isEditorFocused = ref(false);
const lastEmittedContent = ref(props.content);
const pendingExternalContent = ref<string | null>(null);
const pendingFocusAfterReady = ref(false);
let savedMarkdownLinkRange: Range | null = null;
let pendingPreviewClickRange: Range | null = null;
let pendingPreviewClickPoint: { x: number; y: number } | null = null;
let lastInsertedResourceLink: InsertedResourceLink | null = null;
const activeLineElement = ref<HTMLElement | null>(null);
const lineHandleMode = ref<LineHandleMode>(null);
const lineHandleTop = ref<number | null>(null);
const lineHandleHeight = ref<number | null>(null);
const lineHandleVisible = ref(false);
const lineMenuVisible = ref(false);
const lastEditorLineSplitContent = ref<SplitContent | null>(null);
const slashMenuVisible = ref(false);
const slashMenuTop = ref<number | null>(null);
const slashMenuLeft = ref<number | null>(null);
const slashQuery = ref('');
let scheduledHandleSyncFrame = 0;

// Image edit overlay (click image to enter; no browser Selection on the node)
const activeImageElement = ref<HTMLImageElement | null>(null);
const activeImageWidth = ref(100);
const imageEditActive = ref(false);
const isDragging = ref(false);
const dragStartX = ref(0);
const dragStartY = ref(0);
const dragStartWidthPx = ref(0);
const dragStartHeightPx = ref(0);
const dragHandlePosition = ref<string | null>(null);
const editorContentWidth = ref(0);
const imageRect = ref({ top: 0, left: 0, width: 0, height: 0 });
let imageResizeCleanup: (() => void) | null = null;
const slashOptions = [
  {
    key: 'edit-tags',
    label: '添加标签',
    command: '/tag',
    keywords: ['标签', 'tag', '/tag'],
  },
];
const filteredSlashOptions = computed(() => {
  const keyword = slashQuery.value.trim().toLowerCase();
  if (!keyword) return slashOptions;
  return slashOptions.filter((option) => option.keywords.some((item) => item.includes(keyword)));
});

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

const applyCurrentAnnotations = () => {
  const target = isReady.value ? editorRef.value : previewContentRef.value;
  if (!target) return;
  applyAnnotations(target, props.annotations ?? []);
};

const scheduleAnnotationApply = (delays = [0]) => {
  delays.forEach((delay) => {
    window.setTimeout(() => {
      if (isUnmounted.value) return;
      applyCurrentAnnotations();
    }, delay);
  });
};

const renderPreviewHtml = async () => {
  if (isReady.value) return;
  try {
    previewHtml.value = await Vditor.md2html(props.content, { cdn: VDITOR_CDN, mode: 'light' });
  } catch {
    previewHtml.value = `<p>${escapeHtml(props.content)}</p>`;
  }
  await nextTick();
  if (!isReady.value) applyCurrentAnnotations();
};

renderPreviewHtml();

const emitLineHandleState = () => {
  emit('line-handle-change', {
    visible: props.editable
      && props.lineHandleEnabled
      && lineHandleVisible.value
      && lineHandleTop.value != null
      && lineHandleHeight.value != null,
    top: lineHandleTop.value,
    height: lineHandleHeight.value,
    splitContent: lastEditorLineSplitContent.value,
  });
};

const hideLineHandle = () => {
  if (lineMenuVisible.value) return;
  activeLineElement.value = null;
  lineHandleMode.value = null;
  lineHandleTop.value = null;
  lineHandleHeight.value = null;
  lineHandleVisible.value = false;
  emitLineHandleState();
};

const hideSlashMenu = () => {
  slashMenuVisible.value = false;
  slashMenuTop.value = null;
  slashMenuLeft.value = null;
  slashQuery.value = '';
};

const getTagEditorAnchorFromCaret = (): TagEditorOpenPayload | undefined => {
  const contentRoot = getEditorContentRoot();
  if (!contentRoot) return undefined;

  const caretRange = getEditorCaretRange(contentRoot);
  const lineHeight = getLineHeight(contentRoot);
  const rect = caretRange ? pickCaretRect(caretRange, lineHeight) : null;
  if (!rect) return undefined;

  return {
    top: rect.bottom + 8,
    left: rect.left + 8,
  };
};

const getMarkdownLinkAnchor = (): TagEditorOpenPayload | undefined => {
  const contentRoot = getEditorContentRoot();
  if (!contentRoot) return undefined;

  const selection = window.getSelection();
  const selectionRange = selection && selection.rangeCount > 0 ? selection.getRangeAt(0).cloneRange() : null;
  const selectionNode = selection?.focusNode ?? selectionRange?.commonAncestorContainer ?? null;
  const range = selectionRange && selectionNode && contentRoot.contains(selectionNode)
    ? selectionRange
    : getEditorCaretRange(contentRoot);

  if (!range) return undefined;

  savedMarkdownLinkRange = range.cloneRange();
  const lineHeight = getLineHeight(contentRoot);
  const rect = pickCaretRect(range, lineHeight);
  if (!rect) return undefined;

  return {
    top: rect.bottom + 8,
    left: rect.left + 8,
  };
};

const applyEditorContent = (content: string) => {
  if (!editorInstance.value) return;
  editorInstance.value.setValue(content);
  lastEmittedContent.value = content;
  scheduleStoredImageWidthSync(content);
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

const escapeMarkdownLinkText = (text: string): string => {
  return text.replace(/([\[\]\\])/g, '\\$1').replace(/\n+/g, ' ').trim();
};

const escapeMarkdownLinkUrl = (url: string): string => {
  return url.trim().replace(/\)/g, '%29');
};

const escapeHtmlAttribute = (value: string): string => {
  return value
    .replace(/&/g, '&amp;')
    .replace(/"/g, '&quot;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
};

/** 与 Markdown 中 URL 写法（含 %29 等）对比，避免 getValue 为 ![](url) 时无法匹配 DOM 的 src */
const resourceUrlsMatch = (a: string, b: string): boolean => {
  const na = a.trim();
  const nb = b.trim();
  if (!na || !nb) return false;
  if (na === nb) return true;
  const variants = (u: string) => [u, escapeMarkdownLinkUrl(u)];
  for (const x of variants(na)) {
    for (const y of variants(nb)) {
      if (x === y) return true;
    }
  }
  try {
    return decodeURIComponent(na) === decodeURIComponent(nb);
  } catch {
    return false;
  }
};

const extractSrcFromImgTag = (tag: string): string | null => {
  const m = tag.match(/\bsrc\s*=\s*(["'])([\s\S]*?)\1/i);
  if (!m) return null;
  return m[2].replace(/&amp;/g, '&').replace(/&quot;/g, '"').replace(/&#39;/g, "'");
};

const extractImageWidthFromImgTag = (tag: string): number | null => {
  const dataWidth = tag.match(/\bdata-tu-image-width\s*=\s*(["'])([\s\S]*?)\1/i)?.[2];
  const styleWidth = tag.match(/\bstyle\s*=\s*(["'])([\s\S]*?)\1/i)?.[2]
    ?.match(/\bwidth\s*:\s*(\d+(?:\.\d+)?)\s*%/i)?.[1];
  const attrWidth = tag.match(/\bwidth\s*=\s*(["'])([\s\S]*?)\1/i)?.[2]
    ?.match(/^(\d+(?:\.\d+)?)%?$/)?.[1];
  const width = Number.parseFloat(dataWidth ?? styleWidth ?? attrWidth ?? '');
  return Number.isFinite(width) ? clampImageWidth(width) : null;
};

const styleImageElementWidth = (img: HTMLImageElement, widthPercent: number) => {
  const width = clampImageWidth(widthPercent);
  img.dataset.tuImageWidth = `${width}`;
  img.style.width = `${width}%`;
  img.style.maxWidth = '100%';
  img.style.height = 'auto';
};

const collectImageWidthRecords = (markdown: string) => {
  return Array.from(markdown.matchAll(/<img\b[^>]*?>/gi))
    .map((match) => {
      const tag = match[0];
      return {
        src: extractSrcFromImgTag(tag),
        width: extractImageWidthFromImgTag(tag),
      };
    })
    .filter((record): record is { src: string; width: number } => {
      return Boolean(record.src && record.width != null);
    });
};

const applyStoredImageWidthsToDom = (markdown: string) => {
  const contentRoot = getEditorContentRoot();
  if (!contentRoot) return;

  const records = collectImageWidthRecords(markdown);
  if (records.length === 0) return;

  contentRoot.querySelectorAll<HTMLImageElement>('img').forEach((img) => {
    const src = img.getAttribute('src');
    if (!src) return;

    const record = records.find((item) => resourceUrlsMatch(item.src, src));
    if (!record) return;

    styleImageElementWidth(img, record.width);
  });
};

const scheduleStoredImageWidthSync = (markdown: string) => {
  window.setTimeout(() => applyStoredImageWidthsToDom(markdown), 0);
};

const hasImageWidthRecord = (markdown: string, src: string): boolean => {
  return collectImageWidthRecords(markdown).some((record) => resourceUrlsMatch(record.src, src));
};

const mergeStoredImageWidths = (markdown: string, storedMarkdown: string): string => {
  return collectImageWidthRecords(storedMarkdown).reduce((next, record) => {
    if (hasImageWidthRecord(next, record.src)) return next;
    return replaceImageInMarkdown(next, record.src, '', record.width) ?? next;
  }, markdown);
};

const replaceImageInMarkdown = (
  markdown: string,
  domSrc: string,
  alt: string,
  widthPercent: number,
): string | null => {
  const newTag = createResourceLinkMarkdown(alt, domSrc, 'image', widthPercent);

  const htmlIter = markdown.matchAll(/<img\b[^>]*?>/gi);
  for (const m of htmlIter) {
    const full = m[0];
    const idx = m.index ?? 0;
    const src = extractSrcFromImgTag(full);
    if (src && resourceUrlsMatch(src, domSrc)) {
      return markdown.slice(0, idx) + newTag + markdown.slice(idx + full.length);
    }
  }

  const mdRe = /!\[([^\]]*)]\(([^)]+)\)/g;
  let mm: RegExpExecArray | null;
  while ((mm = mdRe.exec(markdown)) !== null) {
    const urlInMd = mm[2];
    if (resourceUrlsMatch(urlInMd, domSrc)) {
      const idx = mm.index;
      const full = mm[0];
      return markdown.slice(0, idx) + newTag + markdown.slice(idx + full.length);
    }
  }

  return null;
};

const clampImageWidth = (widthPercent: number): number => {
  return Math.max(10, Math.min(100, Math.round(widthPercent)));
};

const createResourceLinkMarkdown = (
  label: string,
  url: string,
  display: LinkDisplayMode,
  widthPercent = 100,
): string => {
  const safeUrl = escapeMarkdownLinkUrl(url);
  const safeLabel = escapeMarkdownLinkText(label) || safeUrl;
  if (display === 'image') {
    const width = clampImageWidth(widthPercent);
    return `<img src="${escapeHtmlAttribute(safeUrl)}" alt="${escapeHtmlAttribute(safeLabel)}" data-tu-resource-image="true" data-tu-image-width="${width}" style="width: ${width}%; max-width: 100%; height: auto;" />`;
  }
  return `[${safeLabel}](${safeUrl})`;
};

const focusInsertedResourceElement = (url: string) => {
  window.setTimeout(() => {
    const contentRoot = getEditorContentRoot();
    if (!contentRoot) return;

    const img = Array.from(contentRoot.querySelectorAll<HTMLImageElement>('img'))
      .reverse()
      .find((el) => el.getAttribute('src') === url && !el.closest('.vditor-wysiwyg__preview'));
    if (img) {
      selectImage(img);
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
};

const getEditorContentRoot = (): HTMLElement | null => {
  return editorRef.value?.querySelector('.vditor-wysiwyg .vditor-reset')
    ?? editorRef.value?.querySelector('.vditor-wysiwyg')
    ?? null;
};

const caretRangeFromPoint = (x: number, y: number): Range | null => {
  const doc = document as Document & {
    caretRangeFromPoint?: (x: number, y: number) => Range | null;
    caretPositionFromPoint?: (x: number, y: number) => { offsetNode: Node; offset: number } | null;
  };
  if (typeof doc.caretRangeFromPoint === 'function') {
    return doc.caretRangeFromPoint(x, y);
  }
  if (typeof doc.caretPositionFromPoint === 'function') {
    const pos = doc.caretPositionFromPoint(x, y);
    if (!pos) return null;
    const range = document.createRange();
    range.setStart(pos.offsetNode, pos.offset);
    range.collapse(true);
    return range;
  }
  return null;
};

// After the editor mounts where the preview used to live, place the caret at
// the original click coordinates instead of leaving it at the doc end where
// Vditor's focus() puts it.
const placeCaretAtPendingPoint = (): boolean => {
  if (!pendingPreviewClickPoint) return false;
  const { x, y } = pendingPreviewClickPoint;
  pendingPreviewClickPoint = null;

  const contentRoot = getEditorContentRoot();
  if (!contentRoot) return false;

  const range = caretRangeFromPoint(x, y);
  if (!range || !contentRoot.contains(range.startContainer)) return false;

  const selection = window.getSelection();
  if (!selection) return false;
  selection.removeAllRanges();
  selection.addRange(range);
  return true;
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

const getEditorCaretSplitContent = (): SplitContent | null => {
  const contentRoot = getEditorContentRoot();
  if (!contentRoot) return null;

  const caretRange = getEditorCaretRange(contentRoot);
  if (!caretRange) return null;

  return getRangeSplitContent(contentRoot, (beforeRange, afterRange) => {
    beforeRange.setEnd(caretRange.startContainer, caretRange.startOffset);
    afterRange.setStart(caretRange.startContainer, caretRange.startOffset);
  });
};

const getLineTextBeforeCaret = (lineElement: HTMLElement, contentRoot: HTMLElement): string => {
  const caretRange = getEditorCaretRange(contentRoot);
  if (!caretRange) return '';

  const lineRange = document.createRange();
  lineRange.selectNodeContents(lineElement);

  try {
    lineRange.setEnd(caretRange.startContainer, caretRange.startOffset);
  } catch (_) {
    return '';
  }

  return lineRange.toString();
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

const getSlashQueryFromSelection = (): string | null => {
  const contentRoot = getEditorContentRoot();
  const lineElement = activeLineElement.value ?? resolveLineBlockFromSelection();
  if (!contentRoot || !lineElement) return null;

  const selection = window.getSelection();
  if (!selection || selection.rangeCount === 0 || !selection.isCollapsed) return null;

  const lineTextBeforeCaret = getLineTextBeforeCaret(lineElement, contentRoot);
  const match = lineTextBeforeCaret.match(/(?:^|\s)\/([^\s/]*)$/);
  if (!match) return null;
  return match[1] ?? '';
};

const updateLineHandlePosition = (lineElement: HTMLElement) => {
  if (!wrapperRef.value) return;

  const wrapperRect = wrapperRef.value.getBoundingClientRect();
  const lineRect = lineElement.getBoundingClientRect();
  lineHandleTop.value = lineRect.top - wrapperRect.top;
  lineHandleHeight.value = Math.max(1, lineRect.height);
  lineHandleVisible.value = true;
  emitLineHandleState();
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

  let handleTop = 0;
  let handleHeight = lineHeight;
  if (rectLooksOversized) {
    if (canUseCurrentLineElement) {
      updateLineHandlePosition(currentLineElement!);
      return;
    }
    handleTop = contentRect.top + getElementPaddingTop(contentRoot);
  } else if (rect && rect.height > 0 && Number.isFinite(rect.top)) {
    handleTop = rect.top;
    handleHeight = Math.max(lineHeight, rect.height);
  } else {
    if (canUseCurrentLineElement) {
      updateLineHandlePosition(currentLineElement!);
      return;
    }
    handleTop = contentRect.top + getElementPaddingTop(contentRoot);
  }

  lineHandleTop.value = handleTop - wrapperRect.top;
  lineHandleHeight.value = Math.max(1, handleHeight);
  lineHandleVisible.value = true;
  emitLineHandleState();
};

const updateSlashMenuFromCaret = (contentRoot: HTMLElement) => {
  const query = getSlashQueryFromSelection();
  if (query == null || !wrapperRef.value) {
    hideSlashMenu();
    return;
  }

  const caretRange = getEditorCaretRange(contentRoot);
  const lineHeight = getLineHeight(contentRoot);
  const rect = caretRange ? pickCaretRect(caretRange, lineHeight) : null;
  const wrapperRect = wrapperRef.value.getBoundingClientRect();

  slashQuery.value = query;
  slashMenuTop.value = rect ? rect.bottom - wrapperRect.top + 8 : lineHeight + 8;
  slashMenuLeft.value = rect ? rect.left - wrapperRect.left + 8 : 40;
  slashMenuVisible.value = filteredSlashOptions.value.length > 0;
};

const cancelScheduledHandleSync = () => {
  if (!scheduledHandleSyncFrame) return;
  window.cancelAnimationFrame(scheduledHandleSyncFrame);
  scheduledHandleSyncFrame = 0;
};

const syncEditorHandleToCaret = () => {
  scheduledHandleSyncFrame = 0;

  if (!isReady.value || !isEditorFocused.value || !props.editable || !props.lineHandleEnabled) {
    hideLineHandle();
    return;
  }

  const editorContentRoot = getEditorContentRoot();
  if (!editorContentRoot) {
    hideLineHandle();
    hideSlashMenu();
    return;
  }

  activeLineElement.value = resolveLineBlockFromSelection();
  lineHandleMode.value = 'editor-caret';
  lastEditorLineSplitContent.value = activeLineElement.value ? getActiveLineSplitContent() : null;
  updateHandlePositionFromCaret(editorContentRoot);
  updateSlashMenuFromCaret(editorContentRoot);
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
  emit('line-handle-menu-visibility-change', false);
  activeLineElement.value = null;
  lineHandleMode.value = null;
  lineHandleTop.value = null;
  lineHandleVisible.value = false;
  emitLineHandleState();
};

const emitDeleteBlock = () => {
  emit('delete-block');
  lineMenuVisible.value = false;
  emit('line-handle-menu-visibility-change', false);
  hideLineHandle();
};

const requestTagEditor = (options?: {
  removeSlashCommand?: boolean;
  anchorFromCaret?: boolean;
}) => {
  const payload = options?.anchorFromCaret ? getTagEditorAnchorFromCaret() : undefined;

  if (options?.removeSlashCommand) {
    const splitContent = getEditorCaretSplitContent();
    if (splitContent) {
      const cleanedBeforeContent = splitContent.beforeContent.replace(/(^|[\s\u3000])\/[^\s/]*$/, '$1');
      const updatedContent = `${cleanedBeforeContent}${splitContent.afterContent}`.replace(/^\n+/, '');
      applyEditorContent(updatedContent);
      emit('content-change', updatedContent);
      updateHeight();
    }
  }

  hideSlashMenu();
  lineMenuVisible.value = false;
  emit('line-handle-menu-visibility-change', false);
  hideLineHandle();

  void nextTick(() => {
    emit('open-tag-editor', payload);
  });
};

const openTagEditorFromSlash = () => {
  requestTagEditor({
    removeSlashCommand: true,
    anchorFromCaret: true,
  });
};

const openTagEditorFromAction = () => {
  requestTagEditor({
    anchorFromCaret: true,
  });
};

const handleSlashOptionSelect = (action: string) => {
  switch (action) {
    case 'edit-tags':
      openTagEditorFromSlash();
      return;
    default:
      return;
  }
};

const isExactSlashMatch = (option: typeof slashOptions[number]) => {
  const keyword = slashQuery.value.trim().toLowerCase();
  if (!keyword) return false;

  return option.command.toLowerCase() === `/${keyword}`
    || option.keywords.some((item) => item.replace(/^\//, '').toLowerCase() === keyword);
};

const handleSlashMenuKeyDown = (event: KeyboardEvent) => {
  if (!slashMenuVisible.value || filteredSlashOptions.value.length === 0) return;

  if (event.key === 'Enter' || event.key === 'Tab') {
    event.preventDefault();
    event.stopPropagation();
    handleSlashOptionSelect(filteredSlashOptions.value[0].key);
    return;
  }

  if (event.key === ' ' && filteredSlashOptions.value.length === 1 && isExactSlashMatch(filteredSlashOptions.value[0])) {
    event.preventDefault();
    event.stopPropagation();
    handleSlashOptionSelect(filteredSlashOptions.value[0].key);
    return;
  }

  if (event.key === 'Escape') {
    event.preventDefault();
    event.stopPropagation();
    hideSlashMenu();
  }
};

const handleLineHandleSelect = (action: string) => {
  switch (action) {
    case 'insert-richtext':
      emitLineInsert('richtext');
      return;
    case 'insert-ref':
      emitLineInsert('ref');
      return;
    case 'insert-line':
      emitLineInsert('line');
      return;
    case 'insert-x6':
      emitLineInsert('x6');
      return;
    case 'insert-table':
      emitLineInsert('table');
      return;
    case 'insert-container-horizontal':
      emitLineInsert('container', 'horizontal');
      return;
    case 'insert-container-vertical':
      emitLineInsert('container', 'vertical');
      return;
    case 'edit-tags':
      openTagEditorFromAction();
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
  emit('line-handle-menu-visibility-change', visible);
  if (!visible && !isEditorFocused.value) {
    hideLineHandle();
  }
};

const updateHandleFromSelection = () => {
  syncEditorHandleToCaret();
};

const extractSelection = () => {
  const markdown = getSelectionAsMarkdown();
  if (markdown) emit('extract-selection', markdown);
};

const updateEditorContentWidth = () => {
  const contentRoot = getEditorContentRoot();
  if (contentRoot) {
    editorContentWidth.value = contentRoot.getBoundingClientRect().width;
  }
};

const updateImageRect = () => {
  if (!activeImageElement.value || !wrapperRef.value) return;
  const imgRect = activeImageElement.value.getBoundingClientRect();
  const wrapperRect = wrapperRef.value.getBoundingClientRect();
  imageRect.value = {
    top: imgRect.top - wrapperRect.top,
    left: imgRect.left - wrapperRect.left,
    width: imgRect.width,
    height: imgRect.height,
  };
};

const startOverlayTracking = () => {
  stopOverlayTracking();
  const update = () => {
    if (!activeImageElement.value || !wrapperRef.value) return;
    updateImageRect();
  };
  update();
  document.addEventListener('scroll', update, true);
  window.addEventListener('resize', update);
  imageResizeCleanup = () => {
    document.removeEventListener('scroll', update, true);
    window.removeEventListener('resize', update);
  };
};

const stopOverlayTracking = () => {
  imageResizeCleanup?.();
  imageResizeCleanup = null;
};

const selectImage = (img: HTMLImageElement) => {
  window.getSelection()?.removeAllRanges();
  activeImageElement.value = img;
  const styleWidth = img.style.width;
  const match = styleWidth.match(/^(\d+(?:\.\d+)?)\s*%/);
  const dataWidth = Number.parseFloat(img.dataset.tuImageWidth ?? '');
  activeImageWidth.value = match
    ? clampImageWidth(parseFloat(match[1]))
    : Number.isFinite(dataWidth)
      ? clampImageWidth(dataWidth)
      : 100;
  imageEditActive.value = true;
  hideLineHandle();
  updateEditorContentWidth();
  startOverlayTracking();
};

const clearImageSelection = () => {
  activeImageElement.value = null;
  activeImageWidth.value = 100;
  imageEditActive.value = false;
  isDragging.value = false;
  dragHandlePosition.value = null;
  imageRect.value = { top: 0, left: 0, width: 0, height: 0 };
  stopOverlayTracking();
  cleanupImageResizeListeners();
};

const isEditablePreviewImage = (img: HTMLImageElement): boolean => {
  const preview = img.closest('.vditor-wysiwyg__preview');
  if (!preview) return true;

  if (img.dataset.tuResourceImage === 'true') return true;

  const block = preview.closest('.vditor-wysiwyg__block');
  if (block?.getAttribute('data-type') === 'html-block') {
    return (preview.previousElementSibling?.textContent ?? '').includes('<img');
  }

  return false;
};

/** 与 Vditor 一致：正文区图片可点；只排除 plantuml/mermaid 等非 HTML 图片预览 */
const isWysiwygBodyImage = (img: HTMLImageElement): boolean => {
  if (!editorRef.value?.contains(img)) return false;
  return isEditablePreviewImage(img);
};

const removeEditorDomListeners = () => {
  if (!editorRef.value) return;

  const focusHandler = (editorRef.value as any)._focusHandler;
  const blurHandler = (editorRef.value as any)._blurHandler;
  const imageClickCaptureHandler = (editorRef.value as any)._imageClickCaptureHandler;
  const clickHandler = (editorRef.value as any)._clickHandler;
  const mouseUpHandler = (editorRef.value as any)._mouseUpHandler;
  const keyUpHandler = (editorRef.value as any)._keyUpHandler;
  const keyDownHandler = (editorRef.value as any)._keyDownHandler;
  const selectionChangeHandler = (editorRef.value as any)._selectionChangeHandler;
  const imageOutsidePointerDownHandler = (editorRef.value as any)._imageOutsidePointerDownHandler;
  const windowBlurHandler = (editorRef.value as any)._windowBlurHandler;
  const wrapperLeaveHandler = (wrapperRef.value as any)?._wrapperLeaveHandler;

  if (focusHandler) {
    editorRef.value.removeEventListener('focusin', focusHandler);
    delete (editorRef.value as any)._focusHandler;
  }

  if (blurHandler) {
    editorRef.value.removeEventListener('focusout', blurHandler);
    delete (editorRef.value as any)._blurHandler;
  }

  if (imageClickCaptureHandler) {
    editorRef.value.removeEventListener('click', imageClickCaptureHandler, true);
    delete (editorRef.value as any)._imageClickCaptureHandler;
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

  if (keyDownHandler) {
    editorRef.value.removeEventListener('keydown', keyDownHandler, true);
    delete (editorRef.value as any)._keyDownHandler;
  }

  if (selectionChangeHandler) {
    document.removeEventListener('selectionchange', selectionChangeHandler);
    delete (editorRef.value as any)._selectionChangeHandler;
  }

  if (imageOutsidePointerDownHandler) {
    document.removeEventListener('mousedown', imageOutsidePointerDownHandler, true);
    delete (editorRef.value as any)._imageOutsidePointerDownHandler;
  }

  if (windowBlurHandler) {
    window.removeEventListener('blur', windowBlurHandler);
    delete (editorRef.value as any)._windowBlurHandler;
  }

  if (wrapperRef.value && wrapperLeaveHandler) {
    wrapperRef.value.removeEventListener('mouseleave', wrapperLeaveHandler);
    delete (wrapperRef.value as any)._wrapperLeaveHandler;
  }
};

const attachEditorDomListeners = () => {
  if (!editorRef.value) return;

  removeEditorDomListeners();

  /** 捕获阶段只识别图片点击；不阻止 Vditor 自己的“图片显示原文本”处理。 */
  const handleImageClickCapture = (event: MouseEvent) => {
    if (!props.editable) return;
    const raw = event.target;
    if (!raw || (raw as Node).nodeType !== Node.ELEMENT_NODE) return;
    const el = raw as HTMLElement;
    const img = el.tagName === 'IMG' ? (el as HTMLImageElement) : el.closest('img');
    if (!img || !isWysiwygBodyImage(img)) return;

    emit('click', event);
    selectImage(img);
    window.setTimeout(() => {
      if (editorRef.value?.contains(img)) updateImageRect();
    }, 0);
  };

  const handleClick = (event: MouseEvent) => {
    emit('click', event);

    const target = event.target as HTMLElement;
    const annotationSpan = target.closest('.tu-annotation') as HTMLElement | null;
    if (annotationSpan && annotationSpan.dataset.annotationId) {
      emit('annotation-click', { annotationId: annotationSpan.dataset.annotationId, event });
      return;
    }

    const img = target.closest('img');
    if (img && isWysiwygBodyImage(img)) {
      window.setTimeout(() => {
        if (!editorRef.value?.contains(img)) return;
        updateImageRect();
      }, 0);
      return;
    }

    if (activeImageElement.value) {
      clearImageSelection();
    }

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
        hideSlashMenu();
        clearImageSelection();
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

  const handleKeyDown = (event: KeyboardEvent) => {
    if (activeImageElement.value && event.key === 'Escape') {
      clearImageSelection();
      event.preventDefault();
      event.stopPropagation();
      return;
    }
    handleSlashMenuKeyDown(event);
  };

  const handleSelectionChange = () => {
    scheduleEditorHandleSync(1);
  };

  const handleImageOutsidePointerDown = (event: MouseEvent) => {
    if (!imageEditActive.value || isDragging.value) return;
    const target = event.target;
    if (target instanceof Node && wrapperRef.value?.contains(target)) return;
    clearImageSelection();
  };

  const handleWindowBlur = () => {
    if (imageEditActive.value && !isDragging.value) {
      clearImageSelection();
    }
  };

  const handleWrapperMouseLeave = () => {
    if (isReady.value && isEditorFocused.value) return;
    hideLineHandle();
    hideSlashMenu();
  };

  editorRef.value.addEventListener('click', handleImageClickCapture, true);
  editorRef.value.addEventListener('click', handleClick);
  editorRef.value.addEventListener('focusin', handleFocusIn);
  editorRef.value.addEventListener('focusout', handleFocusOut);
  editorRef.value.addEventListener('mouseup', handleMouseUp);
  editorRef.value.addEventListener('keyup', handleKeyUp);
  editorRef.value.addEventListener('keydown', handleKeyDown, true);
  document.addEventListener('selectionchange', handleSelectionChange);
  document.addEventListener('mousedown', handleImageOutsidePointerDown, true);
  window.addEventListener('blur', handleWindowBlur);
  wrapperRef.value?.addEventListener('mouseleave', handleWrapperMouseLeave);
  (editorRef.value as any)._imageClickCaptureHandler = handleImageClickCapture;
  (editorRef.value as any)._clickHandler = handleClick;
  (editorRef.value as any)._focusHandler = handleFocusIn;
  (editorRef.value as any)._blurHandler = handleFocusOut;
  (editorRef.value as any)._mouseUpHandler = handleMouseUp;
  (editorRef.value as any)._keyUpHandler = handleKeyUp;
  (editorRef.value as any)._keyDownHandler = handleKeyDown;
  (editorRef.value as any)._selectionChangeHandler = handleSelectionChange;
  (editorRef.value as any)._imageOutsidePointerDownHandler = handleImageOutsidePointerDown;
  (editorRef.value as any)._windowBlurHandler = handleWindowBlur;
  if (wrapperRef.value) {
    (wrapperRef.value as any)._wrapperLeaveHandler = handleWrapperMouseLeave;
  }
};

const cleanupImageResizeListeners = () => {
  document.removeEventListener('mousemove', onResizeMouseMove);
  document.removeEventListener('mouseup', onResizeMouseUp);
};

const onResizeMouseMove = (event: MouseEvent) => {
  if (!isDragging.value || !activeImageElement.value) return;
  const pos = dragHandlePosition.value;
  const deltaX = event.clientX - dragStartX.value;
  const deltaY = event.clientY - dragStartY.value;
  const startW = dragStartWidthPx.value;
  const startH = Math.max(1, dragStartHeightPx.value);
  const aspect = startW / startH;

  let newWidthPx = startW;
  if (pos === 'e') {
    newWidthPx = startW + deltaX;
  } else if (pos === 'w') {
    newWidthPx = startW - deltaX;
  } else if (pos === 's') {
    newWidthPx = (startH + deltaY) * aspect;
  } else if (pos === 'n') {
    newWidthPx = (startH - deltaY) * aspect;
  } else if (pos === 'se') {
    newWidthPx = Math.max(startW + deltaX, (startH + deltaY) * aspect);
  } else if (pos === 'sw') {
    newWidthPx = Math.max(startW - deltaX, (startH + deltaY) * aspect);
  } else if (pos === 'ne') {
    newWidthPx = Math.max(startW + deltaX, (startH - deltaY) * aspect);
  } else if (pos === 'nw') {
    newWidthPx = Math.max(startW - deltaX, (startH - deltaY) * aspect);
  }

  newWidthPx = Math.max(20, newWidthPx);
  const contentW = editorContentWidth.value || 1;
  const newPercent = clampImageWidth((newWidthPx / contentW) * 100);
  activeImageWidth.value = newPercent;
  const imgEl = activeImageElement.value;
  styleImageElementWidth(imgEl, newPercent);
  void imgEl.offsetWidth;
  // 宽度变化后立刻同步边框/手柄/工具栏位置（否则只有图片 reflow，叠加层仍用旧 rect）
  updateImageRect();
};

const onResizeMouseUp = () => {
  isDragging.value = false;
  dragHandlePosition.value = null;
  cleanupImageResizeListeners();
  updateImageRect();
  commitImageWidth();
  nextTick(() => updateImageRect());
};

const onResizeHandleMouseDown = (event: MouseEvent, position: string) => {
  if (!activeImageElement.value) return;
  event.preventDefault();
  event.stopPropagation();
  const img = activeImageElement.value;
  const rect = img.getBoundingClientRect();
  isDragging.value = true;
  dragHandlePosition.value = position;
  dragStartX.value = event.clientX;
  dragStartY.value = event.clientY;
  dragStartWidthPx.value = rect.width;
  dragStartHeightPx.value = rect.height;
  document.addEventListener('mousemove', onResizeMouseMove);
  document.addEventListener('mouseup', onResizeMouseUp);
};

const commitImageWidth = () => {
  const imgEl = activeImageElement.value;
  if (!imgEl) return;
  const imgSrc = imgEl.getAttribute('src');
  if (!imgSrc) return;

  const current = editorInstance.value?.getValue() ?? '';
  const alt = imgEl.getAttribute('alt') ?? '';
  const next = replaceImageInMarkdown(current, imgSrc, alt, activeImageWidth.value);
  if (next == null) return;

  lastEmittedContent.value = next;
  styleImageElementWidth(imgEl, activeImageWidth.value);
  emit('content-change', next);
  updateImageRect();
};

const HANDLE_SIZE = 12;

const getHandleStyle = (position: string) => {
  const { top, left, width, height } = imageRect.value;
  const half = HANDLE_SIZE / 2;
  let x = left;
  let y = top;
  switch (position) {
    case 'nw': break;
    case 'n': x = left + width / 2; break;
    case 'ne': x = left + width; break;
    case 'e': x = left + width; y = top + height / 2; break;
    case 'se': x = left + width; y = top + height; break;
    case 's': x = left + width / 2; y = top + height; break;
    case 'sw': x = left; y = top + height; break;
    case 'w': x = left; y = top + height / 2; break;
  }
  return {
    left: `${x - half}px`,
    top: `${y - half}px`,
  };
};

const getToolbarStyle = () => {
  const { top, left, width } = imageRect.value;
  const gap = 8;
  const minToolbarW = 120;
  return {
    top: `${top - gap}px`,
    left: `${left}px`,
    width: `${Math.max(width, minToolbarW)}px`,
    transform: 'translateY(-100%)',
  };
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
    toolbar: ['image'],
    customWysiwygToolbar: () => {},
    after: () => {
      isInitializing.value = false;
      if (isUnmounted.value) return;

      isReady.value = true;
      attachEditorDomListeners();
      scheduleStoredImageWidthSync(props.content);
      scheduleAnnotationApply([0, 40, 120]);
      updateHeight();

      if ((props.autoFocus || pendingFocusAfterReady.value) && editorInstance.value) {
        nextTick(() => {
          if (isUnmounted.value) return;

          pendingFocusAfterReady.value = false;
          editorInstance.value?.focus();
          // Try restoring caret at the preview-click point first; Vditor's
          // focus() above moves the caret to the doc end, so we override it.
          const restoredFromPoint = placeCaretAtPendingPoint();
          if (!restoredFromPoint && pendingPreviewClickRange) {
            const selection = window.getSelection();
            selection?.removeAllRanges();
            selection?.addRange(pendingPreviewClickRange);
          }
          pendingPreviewClickRange = null;
          scheduleEditorHandleSync(2);
          emit('focused');
        });
      }
    },
    input: (value: string) => {
      const normalizedValue = mergeStoredImageWidths(value, lastEmittedContent.value);
      lastEmittedContent.value = normalizedValue;
      emit('content-change', normalizedValue);
      setTimeout(() => {
        applyStoredImageWidthsToDom(normalizedValue);
        scheduleAnnotationApply([0, 40]);
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
      const restoredFromPoint = placeCaretAtPendingPoint();
      if (!restoredFromPoint && pendingPreviewClickRange) {
        const selection = window.getSelection();
        selection?.removeAllRanges();
        selection?.addRange(pendingPreviewClickRange);
      }
      pendingPreviewClickRange = null;
      pendingFocusAfterReady.value = false;
    }
  });
};

const focusEditor = () => {
  if (editorInstance.value) {
    if (isReady.value) {
      editorInstance.value.focus();
    } else {
      pendingFocusAfterReady.value = true;
    }
    return;
  }

  activateEditor(true);
};

const insertMarkdown = (markdown: string) => {
  if (!props.editable || !markdown) return;

  if (!editorInstance.value) {
    activateEditor(true);
  }

  nextTick(() => {
    if (!editorInstance.value) return;
    if (!isReady.value) {
      const stop = watch(isReady, (ready) => {
        if (ready) {
          stop();
          doInsertMarkdown(markdown);
        }
      });
      return;
    }
    doInsertMarkdown(markdown);
  });
};

const doInsertMarkdown = (markdown: string) => {
  if (savedMarkdownLinkRange) {
    const selection = window.getSelection();
    selection?.removeAllRanges();
    selection?.addRange(savedMarkdownLinkRange);
    savedMarkdownLinkRange = null;
  }
  editorInstance.value!.focus();
  editorInstance.value!.insertValue(markdown, true);
  const value = editorInstance.value!.getValue();
  lastEmittedContent.value = value;
  emit('content-change', value);
  setTimeout(() => {
    updateHeight();
    scheduleEditorHandleSync(1);
  }, 0);
};

const insertMarkdownLink = (label: string, url: string, display: LinkDisplayMode = 'link') => {
  const safeUrl = escapeMarkdownLinkUrl(url);
  if (!safeUrl) return;
  const markdown = createResourceLinkMarkdown(label, url, display);
  lastInsertedResourceLink = { url: safeUrl, label: label || safeUrl, display, markdown, widthPercent: 100 };
  insertMarkdown(markdown);
  focusInsertedResourceElement(safeUrl);
};

const updateInsertedLinkDisplay = (display: LinkDisplayMode) => {
  if (!editorInstance.value || !lastInsertedResourceLink) return false;
  const current = editorInstance.value.getValue();
  const nextMarkdown = createResourceLinkMarkdown(
    lastInsertedResourceLink.label,
    lastInsertedResourceLink.url,
    display,
    lastInsertedResourceLink.widthPercent ?? 100,
  );
  if (!current.includes(lastInsertedResourceLink.markdown)) return false;

  const next = current.replace(lastInsertedResourceLink.markdown, nextMarkdown);
  applyEditorContent(next);
  emit('content-change', next);
  lastInsertedResourceLink = {
    ...lastInsertedResourceLink,
    display,
    markdown: nextMarkdown,
  };
  focusInsertedResourceElement(lastInsertedResourceLink.url);
  return true;
};

const updateInsertedImageWidth = (widthPercent: number) => {
  if (!editorInstance.value || !lastInsertedResourceLink || lastInsertedResourceLink.display !== 'image') return false;
  const current = editorInstance.value.getValue();
  const nextWidth = clampImageWidth(widthPercent);
  const nextMarkdown = createResourceLinkMarkdown(
    lastInsertedResourceLink.label,
    lastInsertedResourceLink.url,
    'image',
    nextWidth,
  );
  if (!current.includes(lastInsertedResourceLink.markdown)) return false;

  const next = current.replace(lastInsertedResourceLink.markdown, nextMarkdown);
  applyEditorContent(next);
  emit('content-change', next);
  lastInsertedResourceLink = {
    ...lastInsertedResourceLink,
    widthPercent: nextWidth,
    markdown: nextMarkdown,
  };
  focusInsertedResourceElement(lastInsertedResourceLink.url);
  return true;
};

const handlePreviewClick = (event: MouseEvent) => {
  emit('click', event);
  const target = event.target as HTMLElement | null;
  const annotationSpan = target?.closest('.tu-annotation') as HTMLElement | null;
  if (annotationSpan?.dataset.annotationId) {
    emit('annotation-click', { annotationId: annotationSpan.dataset.annotationId, event });
    return;
  }
  if (!props.editable) return;
  const contentRoot = getEditorContentRoot();
  const selection = window.getSelection();
  const hasRangeSelection = Boolean(selection && selection.rangeCount > 0 && !selection.isCollapsed);
  if (contentRoot && selection && selection.rangeCount > 0) {
    const range = selection.getRangeAt(0).cloneRange();
    if (contentRoot.contains(range.commonAncestorContainer)) {
      pendingPreviewClickRange = range;
    }
  }
  if (hasRangeSelection) {
    // Selection already exists in preview; keep it and don't trigger activation
    // which would call editor.focus() and collapse selection to the end.
    return;
  }
  // Remember the click coordinates so we can place the caret precisely once the
  // editor mounts in the same screen region. Without this, Vditor's focus()
  // call after init lands the caret at the very end of the content.
  pendingPreviewClickPoint = { x: event.clientX, y: event.clientY };
  activateEditor(true);
};

const getSelectionPosition = (): { top: number; left: number; width: number } | null => {
  const selection = window.getSelection();
  if (!selection || selection.rangeCount === 0 || !selection.toString().trim()) return null;

  const contentRoot = getEditorContentRoot();
  if (!contentRoot) return null;

  const range = selection.getRangeAt(0);
  if (!contentRoot.contains(range.commonAncestorContainer)) return null;

  const rect = range.getBoundingClientRect();
  if (!rect || rect.width === 0) return null;

  return {
    top: rect.bottom,
    left: rect.left + rect.width / 2,
    width: rect.width,
  };
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
  getMarkdownLinkAnchor,
  getSelectionPosition,
  insertMarkdown,
  insertMarkdownLink,
  updateInsertedLinkDisplay,
  updateInsertedImageWidth,
  handleLineHandleSelect,
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

watch(
  () => props.annotations,
  (newAnnotations) => {
    if (isReady.value && editorRef.value) {
      nextTick(() => {
        scheduleAnnotationApply([0, 40]);
      });
      return;
    }
    nextTick(() => applyCurrentAnnotations());
  },
);
</script>

<template>
  <div ref="wrapperRef" class="rich-text-editor-wrapper" :class="{ 'rich-text-editor-wrapper--compact': compact }">
    <div v-if="hasActivatedEditor" ref="editorRef" class="rich-text-editor-container"></div>

    <div
      v-if="editable && slashMenuVisible && slashMenuTop != null && slashMenuLeft != null"
      class="slash-menu"
      :style="{
        top: `${slashMenuTop}px`,
        left: `${slashMenuLeft}px`,
      }"
    >
      <button
        v-for="option in filteredSlashOptions"
        :key="option.key"
        type="button"
        class="slash-menu__item"
        @mousedown.prevent
        @click="handleSlashOptionSelect(option.key)"
      >
        <span class="slash-menu__item-main">{{ option.label }}</span>
        <span class="slash-menu__item-command">{{ option.command }}</span>
      </button>
    </div>

    <!-- Image edit overlay: border + 8-point resize (width % in markdown; height follows aspect) -->
    <template v-if="editable && imageEditActive && activeImageElement">
      <div
        class="image-edit-frame"
        :style="{
          top: `${imageRect.top}px`,
          left: `${imageRect.left}px`,
          width: `${imageRect.width}px`,
          height: `${imageRect.height}px`,
        }"
        aria-hidden="true"
      />
      <div
        v-for="pos in (['nw', 'n', 'ne', 'e', 'se', 's', 'sw', 'w'] as const)"
        :key="pos"
        class="image-resize-handle"
        :class="`image-resize-handle--${pos}`"
        :style="getHandleStyle(pos)"
        @mousedown.prevent.stop="onResizeHandleMouseDown($event, pos)"
      />
      <div class="image-floating-toolbar" :style="getToolbarStyle()">
        <span class="image-toolbar__hint">宽度 {{ activeImageWidth }}% · 拖拽边角调整</span>
      </div>
    </template>


    <Transition name="preview-fade">
      <div
        v-if="!isReady"
        class="editor-preview"
        :class="{ 'editor-preview--overlay': hasActivatedEditor, 'editor-preview--editable': editable }"
        :tabindex="editable ? 0 : -1"
        @click="handlePreviewClick"
        @keydown.enter.prevent="activateEditor(true)"
      >
        <div ref="previewContentRef" class="editor-preview__content vditor-reset" v-html="previewHtml" />
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

.rich-text-editor-wrapper--compact {
  --line-handle-gutter: 0px;
  --editor-block-padding: 0px;
  --editor-inline-padding: 0px;
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
  pointer-events: none;
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

.slash-menu {
  position: absolute;
  z-index: 6;
  min-width: 140px;
  padding: 6px;
  border: 1px solid #e8e8e8;
  border-radius: 8px;
  background: #fff;
  box-shadow: 0 8px 24px rgba(0, 0, 0, 0.14);
}

.slash-menu__item {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
  width: 100%;
  border: none;
  border-radius: 6px;
  background: transparent;
  text-align: left;
  padding: 8px 10px;
  font-size: 13px;
  cursor: pointer;
}

.slash-menu__item:hover {
  background: #f5f7fa;
}

.slash-menu__item-main {
  color: #1f1f1f;
}

.slash-menu__item-command {
  flex-shrink: 0;
  color: #8c8c8c;
  font-size: 12px;
  font-family: ui-monospace, SFMono-Regular, Consolas, 'Liberation Mono', Menlo, monospace;
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

.image-edit-frame {
  position: absolute;
  box-sizing: border-box;
  border: 2px solid #1890ff;
  border-radius: 2px;
  pointer-events: none;
  z-index: 8;
}

/* Image resize handles */
.image-resize-handle {
  position: absolute;
  width: 12px;
  height: 12px;
  background: #fff;
  border: 2px solid #1890ff;
  border-radius: 2px;
  z-index: 10;
  box-sizing: border-box;
  cursor: pointer;
}
.image-resize-handle--nw,
.image-resize-handle--se {
  cursor: nwse-resize;
}
.image-resize-handle--ne,
.image-resize-handle--sw {
  cursor: nesw-resize;
}
.image-resize-handle--n,
.image-resize-handle--s {
  cursor: ns-resize;
}
.image-resize-handle--e,
.image-resize-handle--w {
  cursor: ew-resize;
}

/* Image floating toolbar (above the image) */
.image-floating-toolbar {
  position: absolute;
  z-index: 11;
  display: flex;
  align-items: center;
  justify-content: center;
  padding: 6px 10px;
  border: 1px solid #e8e8e8;
  border-radius: 8px;
  background: #fff;
  box-shadow: 0 8px 24px rgba(0, 0, 0, 0.14);
  box-sizing: border-box;
  min-width: 120px;
}
.image-toolbar__hint {
  font-size: 12px;
  color: #595959;
  user-select: none;
  text-align: center;
  line-height: 1.35;
}
</style>
