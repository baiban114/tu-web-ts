import type { Router } from 'vue-router';
import type { KnowledgeAnchor, KnowledgeAnchorKind, KnowledgeRelation, TextAnnotation } from '@/api/types';
import { getAnnotationSelectionPayload } from '@/editor/annotationText';
import type { Editor } from '@tiptap/core';
import { listKnowledgePointAnchors } from '@/api/knowledgePoint';

export interface KnowledgeAnchorNavigateHandlers {
  router: Router;
  selectPage: (pageId: string) => Promise<void> | void;
  currentPageId?: string | null;
  scrollToAnnotation?: (pageId: string, annotationId: string) => void;
  scrollToHeading?: (pageId: string, headingBlockId: string) => void;
  scrollToSelection?: (pageId: string, from: number, to: number) => void;
}

export function pageAnchor(pageId: string, title?: string): KnowledgeAnchor {
  return {
    kind: 'page',
    locator: `page:${pageId}`,
    snapshot: title ? { title } : undefined,
  };
}

export function headingAnchor(pageId: string, blockId: string, title?: string): KnowledgeAnchor {
  return {
    kind: 'heading',
    locator: `page:${pageId}:heading:${blockId}`,
    snapshot: { pageId, ...(title ? { title } : {}) },
  };
}

export function annotationAnchor(pageId: string, annotationId: string, title?: string): KnowledgeAnchor {
  return {
    kind: 'annotation',
    locator: `page:${pageId}:annotation:${annotationId}`,
    snapshot: title ? { title } : undefined,
  };
}

export function sectionAnchor(pageId: string, sectionKey: string, title?: string): KnowledgeAnchor {
  return {
    kind: 'section',
    locator: `page:${pageId}:section:${sectionKey}`,
    snapshot: title ? { title } : undefined,
  };
}

export function resourceItemAnchor(itemId: string, title?: string): KnowledgeAnchor {
  return {
    kind: 'resourceItem',
    locator: `resource:${itemId}`,
    snapshot: title ? { title } : undefined,
  };
}

export function resourceExcerptAnchor(itemId: string, excerptId: string, title?: string): KnowledgeAnchor {
  return {
    kind: 'resourceExcerpt',
    locator: `resource:${itemId}:excerpt:${excerptId}`,
    snapshot: title ? { title } : undefined,
  };
}

export function buildAnnotationAnchorFromEditor(
  editor: Editor,
  pageId: string,
  annotationId: string,
): KnowledgeAnchor | null {
  const { from, to } = editor.state.selection;
  const payload = getAnnotationSelectionPayload(editor.state.doc, from, to);
  const title = payload.selectedText?.trim()
    || [payload.contextBefore, payload.contextAfter].filter(Boolean).join(' ').trim();
  return annotationAnchor(pageId, annotationId, title || undefined);
}

export function buildSelectionAnchor(
  editor: Editor,
  pageId: string,
): KnowledgeAnchor | null {
  const { from, to, empty } = editor.state.selection;
  if (empty) return null;
  const payload = getAnnotationSelectionPayload(editor.state.doc, from, to);
  const title = payload.selectedText?.trim()
    || [payload.contextBefore, payload.contextAfter].filter(Boolean).join(' ').trim();
  if (!title) return null;
  const tempId = `selection:${from}:${to}`;
  return {
    kind: 'annotation',
    locator: `page:${pageId}:selection:${from}:${to}`,
    snapshot: { title, from, to, ephemeral: true },
  };
}

export function anchorLabel(anchor: KnowledgeAnchor): string {
  const snap = anchor.snapshot ?? {};
  const title = typeof snap.title === 'string' ? snap.title : '';
  if (title) return title;
  return parseLocator(anchor.locator).display;
}

