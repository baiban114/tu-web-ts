import type { Block, ExternalResourceEmbedData } from '@/api/types'
import type { Node as ProseMirrorNode } from '@tiptap/pm/model'
import {
  applyRefContentHeadingShift,
  computeRefWrapperLevel,
  extractRichTextHeadingsFromBlocks,
  findParentHeadingLevel,
  type FlatTocEntry,
} from '@/utils/toc/headings'

export interface TocCollectContext {
  blocks: Block[]
  getPageBlocks: (pageId: string) => Block[]
  getBlock: (id: string) => Block | undefined
  getBlockMeta: (id: string) => { pageTitle?: string } | undefined
  getPageTitle: (pageId: string) => string
}

function appendEmbedTocEntries(
  flat: FlatTocEntry[],
  options: {
    blockId: string
    pos: number
    wrapperLevel: number
    groupTitle: string
    contentBlocks: Block[]
    contentParentLevel: number
    refId?: string
    includeGroup: boolean
  },
) {
  const {
    blockId,
    pos,
    wrapperLevel,
    groupTitle,
    contentBlocks,
    contentParentLevel,
    refId,
    includeGroup,
  } = options

  if (includeGroup && groupTitle && wrapperLevel > 0) {
    flat.push({
      id: `ref-group-${blockId}`,
      blockId,
      level: wrapperLevel,
      text: groupTitle,
      pos,
      sortIndex: 0,
      sourceType: 'ref-group',
      refId,
    })
  }

  const shiftedBlocks = applyRefContentHeadingShift(contentBlocks, contentParentLevel)
  const contentHeadings = extractRichTextHeadingsFromBlocks(shiftedBlocks)
  contentHeadings.forEach((heading, index) => {
    flat.push({
      id: `ref-child-${blockId}-${index}`,
      blockId,
      level: heading.level,
      text: heading.text,
      pos,
      sortIndex: index + 1,
      sourceType: 'ref-child',
      refId,
      targetText: heading.text,
    })
  })
}

/** Collect flat TOC entries from the editor document (same rules as TuEditorPage tocItems). */
export function collectFlatTocEntries(doc: ProseMirrorNode, ctx: TocCollectContext): FlatTocEntry[] {
  const blockTitleMap = new Map<string, string>()
  const refMetaMap = new Map<string, { refId: string; refType: string }>()
  for (const block of ctx.blocks) {
    if (!block.id) continue
    if (block.title) blockTitleMap.set(block.id, block.title)
    if (block.type === 'ref' && block.refId) {
      refMetaMap.set(block.id, { refId: block.refId, refType: block.refType ?? 'block' })
    }
  }

  const flat: FlatTocEntry[] = []

  doc.descendants((node, pos) => {
    const typeName = node.type.name

    if (typeName === 'heading') {
      const text = node.textContent.trim()
      if (text) {
        flat.push({
          id: `h-${pos}`,
          blockId: node.attrs?.blockId || `heading-${pos}`,
          level: node.attrs?.level || 1,
          text,
          pos,
          sortIndex: 0,
          sourceType: 'local',
          sourceBinding: node.attrs?.sourceBinding || undefined,
        })
      }
      return true
    }

    if (typeName === 'refBlock') {
      const blockId: string = node.attrs?.blockId || ''
      const refId: string = node.attrs?.refId || refMetaMap.get(blockId)?.refId || ''
      const refType: string = node.attrs?.refType || refMetaMap.get(blockId)?.refType || 'block'
      if (!blockId || !refId) return true

      let refBlocks: Block[] = []
      if (refType === 'page') {
        refBlocks = ctx.getPageBlocks(refId)
      } else {
        const refBlock = ctx.getBlock(refId)
        if (refBlock) refBlocks = [refBlock]
      }

      const tocSettings = (node.attrs?.metadata as Record<string, unknown> | undefined)?.tocSettings as
        | { hideTitle?: boolean }
        | undefined
      const hideTitle = Boolean(tocSettings?.hideTitle)
      const wrapperLevel = hideTitle ? 0 : computeRefWrapperLevel(node.attrs, doc, pos)
      const contentParentLevel = hideTitle
        ? findParentHeadingLevel(doc, pos)
        : wrapperLevel > 0
          ? wrapperLevel
          : findParentHeadingLevel(doc, pos)

      let groupTitle = ''
      if (!hideTitle) {
        if (refType === 'page') {
          groupTitle = ctx.getPageTitle(refId) || refId
        } else {
          const meta = ctx.getBlockMeta(refId)
          groupTitle = meta?.pageTitle || blockTitleMap.get(blockId) || node.attrs?.title || '引用'
        }
      }

      appendEmbedTocEntries(flat, {
        blockId,
        pos,
        wrapperLevel,
        groupTitle,
        contentBlocks: refBlocks,
        contentParentLevel,
        refId,
        includeGroup: !hideTitle,
      })
      return true
    }

    if (typeName === 'externalResourceBlock') {
      const blockId: string = node.attrs?.blockId || ''
      if (!blockId) return true

      const embedData = node.attrs?.externalResource as ExternalResourceEmbedData | undefined
      const snapshot = embedData?.snapshot
      const isExcerpt = embedData?.mode === 'excerpt' || Boolean(embedData?.resourceExcerptId)
      const excerptText = snapshot?.excerptText?.trim() || ''
      const attrsHeadingLevel = Number(
        node.attrs?.headingLevel
        || (node.attrs?.metadata as { tocSettings?: { titleLevel?: number } } | undefined)?.tocSettings?.titleLevel
        || 0,
      )
      const wrapperLevel = attrsHeadingLevel > 0 ? attrsHeadingLevel : 0
      const contentParentLevel = attrsHeadingLevel > 0
        ? attrsHeadingLevel
        : findParentHeadingLevel(doc, pos)
      const groupTitle = String(
        node.attrs?.title || (isExcerpt ? snapshot?.excerptTitle : snapshot?.resourceTitle) || '',
      )
      const contentBlocks: Block[] = excerptText
        ? [{ id: blockId, type: 'richtext', content: excerptText }]
        : []

      appendEmbedTocEntries(flat, {
        blockId,
        pos,
        wrapperLevel,
        groupTitle,
        contentBlocks,
        contentParentLevel,
        includeGroup: attrsHeadingLevel > 0,
      })
      return true
    }

    return true
  })

  return flat.sort((a, b) => a.pos - b.pos || a.sortIndex - b.sortIndex)
}

/** Heading-only fallback when TOC context is unavailable (nested editors). */
export function collectFlatTocEntriesFromHeadingsOnly(doc: ProseMirrorNode): FlatTocEntry[] {
  const flat: FlatTocEntry[] = []
  doc.descendants((node, pos) => {
    if (node.type.name !== 'heading') return true
    const text = node.textContent.trim()
    if (!text) return true
    flat.push({
      id: `h-${pos}`,
      blockId: node.attrs?.blockId || `heading-${pos}`,
      level: node.attrs?.level || 1,
      text,
      pos,
      sortIndex: 0,
      sourceType: 'local',
      sourceBinding: node.attrs?.sourceBinding || undefined,
    })
    return true
  })
  return flat.sort((a, b) => a.pos - b.pos || a.sortIndex - b.sortIndex)
}
