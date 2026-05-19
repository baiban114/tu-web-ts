import type { Block } from '@/api/types'
import type { JSONContent } from '@tiptap/core'

let idCounter = 0
function generateId(): string {
  return 'tipTap-block-' + Date.now() + '-' + (++idCounter)
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
          graphData: block.graphData || { nodes: [], edges: [] },
          metadata: block.metadata || {},
        },
      })
    } else if (block.type === 'table') {
      children.push({
        type: 'tableBlock',
        attrs: {
          blockId: block.id,
          title: block.title || '',
          tableData: block.tableData || { headers: [], rows: [] },
        },
      })
    } else if (block.type === 'line') {
      children.push({
        type: 'timelineBlock',
        attrs: {
          blockId: block.id,
          title: block.title || '',
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
        },
      })
    } else if (block.type === 'spacer') {
      children.push({
        type: 'spacerBlock',
        attrs: {
          blockId: block.id,
          spacerHeight: block.spacerHeight || 40,
        },
      })
    } else if (block.type === 'container' && block.children) {
      children.push({
        type: 'containerBlock',
        attrs: {
          blockId: block.id,
          layout: block.layout || 'horizontal',
        },
        content: [blocksToTipTap(block.children)],
      })
    }
  }

  return { type: 'doc', content: children }
}

