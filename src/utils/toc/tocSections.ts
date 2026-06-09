import type { Node as ProseMirrorNode } from '@tiptap/pm/model'
import type { FlatTocEntry } from '@/utils/toc/headings'

export interface TocSectionContentRange {
  from: number
  to: number
}

export interface TocFoldSection {
  entry: FlatTocEntry
  entryIndex: number
  contentRange: TocSectionContentRange | null
  collapseEmbedBody: boolean
}

export function getTocSectionBoundaryPos(
  flat: FlatTocEntry[],
  entryIndex: number,
  doc: ProseMirrorNode,
): number {
  const current = flat[entryIndex]
  if (!current) return doc.content.size

  for (let j = entryIndex + 1; j < flat.length; j++) {
    if (flat[j].level <= current.level) {
      return flat[j].pos
    }
  }
  return doc.content.size
}

function nextSameOrHigherEntryIndex(flat: FlatTocEntry[], entryIndex: number): number {
  const current = flat[entryIndex]
  for (let j = entryIndex + 1; j < flat.length; j++) {
    if (flat[j].level <= current.level) return j
  }
  return -1
}

function getLocalHeadingContentRange(
  entry: FlatTocEntry,
  boundaryPos: number,
  doc: ProseMirrorNode,
): TocSectionContentRange | null {
  const node = doc.nodeAt(entry.pos)
  if (!node || node.type.name !== 'heading') return null
  const from = entry.pos + node.nodeSize
  if (from >= boundaryPos) return null
  return { from, to: boundaryPos }
}

function hasRefChildEntries(flat: FlatTocEntry[], entryIndex: number): boolean {
  const endIndex = nextSameOrHigherEntryIndex(flat, entryIndex)
  const sliceEnd = endIndex === -1 ? flat.length : endIndex
  const entry = flat[entryIndex]
  return flat.slice(entryIndex + 1, sliceEnd).some((item) => (
    item.pos === entry.pos && item.sourceType === 'ref-child'
  ))
}

export function getTocEntrySectionContentRange(
  flat: FlatTocEntry[],
  entryIndex: number,
  doc: ProseMirrorNode,
): { contentRange: TocSectionContentRange | null; collapseEmbedBody: boolean } {
  const entry = flat[entryIndex]
  if (!entry) return { contentRange: null, collapseEmbedBody: false }

  const boundaryPos = getTocSectionBoundaryPos(flat, entryIndex, doc)

  if (entry.sourceType === 'local') {
    return {
      contentRange: getLocalHeadingContentRange(entry, boundaryPos, doc),
      collapseEmbedBody: false,
    }
  }

  if (entry.sourceType === 'ref-group') {
    const node = doc.nodeAt(entry.pos)
    if (!node) return { contentRange: null, collapseEmbedBody: false }

    const followingRange = entry.pos + node.nodeSize < boundaryPos
      ? { from: entry.pos + node.nodeSize, to: boundaryPos }
      : null
    const hasChildren = hasRefChildEntries(flat, entryIndex)

    if (!followingRange && !hasChildren) {
      return { contentRange: null, collapseEmbedBody: false }
    }

    return {
      contentRange: followingRange,
      collapseEmbedBody: hasChildren || entry.pos + node.nodeSize > entry.pos,
    }
  }

  return { contentRange: null, collapseEmbedBody: false }
}

export function iterTocFoldSections(flat: FlatTocEntry[], doc: ProseMirrorNode): TocFoldSection[] {
  const sections: TocFoldSection[] = []

  for (let index = 0; index < flat.length; index++) {
    const entry = flat[index]
    if (entry.sourceType === 'ref-child') continue

    const { contentRange, collapseEmbedBody } = getTocEntrySectionContentRange(flat, index, doc)
    const hasChildren = entry.sourceType === 'ref-group' && hasRefChildEntries(flat, index)

    if (!contentRange && !hasChildren && !collapseEmbedBody) continue
    if (contentRange && contentRange.from >= contentRange.to && !hasChildren) continue

    sections.push({
      entry,
      entryIndex: index,
      contentRange,
      collapseEmbedBody: Boolean(collapseEmbedBody || hasChildren),
    })
  }

  for (let index = 0; index < flat.length; index++) {
    const entry = flat[index]
    if (entry.sourceType !== 'ref-child') continue

    const endIndex = nextSameOrHigherEntryIndex(flat, index)
    const hasFollowingChild = (endIndex === -1 ? flat.slice(index + 1) : flat.slice(index + 1, endIndex))
      .some((item) => item.pos === entry.pos && item.sourceType === 'ref-child')

    if (!hasFollowingChild) continue

    sections.push({
      entry,
      entryIndex: index,
      contentRange: null,
      collapseEmbedBody: false,
    })
  }

  return sections
}

export function isRangeOverlappingSection(
  pos: number,
  nodeSize: number,
  section: TocSectionContentRange,
): boolean {
  return pos >= section.from && pos < section.to
}

export interface CollapsedSectionDecoration {
  contentRange: TocSectionContentRange | null
  collapseEmbedBody: boolean
  embedPos?: number
}

export function getCollapsedSectionDecorations(
  flat: FlatTocEntry[],
  doc: ProseMirrorNode,
  isCollapsed: (entry: FlatTocEntry) => boolean,
): CollapsedSectionDecoration[] {
  const decorations: CollapsedSectionDecoration[] = []

  for (let index = 0; index < flat.length; index++) {
    const entry = flat[index]
    if (!isCollapsed(entry)) continue
    if (entry.sourceType === 'ref-child') continue

    const { contentRange, collapseEmbedBody } = getTocEntrySectionContentRange(flat, index, doc)
    decorations.push({
      contentRange,
      collapseEmbedBody,
      embedPos: entry.sourceType === 'ref-group' ? entry.pos : undefined,
    })
  }

  return decorations
}

export function isEntryCollapsed(entry: FlatTocEntry, doc: ProseMirrorNode): boolean {
  if (entry.sourceType === 'local' || entry.sourceType === 'ref-group') {
    const node = doc.nodeAt(entry.pos)
    return Boolean(node?.attrs?.sectionCollapsed)
  }

  if (entry.sourceType === 'ref-child') {
    const node = doc.nodeAt(entry.pos)
    const metadata = (node?.attrs?.metadata || {}) as { sectionCollapsedChildren?: Record<string, boolean> }
    return Boolean(metadata.sectionCollapsedChildren?.[entry.id])
  }

  return false
}
