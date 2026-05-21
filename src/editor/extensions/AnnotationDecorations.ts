import { Extension } from '@tiptap/core'
import { Plugin, PluginKey } from '@tiptap/pm/state'
import type { Mapping } from '@tiptap/pm/transform'
import { Decoration, DecorationSet } from '@tiptap/pm/view'
import type { Node as ProseMirrorNode } from '@tiptap/pm/model'
import type { EditorView } from '@tiptap/pm/view'
import type { TextAnnotation } from '@/api/types'

export interface AnnotationDecorationsOptions {
  annotations: TextAnnotation[]
  onAnnotationClick: (payload: { annotationId: string; annotationIds?: string[]; event: MouseEvent }) => void
  onAnnotationsMapped: (annotations: TextAnnotation[]) => void
}

interface AnnotationPluginState {
  annotations: TextAnnotation[]
  decorations: DecorationSet
}

interface TextSegment {
  textStart: number
  textEnd: number
  from: number
  to: number
}

interface IndexedDocText {
  text: string
  segments: TextSegment[]
}

export const annotationDecorationsKey = new PluginKey<AnnotationPluginState>('annotationDecorations')

export const AnnotationDecorations = Extension.create<AnnotationDecorationsOptions>({
  name: 'annotationDecorations',

  addOptions() {
    return {
      annotations: [],
      onAnnotationClick: () => {},
      onAnnotationsMapped: () => {},
    }
  },

  addProseMirrorPlugins() {
    const extension = this
    return [
      new Plugin<AnnotationPluginState>({
        key: annotationDecorationsKey,
        state: {
          init: (_, state) => buildPluginState(state.doc, extension.options.annotations),
          apply: (tr, previous, _oldState, newState) => {
            const meta = tr.getMeta(annotationDecorationsKey)
            if (meta?.annotations) {
              return buildPluginState(newState.doc, meta.annotations)
            }

            if (!tr.docChanged) return previous

            const mapped = previous.annotations.map((annotation) => mapAnnotation(annotation, tr.mapping))
            const resolved = resolveAnnotations(newState.doc, mapped)
            window.setTimeout(() => extension.options.onAnnotationsMapped(resolved), 0)
            return buildPluginState(newState.doc, resolved)
          },
        },
        props: {
          decorations(state) {
            return annotationDecorationsKey.getState(state)?.decorations ?? null
          },
          handleClick: (view: EditorView, pos: number, event: MouseEvent) => {
            const target = event.target as HTMLElement | null
            const annotationEl = target?.closest('[data-tu-annotation-id]') as HTMLElement | null
            const annotationId = annotationEl?.dataset.tuAnnotationId
            if (!annotationId) return false
            const pluginState = annotationDecorationsKey.getState(view.state)
            const clicked = pluginState?.annotations.find(annotation => annotation.id === annotationId)
            const hitPos = Math.max(0, pos - 1)
            const annotationIds = (pluginState?.annotations ?? [])
              .filter(annotation => (
                !annotation.unresolved
                && typeof annotation.from === 'number'
                && typeof annotation.to === 'number'
                && (
                  (hitPos >= annotation.from && hitPos < annotation.to)
                  || (clicked && rangesOverlap(annotation, clicked))
                )
              ))
              .map(annotation => annotation.id)
            extension.options.onAnnotationClick({
              annotationId,
              annotationIds: annotationIds.includes(annotationId) ? annotationIds : [annotationId, ...annotationIds],
              event,
            })
            return true
          },
        },
      }),
    ]
  },
})

function buildPluginState(doc: ProseMirrorNode, annotations: TextAnnotation[]): AnnotationPluginState {
  const resolved = resolveAnnotations(doc, annotations)
  return {
    annotations: resolved,
    decorations: createDecorations(doc, resolved),
  }
}

function rangesOverlap(a: TextAnnotation, b: TextAnnotation): boolean {
  if (
    typeof a.from !== 'number'
    || typeof a.to !== 'number'
    || typeof b.from !== 'number'
    || typeof b.to !== 'number'
  ) {
    return false
  }
  return a.from < b.to && b.from < a.to
}

function mapAnnotation(annotation: TextAnnotation, mapping: Mapping): TextAnnotation {
  if (typeof annotation.from !== 'number' || typeof annotation.to !== 'number') {
    return annotation
  }

  const from = mapping.mapResult(annotation.from, 1)
  const to = mapping.mapResult(annotation.to, -1)
  if (from.deleted && to.deleted) {
    return markUnresolved(annotation)
  }

  const nextFrom = from.pos
  const nextTo = to.pos
  if (nextTo <= nextFrom) {
    return markUnresolved(annotation)
  }

  if (annotation.from === nextFrom && annotation.to === nextTo && annotation.unresolved === false) {
    return annotation
  }

  return {
    ...annotation,
    from: nextFrom,
    to: nextTo,
    unresolved: false,
  }
}

function resolveAnnotations(doc: ProseMirrorNode, annotations: TextAnnotation[]): TextAnnotation[] {
  return annotations.map((annotation) => resolveAnnotation(doc, annotation))
}

