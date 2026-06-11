import type { Block } from '@/api/types'
import {
  applyRefContentHeadingShift,
  extractRichTextHeadingsFromBlocks,
  type FlatTocEntry,
  type TocTreeItem,
} from '@/utils/toc/headings'
import { getRefTocSectionEntryIds, isRefTocDirectoryEntry } from '@/utils/toc/tocSections'

export interface MindmapRefTocContext {
  getPageBlocks: (pageId: string) => Block[]
  getBlock: (id: string) => Block | undefined
  getPageTitle?: (pageId: string) => string
  getBlockMeta?: (id: string) => { pageTitle?: string } | undefined
}

function buildRefTocEntryId(refNodeId: string, headingBlockId: string, text: string): string {
  return `ref-child-${refNodeId}-${headingBlockId}-${text}`
}

function buildRefDocBlockEntryId(refNodeId: string, blockId: string): string {
  return `ref-doc-${refNodeId}-${blockId}`
}

function getBlockPreviewLabel(block: Block): string {
  if (block.title?.trim()) return block.title.trim()
  if (block.type === 'x6') return '画板'
  if (block.type === 'table') return '表格'
  if (block.type === 'line') return '时间轴'
  if (block.type === 'externalResource') {
    return block.externalResource?.snapshot?.excerptTitle
      || block.externalResource?.snapshot?.resourceTitle
      || '外部资源'
  }
  if (block.type === 'richtext' || block.type === 'richText') {
    const plain = (block.content ?? '')
      .replace(/<!--[\s\S]*?-->/g, '')
      .replace(/[#*`>\-_\[\]]/g, '')
      .trim()
    if (plain) return plain.length > 40 ? `${plain.slice(0, 40)}…` : plain
  }
  return block.type
}

/**
 * Build flat TOC for a mindmap ref node — mirrors collectFlatTocEntries refBlock rules
 * (without ProseMirror). Mindmap ref node acts as the ref wrapper; includeGroup=false.
 */
export function buildMindmapRefBlockFlatToc(
  refNodeId: string,
  refBlockId: string,
  refType: 'block' | 'page',
  ctx: MindmapRefTocContext,
): FlatTocEntry[] {
  let refBlocks: Block[] = []
  if (refType === 'page') {
    refBlocks = ctx.getPageBlocks(refBlockId)
  } else {
    const refBlock = ctx.getBlock(refBlockId)
    if (refBlock) refBlocks = [refBlock]
  }

  const contentParentLevel = 1
  const shiftedBlocks = applyRefContentHeadingShift(refBlocks, contentParentLevel)
  const contentHeadings = extractRichTextHeadingsFromBlocks(shiftedBlocks)
  const flat: FlatTocEntry[] = []

  contentHeadings.forEach((heading, index) => {
    flat.push({
      id: buildRefTocEntryId(refNodeId, heading.blockId, heading.text),
      blockId: refNodeId,
      level: heading.level,
      text: heading.text,
      pos: 0,
      sortIndex: index + 1,
      sourceType: 'ref-child',
      refId: refBlockId,
      targetText: heading.text,
    })
  })

  if (flat.length === 0 && refType === 'page' && refBlocks.length > 0) {
    refBlocks.forEach((block, index) => {
      flat.push({
        id: buildRefDocBlockEntryId(refNodeId, block.id),
        blockId: refNodeId,
        level: 2,
        text: getBlockPreviewLabel(block),
        pos: 0,
        sortIndex: index + 1,
        sourceType: 'ref-doc-block',
        refId: refBlockId,
      })
    })
  }

  return flat
}

export function getMindmapRefBlockFlatToc(
  refNode: { id: string; getData: () => Record<string, any> | undefined },
  ctx: MindmapRefTocContext,
): FlatTocEntry[] {
  const data = refNode.getData() ?? {}
  const refBlockId = typeof data.refBlockId === 'string' ? data.refBlockId : ''
  const refType: 'block' | 'page' = data.refType === 'page' ? 'page' : 'block'
  if (!refBlockId) return []
  return buildMindmapRefBlockFlatToc(refNode.id, refBlockId, refType, ctx)
}

export function refBlockHasExpandableStructure(
  refNodeId: string,
  refBlockId: string,
  refType: 'block' | 'page',
  ctx: MindmapRefTocContext,
): boolean {
  if (!refBlockId) return false
  if (buildMindmapRefBlockFlatToc(refNodeId, refBlockId, refType, ctx).length > 0) {
    return true
  }
  if (refType === 'page') return true
  return Boolean(ctx.getBlock(refBlockId))
}

export function refTocEntryHasExpandableDescendants(flat: FlatTocEntry[], entryId: string): boolean {
  return getRefTocSectionEntryIds(flat, entryId).length > 1
}

export function findTocTreeEntry(tree: TocTreeItem[], entryId: string): TocTreeItem | null {
  for (const item of tree) {
    if (item.id === entryId) return item
    if (item.children?.length) {
      const nested = findTocTreeEntry(item.children, entryId)
      if (nested) return nested
    }
  }
  return null
}

export function setRefTocSectionCollapsed(
  collapsedMap: Record<string, boolean>,
  flat: FlatTocEntry[],
  entryId: string,
  collapsed: boolean,
) {
  getRefTocSectionEntryIds(flat, entryId).forEach((id) => {
    collapsedMap[id] = collapsed
  })
}

export function isRefTocEntryDirectoryLevel(entry: FlatTocEntry): boolean {
  return isRefTocDirectoryEntry(entry)
}

export { getRefTocSectionEntryIds }
