import type { TextAnnotation } from '@/api/types';

const ANNOTATION_CLASS = 'tu-annotation';

function getContentRoot(editorEl: HTMLElement): HTMLElement {
  return editorEl.querySelector('.vditor-wysiwyg .vditor-reset')
    ?? editorEl.querySelector('.vditor-wysiwyg')
    ?? editorEl;
}

function findAnnotationInText(
  fullText: string,
  annotation: TextAnnotation,
): { start: number; end: number } | null {
  const { contextBefore, selectedText, contextAfter } = annotation;

  const exactQuery = contextBefore + selectedText + contextAfter;
  let idx = fullText.indexOf(exactQuery);
  if (idx >= 0) {
    return { start: idx + contextBefore.length, end: idx + contextBefore.length + selectedText.length };
  }

  const beforeQuery = contextBefore + selectedText;
  idx = fullText.indexOf(beforeQuery);
  if (idx >= 0) {
    return { start: idx + contextBefore.length, end: idx + contextBefore.length + selectedText.length };
  }

  const afterQuery = selectedText + contextAfter;
  idx = fullText.indexOf(afterQuery);
  if (idx >= 0) {
    return { start: idx, end: idx + selectedText.length };
  }

  idx = fullText.indexOf(selectedText);
  if (idx >= 0) {
    return { start: idx, end: idx + selectedText.length };
  }

  return null;
}

function unwrapAnnotationSpans(root: HTMLElement): void {
  root.querySelectorAll(`.${ANNOTATION_CLASS}`).forEach((span) => {
    const parent = span.parentNode;
    if (!parent) return;

    while (span.firstChild) {
      parent.insertBefore(span.firstChild, span);
    }
    parent.removeChild(span);
  });
  root.normalize();
}

export function clearAnnotations(editorEl: HTMLElement): void {
  unwrapAnnotationSpans(getContentRoot(editorEl));
}

function collectTextNodeSegments(
  root: HTMLElement,
  start: number,
  end: number,
): Array<{ node: Text; startOffset: number; endOffset: number }> {
  const segments: Array<{ node: Text; startOffset: number; endOffset: number }> = [];
  let accumulated = 0;
  const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
  let node: Text | null;

  while ((node = walker.nextNode() as Text | null)) {
    const length = node.textContent?.length ?? 0;
    const nodeStart = accumulated;
    const nodeEnd = accumulated + length;
    accumulated = nodeEnd;

    if (length === 0 || nodeEnd <= start || nodeStart >= end) continue;

    const startOffset = Math.max(0, start - nodeStart);
    const endOffset = Math.min(length, end - nodeStart);
    if (startOffset < endOffset) {
      segments.push({ node, startOffset, endOffset });
    }
  }

  return segments;
}

function wrapTextSegment(
  node: Text,
  startOffset: number,
  endOffset: number,
  annotation: TextAnnotation,
): void {
  const text = node.textContent ?? '';
  const before = text.slice(0, startOffset);
  const selected = text.slice(startOffset, endOffset);
  const after = text.slice(endOffset);
  const parent = node.parentNode;
  if (!parent || !selected) return;

  const span = document.createElement('span');
  span.className = ANNOTATION_CLASS;
  span.dataset.annotationId = annotation.id;
  span.style.cssText = 'background:#FFEB3B;cursor:pointer;border-radius:2px;';
  span.textContent = selected;

  if (before) parent.insertBefore(document.createTextNode(before), node);
  parent.insertBefore(span, node);
  if (after) parent.insertBefore(document.createTextNode(after), node);
  parent.removeChild(node);
}

export function applyAnnotations(editorEl: HTMLElement, annotations: TextAnnotation[]): void {
  const contentRoot = getContentRoot(editorEl);
  clearAnnotations(editorEl);

  if (!annotations.length) return;

  const fullText = contentRoot.textContent ?? '';
  const items: { annotation: TextAnnotation; start: number; end: number }[] = [];

  for (const annotation of annotations) {
    const pos = findAnnotationInText(fullText, annotation);
    if (pos) items.push({ annotation, start: pos.start, end: pos.end });
  }

  items.sort((a, b) => b.start - a.start);

  for (const { annotation, start, end } of items) {
    const segments = collectTextNodeSegments(contentRoot, start, end);
    for (let i = segments.length - 1; i >= 0; i -= 1) {
      const segment = segments[i];
      wrapTextSegment(segment.node, segment.startOffset, segment.endOffset, annotation);
    }
  }
}