function resolveAnnotation(doc: ProseMirrorNode, annotation: TextAnnotation): TextAnnotation {
  const selectedText = annotation.selectedText ?? ''
  if (!selectedText) return markUnresolved(annotation)

  const validRange = validateRange(doc, annotation)
  if (validRange) {
    return markResolved(annotation, validRange, false)
  }

  const relocated = relocateByText(doc, annotation)
  if (relocated) {
    return markResolved(annotation, relocated, true)
  }

  return markUnresolved(annotation)
}

function markResolved(
  annotation: TextAnnotation,
  range: { from: number; to: number },
  relocated: boolean,
): TextAnnotation {
  const hasAnchorVersion = typeof annotation.anchorVersion === 'number'
  const changed = annotation.from !== range.from
    || annotation.to !== range.to
    || annotation.unresolved !== false
    || !hasAnchorVersion

  if (!changed) return annotation

  return {
    ...annotation,
    ...range,
    unresolved: false,
    anchorVersion: hasAnchorVersion ? annotation.anchorVersion : 1,
    lastResolvedAt: relocated ? Date.now() : annotation.lastResolvedAt,
  }
}

function markUnresolved(annotation: TextAnnotation): TextAnnotation {
  if (annotation.unresolved === true) return annotation
  return {
    ...annotation,
    unresolved: true,
    lastResolvedAt: annotation.lastResolvedAt,
  }
}

function validateRange(
  doc: ProseMirrorNode,
  annotation: TextAnnotation,
): { from: number; to: number } | null {
  const from = annotation.from
  const to = annotation.to
  if (
    typeof from !== 'number'
    || typeof to !== 'number'
    || from < 0
    || to <= from
    || to > doc.content.size
  ) {
    return null
  }

  const text = doc.textBetween(from, to, '')
  return text === annotation.selectedText ? { from, to } : null
}

function relocateByText(
  doc: ProseMirrorNode,
  annotation: TextAnnotation,
): { from: number; to: number } | null {
  const indexed = indexDocText(doc)
  const text = indexed.text
  const selected = annotation.selectedText
  const before = annotation.contextBefore ?? ''
  const after = annotation.contextAfter ?? ''
  const oldFrom = typeof annotation.from === 'number'
    ? docPosToTextOffset(indexed.segments, annotation.from) ?? 0
    : 0

  const candidates: Array<{ from: number; to: number; score: number }> = []
  const addMatches = (query: string, offset: number, score: number) => {
    if (!query) return
    let index = text.indexOf(query)
    while (index >= 0) {
      const from = index + offset
      const to = from + selected.length
      if (from >= 0 && text.slice(from, to) === selected) {
        candidates.push({ from, to, score: score - Math.abs(from - oldFrom) / 100000 })
      }
      index = text.indexOf(query, index + 1)
    }
  }

  addMatches(before + selected + after, before.length, 4)
  addMatches(before + selected, before.length, 3)
  addMatches(selected + after, 0, 2)
  addMatches(selected, 0, 1)

  candidates.sort((a, b) => b.score - a.score)
  const best = candidates[0]
  if (!best) return null

  const from = textOffsetToDocPos(indexed.segments, best.from, 1)
  const to = textOffsetToDocPos(indexed.segments, best.to, -1)
  if (from === null || to === null || to <= from) return null
  return { from, to }
}

function indexDocText(doc: ProseMirrorNode): IndexedDocText {
  let text = ''
  const segments: TextSegment[] = []

  doc.descendants((node, pos) => {
    if (!node.isText || !node.text) return true
    const textStart = text.length
    text += node.text
    segments.push({
      textStart,
      textEnd: text.length,
      from: pos,
      to: pos + node.text.length,
    })
    return true
  })

  return { text, segments }
}

function textOffsetToDocPos(
  segments: TextSegment[],
  offset: number,
  assoc: -1 | 1,
): number | null {
  if (!segments.length) return null

  for (const segment of segments) {
    const within = assoc > 0
      ? offset >= segment.textStart && offset < segment.textEnd
      : offset > segment.textStart && offset <= segment.textEnd
    if (within) {
      return segment.from + offset - segment.textStart
    }
  }

  if (offset === 0) return segments[0].from
  const last = segments[segments.length - 1]
  if (offset === last.textEnd) return last.to
  return null
}

function docPosToTextOffset(segments: TextSegment[], pos: number): number | null {
  for (const segment of segments) {
    if (pos >= segment.from && pos <= segment.to) {
      return segment.textStart + pos - segment.from
    }
  }
  return null
}

function createDecorations(doc: ProseMirrorNode, annotations: TextAnnotation[]): DecorationSet {
  const decorations: Decoration[] = []
  for (const annotation of annotations) {
    const from = annotation.from
    const to = annotation.to
    if (
      annotation.unresolved
      || typeof from !== 'number'
      || typeof to !== 'number'
      || from < 0
      || to <= from
      || to > doc.content.size
    ) {
      continue
    }

    decorations.push(Decoration.inline(from, to, {
      class: 'tu-tiptap-annotation',
      'data-tu-annotation-id': annotation.id,
      style: `background:${annotation.color || '#FFEB3B'};cursor:pointer;border-radius:2px;`,
    }))
  }
  return DecorationSet.create(doc, decorations)
}
