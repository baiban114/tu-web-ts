import type { Block, EmbeddedObject, PageContent } from '@/api/types'
import type { JSONContent } from '@tiptap/core'

// ─── Embed placeholder regex ───────────────────────────────────────────────
const EMBED_RE = /<!--tu:embed\s+id="([^"]+)"\s+type="([^"]+)"\s*-->/g

// ─── New public API ─────────────────────────────────────────────────────────

/**
 * Convert PageContent to a Tiptap/ProseMirror document.
 * - Markdown content is parsed into paragraph/heading/list/etc. nodes
 * - Embed placeholders (<!--tu:embed...-->) are replaced by the corresponding node view nodes
 */
export function pageContentToTipTap(pc: PageContent): JSONContent {
  const children: JSONContent[] = []
  const seenEmbedIds = new Set<string>()

  // Split content by embed placeholders
  let lastIndex = 0
  let match: RegExpExecArray | null

  // Reset regex state
  EMBED_RE.lastIndex = 0

  while ((match = EMBED_RE.exec(pc.content)) !== null) {
    // Emit rich text before this placeholder
    const textBefore = pc.content.slice(lastIndex, match.index)
    if (textBefore.trim()) {
      children.push(...parseMarkdown(textBefore))
    }

    // Emit embed node
    const embedId = match[1]
    const embedType = match[2]
    const embed = pc.embeds.find((e) => e.id === embedId)
    if (!seenEmbedIds.has(embedId)) {
      const embedNode = embedToTipTapNode(embed, embedId, embedType)
      if (embedNode) {
        children.push(embedNode)
        seenEmbedIds.add(embedId)
      }
    }

    lastIndex = match.index + match[0].length
  }

  // Emit remaining text after last placeholder
  const textAfter = pc.content.slice(lastIndex)
  if (textAfter.trim()) {
    children.push(...parseMarkdown(textAfter))
  }

  // Ensure doc has at least one node
  if (children.length === 0) {
    children.push(createEmptyParagraph())
  }

  return { type: 'doc', content: children }
}

/**
 * Convert a Tiptap/ProseMirror document back to PageContent.
 * - Node view nodes (x6Block, tableBlock, etc.) are extracted as EmbeddedObject[]
 *   and replaced with <!--tu:embed...--> placeholders in the markdown content
 * - Rich text nodes are serialized to markdown
 */
export function tipTapToPageContent(doc: JSONContent): Pick<PageContent, 'content' | 'embeds'> {
  const embeds: EmbeddedObject[] = []
  const markdownParts: string[] = []
  const seenEmbedIds = new Set<string>()

  if (!doc.content) return { content: '', embeds: [] }

  for (const node of doc.content) {
    if (isEmbedNode(node)) {
      const embed = tipTapNodeToEmbed(node)
      if (embed && !seenEmbedIds.has(embed.id)) {
        embeds.push(embed)
        markdownParts.push(`<!--tu:embed id="${embed.id}" type="${embed.type}"-->`)
        seenEmbedIds.add(embed.id)
      }
    } else {
      markdownParts.push(nodeToMarkdown(node))
    }
  }

  return {
    content: markdownParts.join('\n\n').replace(/\n{3,}/g, '\n\n').trim(),
    embeds,
  }
}

// ─── Backward-compatible wrappers (deprecated) ─────────────────────────────

/** @deprecated Use pageContentToTipTap instead */
export function blocksToTipTap(blocks: Block[]): JSONContent {
  const pageContent = legacyBlocksToPageContent(blocks)
  return pageContentToTipTap(pageContent)
}

/** @deprecated Use tipTapToPageContent instead */
export function tipTapToBlocks(json: JSONContent, _originalBlocks?: Block[]): Block[] {
  const { content, embeds } = tipTapToPageContent(json)
  return pageContentToLegacyBlocks(content, embeds)
}

// ─── Internal helpers ──────────────────────────────────────────────────────

function createEmptyParagraph(): JSONContent {
  return { type: 'paragraph' }
}

function isEmbedNode(node: JSONContent): boolean {
  return ['x6Block', 'tableBlock', 'multiTableBlock', 'timelineBlock', 'refBlock', 'spacerBlock', 'externalResourceBlock'].includes(node.type || '')
}

function getHeadingLevel(embed: EmbeddedObject | undefined): number {
  const ts = (embed?.metadata as any)?.tocSettings
  return ts?.titleLevel ?? 0
}

function embedToTipTapNode(embed: EmbeddedObject | undefined, embedId: string, embedType: string): JSONContent | null {
  if (embed) embedType = embed.type // use actual type from embed data

  switch (embedType) {
    case 'x6':
      return {
        type: 'x6Block',
        attrs: {
          blockId: embedId,
          title: embed?.title || '',
          headingLevel: getHeadingLevel(embed),
          width: embed?.width ?? null,
          height: embed?.height ?? null,
          graphData: embed?.graphData || { nodes: [], edges: [] },
          metadata: embed?.metadata || {},
        },
      }
    case 'table':
      return {
        type: 'tableBlock',
        attrs: {
          blockId: embedId,
          title: embed?.title || '',
          headingLevel: getHeadingLevel(embed),
          width: embed?.width ?? null,
          height: embed?.height ?? null,
          tableData: embed?.tableData || { headers: [], rows: [] },
          metadata: embed?.metadata || {},
        },
      }
    case 'multiTable':
      return {
        type: 'multiTableBlock',
        attrs: {
          blockId: embedId,
          title: embed?.title || '',
          headingLevel: getHeadingLevel(embed),
          width: embed?.width ?? null,
          height: embed?.height ?? null,
          multiTableData: embed?.multiTableData || { fields: [], records: [], views: [] },
          metadata: embed?.metadata || {},
        },
      }
    case 'timeline':
      return {
        type: 'timelineBlock',
        attrs: {
          blockId: embedId,
          title: embed?.title || '',
          headingLevel: getHeadingLevel(embed),
          width: embed?.width ?? null,
          height: embed?.height ?? null,
          timelineData: embed?.timelineData || [],
          metadata: embed?.metadata || {},
        },
      }
    case 'ref':
      return {
        type: 'refBlock',
        attrs: {
          blockId: embedId,
          title: embed?.title || '',
          headingLevel: getHeadingLevel(embed),
          refId: embed?.refId || '',
          refType: embed?.refType || 'block',
          width: embed?.width ?? null,
          height: embed?.height ?? null,
          metadata: embed?.metadata || {},
        },
      }
    case 'spacer':
      return {
        type: 'spacerBlock',
        attrs: {
          blockId: embedId,
          title: embed?.title || '',
          headingLevel: getHeadingLevel(embed),
          width: null,
          height: embed?.spacerHeight || 40,
          spacerHeight: embed?.spacerHeight || 40,
          metadata: embed?.metadata || {},
        },
      }
    case 'externalResource':
      return {
        type: 'externalResourceBlock',
        attrs: {
          blockId: embedId,
          title: embed?.title || '',
          headingLevel: getHeadingLevel(embed),
          width: embed?.width ?? null,
          height: embed?.height ?? null,
          externalResource: embed?.externalResource || {
            resourceItemId: '',
            resourceExcerptId: null,
            mode: 'resource',
            snapshot: { resourceTitle: '' },
          },
          metadata: embed?.metadata || {},
        },
      }
    default:
      return null
  }
}

function tipTapNodeToEmbed(node: JSONContent): EmbeddedObject | null {
  const blockId = node.attrs?.blockId
  if (!blockId) return null

  switch (node.type) {
    case 'x6Block':
      return {
        id: blockId,
        type: 'x6',
        title: node.attrs?.title || '',
        width: node.attrs?.width ?? undefined,
        height: node.attrs?.height ?? undefined,
        graphData: node.attrs?.graphData || { nodes: [], edges: [] },
        metadata: node.attrs?.metadata,
      }
    case 'timelineBlock':
      return {
        id: blockId,
        type: 'timeline',
        title: node.attrs?.title || '',
        width: node.attrs?.width ?? undefined,
        height: node.attrs?.height ?? undefined,
        timelineData: node.attrs?.timelineData || [],
        metadata: node.attrs?.metadata,
      }
    case 'refBlock':
      return {
        id: blockId,
        type: 'ref',
        title: node.attrs?.title || '',
        refId: node.attrs?.refId || '',
        refType: node.attrs?.refType || 'block',
        width: node.attrs?.width ?? undefined,
        height: node.attrs?.height ?? undefined,
        metadata: node.attrs?.metadata,
      }
    case 'tableBlock':
      return {
        id: blockId,
        type: 'table',
        title: node.attrs?.title || '',
        width: node.attrs?.width ?? undefined,
        height: node.attrs?.height ?? undefined,
        tableData: node.attrs?.tableData || { headers: [], rows: [] },
        metadata: node.attrs?.metadata,
      }
    case 'multiTableBlock':
      return {
        id: blockId,
        type: 'multiTable',
        title: node.attrs?.title || '',
        width: node.attrs?.width ?? undefined,
        height: node.attrs?.height ?? undefined,
        multiTableData: node.attrs?.multiTableData || { fields: [], records: [], views: [] },
        metadata: node.attrs?.metadata,
      }
    case 'spacerBlock':
      return {
        id: blockId,
        type: 'spacer',
        title: node.attrs?.title || '',
        spacerHeight: node.attrs?.height ?? node.attrs?.spacerHeight ?? 40,
        height: node.attrs?.height ?? node.attrs?.spacerHeight ?? 40,
        metadata: node.attrs?.metadata,
      }
    case 'externalResourceBlock':
      return {
        id: blockId,
        type: 'externalResource',
        title: node.attrs?.title || '',
        width: node.attrs?.width ?? undefined,
        height: node.attrs?.height ?? undefined,
        externalResource: node.attrs?.externalResource || {
          resourceItemId: '',
          resourceExcerptId: null,
          mode: 'resource',
          snapshot: { resourceTitle: '' },
        },
        metadata: node.attrs?.metadata,
      }
    default:
      return null
  }
}

// ─── Legacy conversion helpers (for backward-compat wrappers) ──────────────

function legacyBlocksToPageContent(blocks: Block[]): PageContent {
  const parts: string[] = []
  const embeds: EmbeddedObject[] = []
  const referencedEmbedIds = collectEmbedIdsFromBlocks(blocks)
  const seenEmbedIds = new Set<string>()

  for (const block of blocks) {
    if (block.type === 'richtext' || block.type === 'richText') {
      if (block.content) parts.push(block.content)
      continue
    }
    if (seenEmbedIds.has(block.id)) continue
    seenEmbedIds.add(block.id)

    const embed: EmbeddedObject = {
      id: block.id,
      type: block.type as EmbeddedObject['type'],
      title: block.title,
      graphData: block.graphData,
      tableData: block.tableData,
      multiTableData: block.multiTableData,
      timelineData: block.timelineData,
      refId: block.refId,
      refType: block.refType,
      externalResource: block.externalResource,
      spacerHeight: block.spacerHeight,
      width: block.width,
      height: block.height,
      metadata: block.metadata,
    }
    embeds.push(embed)
    if (!referencedEmbedIds.has(block.id)) {
      parts.push(`<!--tu:embed id="${block.id}" type="${block.type}"-->`)
    }
  }

  return {
    content: parts.join('\n\n').replace(/\n{3,}/g, '\n\n').trim(),
    embeds,
    annotations: [],
  }
}

function pageContentToLegacyBlocks(content: string, embeds: EmbeddedObject[]): Block[] {
  const blocks: Block[] = []
  const seenEmbedIds = new Set<string>()

  // Split content by embed placeholders
  let lastIndex = 0
  let match: RegExpExecArray | null
  EMBED_RE.lastIndex = 0

  while ((match = EMBED_RE.exec(content)) !== null) {
    const textBefore = content.slice(lastIndex, match.index)
    if (textBefore.trim()) {
      blocks.push({
        id: `richtext-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
        type: 'richtext',
        content: textBefore.trim(),
      })
    }

    const embedId = match[1]
    const embed = embeds.find((e) => e.id === embedId)
    if (embed && !seenEmbedIds.has(embedId)) {
      blocks.push({
        id: embed.id,
        type: embed.type,
        title: embed.title,
        graphData: embed.graphData,
        tableData: embed.tableData,
        multiTableData: embed.multiTableData,
        timelineData: embed.timelineData,
        refId: embed.refId,
        refType: embed.refType,
        externalResource: embed.externalResource,
        spacerHeight: embed.spacerHeight,
        width: embed.width,
        height: embed.height,
        metadata: embed.metadata,
      })
      seenEmbedIds.add(embedId)
    }

    lastIndex = match.index + match[0].length
  }

  const textAfter = content.slice(lastIndex)
  if (textAfter.trim()) {
    blocks.push({
      id: `richtext-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
      type: 'richtext',
      content: textAfter.trim(),
    })
  }

  return blocks
}

function collectEmbedIdsFromBlocks(blocks: Block[]): Set<string> {
  const ids = new Set<string>()
  for (const block of blocks) {
    if (block.type !== 'richtext' && block.type !== 'richText') continue
    for (const id of collectEmbedIdsFromContent(block.content || '')) {
      ids.add(id)
    }
  }
  return ids
}

function collectEmbedIdsFromContent(content: string): Set<string> {
  const ids = new Set<string>()
  EMBED_RE.lastIndex = 0
  let match: RegExpExecArray | null
  while ((match = EMBED_RE.exec(content)) !== null) {
    ids.add(match[1])
  }
  return ids
}

// ─── Markdown → ProseMirror nodes (adapted from old code, no longer needs blockId) ──

function parseMarkdown(markdown: string): JSONContent[] {
  if (!markdown.trim()) return []

  const paragraphs = markdown.split('\n\n')
  const nodes: JSONContent[] = []

  for (const para of paragraphs) {
    if (!para.trim()) {
      nodes.push({ type: 'paragraph' })
      continue
    }

    const innerLines = para.split('\n')
    let currentLines: string[] = []

    for (const line of innerLines) {
      const headingMatch = line.match(/^(#{1,6})\s+(.*)$/)
      if (headingMatch) {
        if (currentLines.length > 0) {
          nodes.push({
            type: 'paragraph',
            content: parseInlineMarkdown(currentLines.join('\n')),
          })
          currentLines = []
        }
        nodes.push({
          type: 'heading',
          attrs: { level: headingMatch[1].length },
          content: parseInlineMarkdown(headingMatch[2]),
        })
      } else if (line.startsWith('- [ ] ') || line.startsWith('- [x] ')) {
        if (currentLines.length > 0) {
          nodes.push({
            type: 'paragraph',
            content: parseInlineMarkdown(currentLines.join('\n')),
          })
          currentLines = []
        }
        const checked = line.startsWith('- [x]')
        const text = line.replace(/^- \[[ x]\] /, '')
        if (!nodes.find((n) => n.type === 'taskList')) {
          nodes.push({ type: 'taskList' })
        }
        const taskList = nodes.find((n) => n.type === 'taskList')!
        ;(taskList.content = taskList.content || []).push({
          type: 'taskItem',
          attrs: { checked },
          content: [{ type: 'paragraph', content: parseInlineMarkdown(text) }],
        })
      } else if (line.startsWith('- ') || line.startsWith('* ')) {
        if (currentLines.length > 0) {
          nodes.push({
            type: 'paragraph',
            content: parseInlineMarkdown(currentLines.join('\n')),
          })
          currentLines = []
        }
        if (!nodes.find((n) => n.type === 'bulletList')) {
          nodes.push({ type: 'bulletList' })
        }
        const list = nodes.find((n) => n.type === 'bulletList')!
        ;(list.content = list.content || []).push({
          type: 'listItem',
          content: [{ type: 'paragraph', content: parseInlineMarkdown(line.replace(/^[-*] /, '')) }],
        })
      } else if (/^\d+\.\s/.test(line)) {
        if (currentLines.length > 0) {
          nodes.push({
            type: 'paragraph',
            content: parseInlineMarkdown(currentLines.join('\n')),
          })
          currentLines = []
        }
        if (!nodes.find((n) => n.type === 'orderedList')) {
          nodes.push({ type: 'orderedList' })
        }
        const list = nodes.find((n) => n.type === 'orderedList')!
        ;(list.content = list.content || []).push({
          type: 'listItem',
          content: [{ type: 'paragraph', content: parseInlineMarkdown(line.replace(/^\d+\.\s/, '')) }],
        })
      } else if (line.startsWith('> ')) {
        if (currentLines.length > 0) {
          nodes.push({
            type: 'paragraph',
            content: parseInlineMarkdown(currentLines.join('\n')),
          })
          currentLines = []
        }
        nodes.push({
          type: 'blockquote',
          content: [{ type: 'paragraph', content: parseInlineMarkdown(line.slice(2)) }],
        })
      } else if (line.startsWith('```')) {
        currentLines.push(line)
      } else if (line.startsWith('---')) {
        if (currentLines.length > 0) {
          nodes.push({
            type: 'paragraph',
            content: parseInlineMarkdown(currentLines.join('\n')),
          })
          currentLines = []
        }
        nodes.push({ type: 'horizontalRule' })
      } else {
        currentLines.push(line)
      }
    }

    if (currentLines.length > 0) {
      const text = currentLines.join('\n')
      nodes.push({
        type: 'paragraph',
        content: text ? parseInlineMarkdown(text) : [],
      })
    }
  }

  return nodes.length > 0 ? nodes : [{ type: 'paragraph' }]
}

// ─── Inline markdown parsing (same as before, no changes needed) ───────────

export function parseInlineMarkdown(text: string): JSONContent[] {
  const parts: JSONContent[] = []
  let remaining = text

  while (remaining.length > 0) {
    const boldMatch = remaining.match(/^\*\*(.+?)\*\*/)
    if (boldMatch) {
      parts.push({ type: 'text', text: boldMatch[1], marks: [{ type: 'bold' }] })
      remaining = remaining.slice(boldMatch[0].length)
      continue
    }

    const italicMatch = remaining.match(/^\*(.+?)\*/)
    if (italicMatch) {
      parts.push({ type: 'text', text: italicMatch[1], marks: [{ type: 'italic' }] })
      remaining = remaining.slice(italicMatch[0].length)
      continue
    }

    const codeMatch = remaining.match(/^`(.+?)`/)
    if (codeMatch) {
      parts.push({ type: 'text', text: codeMatch[1], marks: [{ type: 'code' }] })
      remaining = remaining.slice(codeMatch[0].length)
      continue
    }

    const linkMatch = remaining.match(/^\[(.+?)\]\((.+?)\)/)
    if (linkMatch) {
      parts.push({
        type: 'text',
        text: linkMatch[1],
        marks: [{ type: 'link', attrs: { href: linkMatch[2] } }],
      })
      remaining = remaining.slice(linkMatch[0].length)
      continue
    }

    const imgMatch = remaining.match(/^!\[(.+?)\]\((.+?)\)/)
    if (imgMatch) {
      parts.push({ type: 'image', attrs: { src: imgMatch[2], alt: imgMatch[1] } })
      remaining = remaining.slice(imgMatch[0].length)
      continue
    }

    const nlIndex = remaining.indexOf('\n')
    if (nlIndex >= 0) {
      const segment = remaining.slice(0, nlIndex)
      if (segment) parts.push({ type: 'hardBreak' })
      parts.push({ type: 'text', text: segment })
      remaining = remaining.slice(nlIndex + 1)
    } else {
      if (remaining) parts.push({ type: 'text', text: remaining })
      remaining = ''
    }
  }

  return parts
}

// ─── ProseMirror nodes → Markdown (same structure as before) ──────────────

/** @deprecated internal helper kept for backward compat */
export function tipTapNodesToMarkdown(nodes: JSONContent[]): string {
  return nodes.map((node) => nodeToMarkdown(node)).join('\n\n')
}

function nodeToMarkdown(node: JSONContent): string {
  switch (node.type) {
    case 'heading':
      return '#'.repeat(node.attrs?.level || 1) + ' ' + contentToMarkdown(node.content || [])
    case 'paragraph':
      return contentToMarkdown(node.content || [])
    case 'bulletList':
      return (node.content || []).map((item) => '- ' + contentToMarkdown(item.content || [])).join('\n')
    case 'orderedList':
      return (node.content || []).map((item, i) => (i + 1) + '. ' + contentToMarkdown(item.content || [])).join('\n')
    case 'blockquote':
      return (node.content || []).map((c) => '> ' + contentToMarkdown(c.content || [])).join('\n')
    case 'horizontalRule':
      return '---'
    case 'image':
      return '![' + (node.attrs?.alt || '') + '](' + (node.attrs?.src || '') + ')'
    case 'taskList':
      return (node.content || []).map((item) => (item.attrs?.checked ? '- [x] ' : '- [ ] ') + contentToMarkdown(item.content || [])).join('\n')
    default:
      return contentToMarkdown(node.content || [])
  }
}

function contentToMarkdown(content: JSONContent[]): string {
  return content.map((c) => {
    if (c.type === 'text') {
      let text = c.text || ''
      if (c.marks) {
        for (const mark of c.marks) {
          if (mark.type === 'bold') text = '**' + text + '**'
          else if (mark.type === 'italic') text = '*' + text + '*'
          else if (mark.type === 'code') text = '`' + text + '`'
          else if (mark.type === 'link') text = '[' + text + '](' + (mark.attrs?.href || '') + ')'
          else if (mark.type === 'underline') text = '<u>' + text + '</u>'
          else if (mark.type === 'strike') text = '~~' + text + '~~'
        }
      }
      return text
    }
    if (c.type === 'hardBreak') return ''
    if (c.type === 'paragraph') return contentToMarkdown(c.content || [])
    return ''
  }).join('')
}
