import type { Block } from '@/api/types'
import type { JSONContent } from '@tiptap/core'

let idCounter = 0
function generateId(): string {
  return 'tipTap-block-' + Date.now() + '-' + (++idCounter)
}

function createEmptyParagraph(blockId?: string): JSONContent {
  return {
    type: 'paragraph',
    attrs: blockId ? { blockId } : undefined,
  }
}

function createCellParagraph(blockId: string | undefined, text: string): JSONContent {
  const attrs = blockId ? { blockId } : undefined
  if (!text) return { type: 'paragraph', attrs }
  return {
    type: 'paragraph',
    attrs,
    content: [{ type: 'text', text }],
  }
}

/** Convert a block's tableData into a proper tiptap table JSON structure.
 * Important: cell text must be rendered into the paragraphs. If cells stay
 * empty here, any external re-render via setContent (e.g. annotation remap,
 * page reload) replaces the live doc with an emptier one and ProseMirror's
 * selection mapping clamps the caret to the doc end. */
function tableDataToTipTapTable(
  blockId: string,
  tableData: NonNullable<Block['tableData']>,
): JSONContent {
  const { headers = [], rows = [] } = tableData
  const tableContent: JSONContent[] = []

  if (headers.length > 0) {
    const headerCells = headers.map((h) => ({
      type: 'tableHeader' as const,
      content: [createCellParagraph(blockId, h ?? '')],
    }))
    tableContent.push({ type: 'tableRow', content: headerCells })
  }

  for (const row of rows) {
    const cells = row.map((cell) => ({
      type: 'tableCell' as const,
      content: [createCellParagraph(blockId, cell ?? '')],
    }))
    tableContent.push({ type: 'tableRow', content: cells })
  }

  return {
    type: 'table',
    attrs: { blockId, tableData: JSON.stringify(tableData) },
    content: tableContent,
  }
}

export function blocksToTipTap(blocks: Block[]): JSONContent {
  const children: JSONContent[] = []

  for (const block of blocks) {
    if (isRichTextBlock(block)) {
      const nodes = markdownToTipTapNodes(block.content || '', block.id)
      children.push(...nodes)
    } else if (block.type === 'x6') {
      children.push({
        type: 'x6Block',
        attrs: {
          blockId: block.id,
          title: block.title || '',
          width: block.width ?? null,
          height: block.height ?? null,
          graphData: block.graphData || { nodes: [], edges: [] },
          metadata: block.metadata || {},
        },
      })
    } else if (block.type === 'table') {
      // Convert to proper tiptap table node structure
      children.push(tableDataToTipTapTable(block.id, block.tableData || { headers: [], rows: [] }))
    } else if (block.type === 'line') {
      children.push({
        type: 'timelineBlock',
        attrs: {
          blockId: block.id,
          title: block.title || '',
          width: block.width ?? null,
          height: block.height ?? null,
          timelineData: block.timelineData || [],
        },
      })
    } else if (block.type === 'ref') {
      children.push({
        type: 'refBlock',
        attrs: {
          blockId: block.id,
          refId: block.refId || '',
          refType: block.refType || 'block',
          width: block.width ?? null,
          height: block.height ?? null,
        },
      })
    } else if (block.type === 'spacer') {
      children.push({
        type: 'spacerBlock',
        attrs: {
          blockId: block.id,
          width: undefined,
          height: block.spacerHeight || 40,
          spacerHeight: block.spacerHeight || 40,
        },
      })
    } else if (block.type === 'container' && block.children) {
      // Flatten container children into top-level doc (no containerBlock extension)
      children.push(...blocksToTipTap(block.children).content || [])
    }
  }

  // Ensure doc has at least one block so it's not empty
  if (children.length === 0) {
    children.push(createEmptyParagraph())
  }

  return { type: 'doc', content: children }
}

