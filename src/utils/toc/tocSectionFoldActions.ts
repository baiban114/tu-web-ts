import type { Editor } from '@tiptap/core'
import type { FlatTocEntry } from '@/utils/toc/headings'
import { createHeadingBlockId } from '@/utils/headingSource'

export function findEmbedRoot(editorDom: HTMLElement, blockId: string): HTMLElement | null {
  return editorDom.querySelector<HTMLElement>(`[data-block-id="${CSS.escape(blockId)}"]`)
}

export function findHeadingInEmbed(
  editorDom: HTMLElement,
  blockId: string,
  headingText?: string,
): HTMLElement | null {
  if (!headingText) return null
  const embedRoot = findEmbedRoot(editorDom, blockId)
  if (!embedRoot) return null
  const contentRoot = embedRoot.querySelector<HTMLElement>(
    '.ref-page-content, .ref-block-card__content, .external-resource-card, .ProseMirror',
  ) ?? embedRoot
  const headings = contentRoot.querySelectorAll<HTMLElement>('h1,h2,h3,h4,h5,h6')
  for (const heading of headings) {
    if (heading.textContent?.trim() === headingText.trim()) return heading
  }
  return null
}

export function findTocFoldAnchorElement(
  editor: Editor,
  entry: FlatTocEntry,
): HTMLElement | null {
  const nodeDom = editor.view.nodeDOM(entry.pos)
  if (!(nodeDom instanceof HTMLElement)) {
    if (nodeDom instanceof Text) return nodeDom.parentElement
    return null
  }

  if (entry.sourceType === 'local') {
    return nodeDom
  }

  if (entry.sourceType === 'ref-group') {
    return nodeDom.querySelector<HTMLElement>('.resizable-block-wrapper__heading') ?? nodeDom
  }

  if (entry.sourceType === 'ref-child') {
    return findHeadingInEmbed(editor.view.dom, entry.blockId, entry.targetText || entry.text)
  }

  return null
}

const EMBED_SECTION_COLLAPSED = 'heading-section--embed-section-collapsed'

function headingLevelFromTag(tagName: string): number {
  const match = tagName.match(/^H(\d)$/i)
  return match ? Number(match[1]) : 7
}

export function syncEmbedChildSectionCollapse(
  editorDom: HTMLElement,
  entry: FlatTocEntry,
  collapsed: boolean,
) {
  const heading = findHeadingInEmbed(editorDom, entry.blockId, entry.targetText || entry.text)
  if (!heading) return

  const contentRoot = heading.closest<HTMLElement>(
    '.ref-page-content, .ref-block-card__content, .external-resource-card, .ProseMirror',
  ) ?? heading.parentElement
  if (!contentRoot) return

  contentRoot.querySelectorAll(`.${EMBED_SECTION_COLLAPSED}`).forEach((el) => {
    el.classList.remove(EMBED_SECTION_COLLAPSED)
  })

  if (!collapsed) return

  const boundaryLevel = entry.level
  let node: Element | null = heading.nextElementSibling
  while (node) {
    if (node.matches('h1,h2,h3,h4,h5,h6')) {
      const level = headingLevelFromTag(node.tagName)
      if (level <= boundaryLevel) break
    }
    node.classList.add(EMBED_SECTION_COLLAPSED)
    node = node.nextElementSibling
  }
}

export function clearEmbedChildSectionCollapses(editorDom: HTMLElement) {
  editorDom.querySelectorAll(`.${EMBED_SECTION_COLLAPSED}`).forEach((el) => {
    el.classList.remove(EMBED_SECTION_COLLAPSED)
  })
}

export function toggleTocEntryCollapse(editor: Editor, entry: FlatTocEntry) {
  if (entry.sourceType === 'local') {
    editor.chain().focus().command(({ tr, state }) => {
      const node = state.doc.nodeAt(entry.pos)
      if (!node || node.type.name !== 'heading') return false
      tr.setNodeMarkup(entry.pos, undefined, {
        ...node.attrs,
        blockId: node.attrs.blockId || createHeadingBlockId(),
        sectionCollapsed: !node.attrs.sectionCollapsed,
      })
      return true
    }).run()
    return
  }

  if (entry.sourceType === 'ref-group') {
    editor.chain().focus().command(({ tr, state }) => {
      const node = state.doc.nodeAt(entry.pos)
      if (!node) return false
      tr.setNodeMarkup(entry.pos, undefined, {
        ...node.attrs,
        sectionCollapsed: !node.attrs.sectionCollapsed,
      })
      return true
    }).run()
    return
  }

  if (entry.sourceType === 'ref-child') {
    editor.chain().focus().command(({ tr, state }) => {
      const node = state.doc.nodeAt(entry.pos)
      if (!node) return false
      const metadata = { ...(node.attrs.metadata || {}) } as {
        sectionCollapsedChildren?: Record<string, boolean>
      }
      const children = { ...(metadata.sectionCollapsedChildren || {}) }
      if (children[entry.id]) {
        delete children[entry.id]
      } else {
        children[entry.id] = true
      }
      metadata.sectionCollapsedChildren = children
      tr.setNodeMarkup(entry.pos, undefined, {
        ...node.attrs,
        metadata,
      })
      return true
    }).run()
  }
}