export function parseLocator(locator: string): {
  kind: KnowledgeAnchorKind | 'unknown';
  pageId?: string;
  resourceItemId?: string;
  excerptId?: string;
  entityId?: string;
  from?: number;
  to?: number;
  display: string;
} {
  if (locator.startsWith('page:')) {
    const rest = locator.slice(5);
    const parts = rest.split(':');
    const pageId = parts[0];
    if (parts.length === 1) {
      return { kind: 'page', pageId, display: `页面 ${pageId}` };
    }
    const entityType = parts[1];
    const entityId = parts.slice(2).join(':');
    if (entityType === 'heading') return { kind: 'heading', pageId, entityId, display: `标题 ${entityId}` };
    if (entityType === 'annotation') return { kind: 'annotation', pageId, entityId, display: `标注 ${entityId}` };
    if (entityType === 'section') return { kind: 'section', pageId, entityId, display: `节 ${entityId}` };
    if (entityType === 'selection') {
      const from = Number(parts[2]);
      const to = Number(parts[3]);
      return { kind: 'annotation', pageId, display: '当前选区', from, to };
    }
    return { kind: 'unknown', pageId, display: locator };
  }
  if (locator.startsWith('resource:')) {
    const rest = locator.slice(9);
    const parts = rest.split(':');
    const itemId = parts[0];
    if (parts[1] === 'excerpt' && parts[2]) {
      return { kind: 'resourceExcerpt', resourceItemId: itemId, excerptId: parts[2], display: `节选 ${parts[2]}` };
    }
    return { kind: 'resourceItem', resourceItemId: itemId, display: `资源 ${itemId}` };
  }
  return { kind: 'unknown', display: locator };
}

export async function navigateKnowledgeAnchor(
  anchor: KnowledgeAnchor,
  handlers: KnowledgeAnchorNavigateHandlers,
): Promise<void> {
  const parsed = parseLocator(anchor.locator);
  if (parsed.kind === 'resourceItem' || parsed.kind === 'resourceExcerpt') {
    await handlers.router.push({
      path: '/resources',
      query: {
        tab: 'items',
        itemId: parsed.resourceItemId,
        ...(parsed.excerptId ? { excerptId: parsed.excerptId } : {}),
      },
    });
    return;
  }

  if (!parsed.pageId) return;

  if (parsed.kind === 'page' || parsed.kind === 'heading' || parsed.kind === 'section') {
    if (handlers.currentPageId !== parsed.pageId) {
      await handlers.selectPage(parsed.pageId);
    }
    if (parsed.kind === 'heading' && parsed.entityId && handlers.scrollToHeading) {
      handlers.scrollToHeading(parsed.pageId, parsed.entityId);
    }
    return;
  }

  if (parsed.kind === 'annotation' && parsed.pageId) {
    if (handlers.currentPageId !== parsed.pageId) {
      await handlers.selectPage(parsed.pageId);
    }
    if (parsed.entityId?.startsWith('selection:') || (parsed.from != null && parsed.to != null)) {
      const from = parsed.from ?? Number(parsed.entityId?.split(':')[1]);
      const to = parsed.to ?? Number(parsed.entityId?.split(':')[2]);
      if (Number.isFinite(from) && Number.isFinite(to)) {
        handlers.scrollToSelection?.(parsed.pageId, from, to);
      }
      return;
    }
    if (parsed.entityId) {
      handlers.scrollToAnnotation?.(parsed.pageId, parsed.entityId);
    }
  }
}

export function annotationToAnchor(pageId: string, annotation: TextAnnotation): KnowledgeAnchor {
  const title = annotation.selectedText?.trim() || annotation.note?.trim();
  return annotationAnchor(pageId, annotation.id, title || undefined);
}

export async function navigateKnowledgePoint(
  pointId: string,
  handlers: KnowledgeAnchorNavigateHandlers,
): Promise<void> {
  const anchors = await listKnowledgePointAnchors(pointId);
  const primary = anchors.find((item) => item.primary) ?? anchors[0];
  if (!primary) return;
  await navigateKnowledgeAnchor(
    { kind: primary.kind, locator: primary.locator, snapshot: primary.snapshot },
    handlers,
  );
}

export function relationEndpointLabel(
  relation: KnowledgeRelation,
  direction: 'out' | 'in',
): string {
  const pointTitle = direction === 'out' ? relation.toPointTitle : relation.fromPointTitle;
  if (pointTitle) return pointTitle;
  const anchor = direction === 'out' ? relation.to : relation.from;
  if (anchor) return anchorLabel(anchor);
  return '未知知识点';
}