export function tipTapToBlocks(json: JSONContent, originalBlocks: Block[]): Block[] {
  const blocks: Block[] = []
  if (!json.content) return blocks

  // Build a map of original blocks keyed by id for fast lookup
  const originalBlockMap = new Map<string, Block>()
  const walk = (list: Block[]) => {
    for (const b of list) {
      originalBlockMap.set(b.id, b)
      if (b.children) walk(b.children)
    }
  }
  walk(originalBlocks)

  // Track the index of richtext blocks we've emitted, so each richtext section
  // keeps the next original richtext block id without splitting normal editor
  // paragraphs into separate blocks.
  const originalRichTextBlocks = originalBlocks.filter((b) => isRichTextBlock(b))
  let richTextEmittedCount = 0

  // Tiptap's default table schema does not declare our custom `blockId` attr,
  // so it gets stripped from node.attrs. Recover the original table block id by
  // matching tables in document order against the original block list.
  const originalTableBlocks = originalBlocks.filter((b) => b.type === 'table')
  let tableEmittedCount = 0

  const richTextNodes: JSONContent[] = []

  const flushRichText = () => {
    if (richTextNodes.length > 0) {
      const existing = originalRichTextBlocks[richTextEmittedCount]
      const id = existing?.id || generateId()
      richTextEmittedCount++
      blocks.push({
        id,
        type: 'richtext',
        content: tipTapNodesToMarkdown(richTextNodes),
        metadata: existing?.metadata,
      })
      richTextNodes.length = 0
    }
  }

  for (const node of json.content) {
    if (isTipTapRichTextNode(node)) {
      richTextNodes.push(node)
    } else if (node.type === 'table') {
      flushRichText()
      const existingTable = originalTableBlocks[tableEmittedCount]
      tableEmittedCount += 1
      const converted = convertTableNode(node, originalBlockMap, existingTable)
      if (converted) blocks.push(converted)
    } else {
      flushRichText()
      const converted = convertNonRichTextNode(node, originalBlockMap)
      if (converted) blocks.push(converted)
    }
  }

  flushRichText()
  return blocks
}

function isRichTextBlock(block: Block): boolean {
  return block.type === 'richtext' || block.type === 'richText'
}

function isTipTapRichTextNode(node: JSONContent): boolean {
  return ['heading', 'paragraph', 'bulletList', 'orderedList', 'blockquote', 'horizontalRule', 'taskList', 'image'].includes(node.type || '')
}

/** Convert a tiptap `table` node back to a Block with type 'table'.
 * Always rebuilds tableData from the live cell content — node.attrs.tableData
 * is set at conversion time but Tiptap drops it because the default Table
 * schema does not declare the attribute, so trusting it would echo the initial
 * (stale) values back and lose every edit. */
function convertTableNode(
  node: JSONContent,
  originalBlockMap: Map<string, Block>,
  existingTableByOrder?: Block,
): Block | null {
  const blockIdAttr = node.attrs?.blockId
  const existingBlock = (blockIdAttr ? originalBlockMap.get(blockIdAttr) : undefined)
    ?? existingTableByOrder

  const headers: string[] = []
  const rows: string[][] = []
  const content = node.content || []
  for (let ri = 0; ri < content.length; ri += 1) {
    const row = content[ri]
    const cells = row.content || []
    if (ri === 0 && cells.length > 0 && cells.every((c) => c.type === 'tableHeader')) {
      for (const cell of cells) {
        headers.push(extractTextContent(cell))
      }
    } else {
      const rowData: string[] = []
      for (const cell of cells) {
        rowData.push(extractTextContent(cell))
      }
      rows.push(rowData)
    }
  }

  return {
    id: blockIdAttr || existingBlock?.id || generateId(),
    type: 'table',
    title: existingBlock?.title,
    tableData: { headers, rows },
  }
}

function extractTextContent(node: JSONContent): string {
  if (node.text) return node.text
  if (node.content) {
    return node.content.map((c) => extractTextContent(c)).join(' ')
  }
  return ''
}

function convertNonRichTextNode(node: JSONContent, originalBlockMap: Map<string, Block>): Block | null {
  const blockId = node.attrs?.blockId
  const existingBlock = blockId ? originalBlockMap.get(blockId) : undefined

  switch (node.type) {
    case 'x6Block':
      return {
        id: blockId || existingBlock?.id || generateId(),
        type: 'x6',
        title: node.attrs?.title || existingBlock?.title,
        width: node.attrs?.width ?? existingBlock?.width,
        height: node.attrs?.height ?? existingBlock?.height,
        graphData: node.attrs?.graphData || existingBlock?.graphData,
        metadata: node.attrs?.metadata || existingBlock?.metadata,
      }
    case 'timelineBlock':
      return {
        id: blockId || existingBlock?.id || generateId(),
        type: 'line',
        title: node.attrs?.title || existingBlock?.title,
        width: node.attrs?.width ?? existingBlock?.width,
        height: node.attrs?.height ?? existingBlock?.height,
        timelineData: node.attrs?.timelineData || existingBlock?.timelineData,
      }
    case 'refBlock':
      return {
        id: blockId || existingBlock?.id || generateId(),
        type: 'ref',
        refId: node.attrs?.refId || existingBlock?.refId,
        refType: node.attrs?.refType || existingBlock?.refType,
        width: node.attrs?.width ?? existingBlock?.width,
        height: node.attrs?.height ?? existingBlock?.height,
      }
    case 'spacerBlock':
      return {
        id: blockId || existingBlock?.id || generateId(),
        type: 'spacer',
        spacerHeight: node.attrs?.height ?? node.attrs?.spacerHeight ?? existingBlock?.spacerHeight ?? 40,
        width: undefined,
        height: node.attrs?.height ?? node.attrs?.spacerHeight ?? existingBlock?.spacerHeight ?? 40,
      }
    default:
      return null
  }
}