export function tipTapToBlocks(json: JSONContent, originalBlocks: Block[]): Block[] {
  const blocks: Block[] = []
  if (!json.content) return blocks

  let currentRichTextBlockId: string | null = null
  const richTextNodes: JSONContent[] = []

  const flushRichText = () => {
    if (richTextNodes.length > 0) {
      const existingBlock = originalBlocks.find((b) => b.id === currentRichTextBlockId && isRichTextBlock(b))
      blocks.push({
        id: currentRichTextBlockId || existingBlock?.id || generateId(),
        type: 'richtext',
        content: tipTapNodesToMarkdown(richTextNodes),
        metadata: existingBlock?.metadata,
      })
      currentRichTextBlockId = null
      richTextNodes.length = 0
    }
  }

  for (const node of json.content) {
    if (isTipTapRichTextNode(node)) {
      if (!currentRichTextBlockId) {
        const existingRt = originalBlocks.find((b) => isRichTextBlock(b))
        currentRichTextBlockId = existingRt?.id || null
      }
      richTextNodes.push(node)
    } else {
      flushRichText()
      const converted = convertNonRichTextNode(node, originalBlocks)
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
  return ['heading', 'paragraph', 'bulletList', 'orderedList', 'blockquote', 'codeBlock', 'horizontalRule', 'taskList', 'image'].includes(node.type || '')
}

function convertNonRichTextNode(node: JSONContent, originalBlocks: Block[]): Block | null {
  const blockId = node.attrs?.blockId
  const existingBlock = blockId ? originalBlocks.find((b) => b.id === blockId) : null

  switch (node.type) {
    case 'x6Block':
      return {
        id: blockId || existingBlock?.id || generateId(),
        type: 'x6',
        title: node.attrs?.title || existingBlock?.title,
        graphData: node.attrs?.graphData || existingBlock?.graphData,
        metadata: node.attrs?.metadata || existingBlock?.metadata,
      }
    case 'tableBlock':
      return {
        id: blockId || existingBlock?.id || generateId(),
        type: 'table',
        title: node.attrs?.title || existingBlock?.title,
        tableData: node.attrs?.tableData || existingBlock?.tableData,
      }
    case 'timelineBlock':
      return {
        id: blockId || existingBlock?.id || generateId(),
        type: 'line',
        title: node.attrs?.title || existingBlock?.title,
        timelineData: node.attrs?.timelineData || existingBlock?.timelineData,
      }
    case 'refBlock':
      return {
        id: blockId || existingBlock?.id || generateId(),
        type: 'ref',
        refId: node.attrs?.refId || existingBlock?.refId,
        refType: node.attrs?.refType || existingBlock?.refType,
      }
    case 'spacerBlock':
      return {
        id: blockId || existingBlock?.id || generateId(),
        type: 'spacer',
        spacerHeight: node.attrs?.spacerHeight || existingBlock?.spacerHeight || 40,
      }
    case 'containerBlock':
      return {
        id: blockId || existingBlock?.id || generateId(),
        type: 'container',
        layout: node.attrs?.layout || existingBlock?.layout,
        children: tipTapToBlocks(node.content?.[0] || { type: 'doc' }, originalBlocks),
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
      content: [{ type: 'text', text: '' }],
    }]
  }

  const lines = markdown.split('\n')
  const nodes: JSONContent[] = []
  let currentLines: string[] = []

  const flushParagraph = () => {
    const text = currentLines.join('\n').trim()
    if (text) {
      nodes.push({
        type: 'paragraph',
        attrs: { blockId },
        content: parseInlineMarkdown(text),
      })
    }
    currentLines = []
  }

  for (const line of lines) {
    const headingMatch = line.match(/^(#{1,6})\s+(.*)$/)
    if (headingMatch) {
      flushParagraph()
      nodes.push({
        type: 'heading',
        attrs: { level: headingMatch[1].length, blockId },
        content: parseInlineMarkdown(headingMatch[2]),
      })
    } else if (line === '') {
      flushParagraph()
    } else if (line.startsWith('- [ ] ') || line.startsWith('- [x] ')) {
      flushParagraph()
      const checked = line.startsWith('- [x]')
      const text = line.replace(/^- \[[ x]\] /, '')
      if (!nodes.find((n) => n.type === 'taskList')) {
        nodes.push({ type: 'taskList', attrs: { blockId }, content: [] })
      }
      const taskList = nodes.find((n) => n.type === 'taskList')!
      ;(taskList.content = taskList.content || []).push({
        type: 'taskItem',
        attrs: { checked },
        content: parseInlineMarkdown(text),
      })
    } else if (line.startsWith('- ') || line.startsWith('* ')) {
      flushParagraph()
      if (!nodes.find((n) => n.type === 'bulletList')) {
        nodes.push({ type: 'bulletList', attrs: { blockId }, content: [] })
      }
      const list = nodes.find((n) => n.type === 'bulletList')!
      ;(list.content = list.content || []).push({
        type: 'listItem',
        content: [{ type: 'paragraph', content: parseInlineMarkdown(line.replace(/^[-*] /, '')) }],
      })
    } else if (/^\d+\.\s/.test(line)) {
      flushParagraph()
      if (!nodes.find((n) => n.type === 'orderedList')) {
        nodes.push({ type: 'orderedList', attrs: { blockId }, content: [] })
      }
      const list = nodes.find((n) => n.type === 'orderedList')!
      ;(list.content = list.content || []).push({
        type: 'listItem',
        content: [{ type: 'paragraph', content: parseInlineMarkdown(line.replace(/^\d+\.\s/, '')) }],
      })
    } else if (line.startsWith('> ')) {
      flushParagraph()
      nodes.push({
        type: 'blockquote',
        attrs: { blockId },
        content: [{ type: 'paragraph', content: parseInlineMarkdown(line.slice(2)) }],
      })
    } else if (line.startsWith('```')) {
      flushParagraph()
    } else if (line.startsWith('---')) {
      flushParagraph()
      nodes.push({ type: 'horizontalRule', attrs: { blockId } })
    } else {
      currentLines.push(line)
    }
  }

  flushParagraph()
  return nodes.length > 0 ? nodes : [{ type: 'paragraph', attrs: { blockId }, content: [{ type: 'text', text: '' }] }]
}

function parseInlineMarkdown(text: string): JSONContent[] {
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

  return parts.length > 0 ? parts : [{ type: 'text', text: '' }]
}

function tipTapNodesToMarkdown(nodes: JSONContent[]): string {
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
    case 'codeBlock':
      return '```' + (node.attrs?.language || '') + '\n' + (node.content?.[0]?.text || '') + '\n```'
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
    return ''
  }).join('')
}
