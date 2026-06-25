import { findChildren } from '@tiptap/core'
import type { Node as ProsemirrorNode } from '@tiptap/pm/model'
import type { Selection } from '@tiptap/pm/state'
import { Plugin, PluginKey } from '@tiptap/pm/state'
import { Decoration, DecorationSet } from '@tiptap/pm/view'
// @ts-ignore
import highlight from 'highlight.js/lib/core'

function parseNodes(nodes: any[], className: string[] = []): { text: string; classes: string[] }[] {
  return nodes.flatMap((node) => {
    const classes = [...className, ...(node.properties ? node.properties.className : [])]
    if (node.children) return parseNodes(node.children, classes)
    return { text: node.value, classes }
  })
}

function getHighlightNodes(result: any) {
  return result.value || result.children || []
}

function registered(aliasOrLanguage: string) {
  return Boolean(highlight.getLanguage(aliasOrLanguage))
}

function selectionInsideBlock(blockPos: number, blockSize: number, selection: Selection): boolean {
  const head = selection.head
  return head > blockPos && head < blockPos + blockSize
}

function getDecorations({
  doc,
  name,
  lowlight,
  defaultLanguage,
  selection,
}: {
  doc: ProsemirrorNode
  name: string
  lowlight: any
  defaultLanguage: string | null | undefined
  selection: Selection
}) {
  const decorations: Decoration[] = []

  findChildren(doc, (node) => node.type.name === name).forEach((block) => {
    if (selectionInsideBlock(block.pos, block.node.nodeSize, selection)) {
      return
    }

    let from = block.pos + 1
    const language = block.node.attrs.language || defaultLanguage
    const languages = lowlight.listLanguages()

    const nodes =
      language && (languages.includes(language) || registered(language) || lowlight.registered?.(language))
        ? getHighlightNodes(lowlight.highlight(language, block.node.textContent))
        : getHighlightNodes(lowlight.highlightAuto(block.node.textContent))

    parseNodes(nodes).forEach((node) => {
      const to = from + node.text.length
      if (node.classes.length) {
        decorations.push(Decoration.inline(from, to, { class: node.classes.join(' ') }))
      }
      from = to
    })
  })

  return DecorationSet.create(doc, decorations)
}

// eslint-disable-next-line @typescript-eslint/no-unsafe-function-type
function isFunction(param: any): param is Function {
  return typeof param === 'function'
}

/** Apply lowlight only on code blocks that do not contain the cursor (avoids DOM span churn while editing). */
export function createConditionalLowlightPlugin({
  name,
  lowlight,
  defaultLanguage,
}: {
  name: string
  lowlight: any
  defaultLanguage?: string | null
}) {
  if (!['highlight', 'highlightAuto', 'listLanguages'].every((api) => isFunction(lowlight[api]))) {
    throw Error('You should provide an instance of lowlight to use the code-block-lowlight extension')
  }

  const pluginKey = new PluginKey('conditionalLowlight')

  return new Plugin({
    key: pluginKey,
    state: {
      init: (_, { doc, selection }) => getDecorations({ doc, name, lowlight, defaultLanguage, selection }),
      apply: (_transaction, _decorationSet, _oldState, newState) => getDecorations({
        doc: newState.doc,
        name,
        lowlight,
        defaultLanguage,
        selection: newState.selection,
      }),
    },
    props: {
      decorations(state) {
        return pluginKey.getState(state)
      },
    },
  })
}