function markdownToTipTapNodes(markdown: string, blockId: string): JSONContent[] {
  if (!markdown.trim()) {
    return [{
      type: 'paragraph',
      attrs: { blockId },
    }]
  }

  // Split by \n\n to get paragraph blocks — this correctly preserves empty paragraphs
  // (split by \n alone doubles empty segments due to \n\n separators)
  const paragraphs = markdown.split('\n\n')
  const nodes: JSONContent[] = []

  for (const para of paragraphs) {
    if (!para.trim()) {
      nodes.push({ type: 'paragraph', attrs: { blockId } })
      continue
    }

    // Each paragraph is a single line in our serialization, but handle multi-line gracefully
    const innerLines = para.split('\n')
    let currentLines: string[] = []

    for (const line of innerLines) {
      const headingMatch = line.match(/^(#{1,6})\s+(.*)$/)
      if (headingMatch) {
        if (currentLines.length > 0) {
          nodes.push({
            type: 'paragraph',
            attrs: { blockId },
            content: parseInlineMarkdown(currentLines.join('\n').trim()),
          })
          currentLines = []
        }
        nodes.push({
          type: 'heading',
          attrs: { level: headingMatch[1].length, blockId },
          content: parseInlineMarkdown(headingMatch[2]),
        })
      } else if (line.startsWith('- [ ] ') || line.startsWith('- [x] ')) {
        if (currentLines.length > 0) {
          nodes.push({
            type: 'paragraph',
            attrs: { blockId },
            content: parseInlineMarkdown(currentLines.join('\n').trim()),
          })
          currentLines = []
        }
        const checked = line.startsWith('- [x]')
        const text = line.replace(/^- \[[ x]\] /, '')
        if (!nodes.find((n) => n.type === 'taskList')) {
          nodes.push({ type: 'taskList', attrs: { blockId } })
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
            attrs: { blockId },
            content: parseInlineMarkdown(currentLines.join('\n').trim()),
          })
          currentLines = []
        }
        if (!nodes.find((n) => n.type === 'bulletList')) {
          nodes.push({ type: 'bulletList', attrs: { blockId } })
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
            attrs: { blockId },
            content: parseInlineMarkdown(currentLines.join('\n').trim()),
          })
          currentLines = []
        }
        if (!nodes.find((n) => n.type === 'orderedList')) {
          nodes.push({ type: 'orderedList', attrs: { blockId } })
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
            attrs: { blockId },
            content: parseInlineMarkdown(currentLines.join('\n').trim()),
          })
          currentLines = []
        }
        nodes.push({
          type: 'blockquote',
          attrs: { blockId },
          content: [{ type: 'paragraph', content: parseInlineMarkdown(line.slice(2)) }],
        })
    } else if (line.startsWith('```')) {
      currentLines.push(line)
      } else if (line.startsWith('---')) {
        if (currentLines.length > 0) {
          nodes.push({
            type: 'paragraph',
            attrs: { blockId },
            content: parseInlineMarkdown(currentLines.join('\n').trim()),
          })
          currentLines = []
        }
        nodes.push({ type: 'horizontalRule', attrs: { blockId } })
      } else {
        currentLines.push(line)
      }
    }

    // Flush remaining accumulated lines
    if (currentLines.length > 0) {
      const text = currentLines.join('\n').trim()
      nodes.push({
        type: 'paragraph',
        attrs: { blockId },
        content: text ? parseInlineMarkdown(text) : [],
      })
    }
  }

  return nodes.length > 0 ? nodes : [{ type: 'paragraph', attrs: { blockId } }]
}

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

