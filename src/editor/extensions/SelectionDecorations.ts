import { Extension } from '@tiptap/core'
import { Plugin, PluginKey } from '@tiptap/pm/state'
import { Decoration, DecorationSet } from '@tiptap/pm/view'

interface SelectionDecorationState {
  from: number | null
  to: number | null
  decorations: DecorationSet
}

export const selectionDecorationsKey = new PluginKey<SelectionDecorationState>('selectionDecorations')

export const SelectionDecorations = Extension.create({
  name: 'selectionDecorations',

  addProseMirrorPlugins() {
    return [
      new Plugin<SelectionDecorationState>({
        key: selectionDecorationsKey,
        state: {
          init: (_, state) => createSelectionState(state.doc, null, null),
          apply: (tr, previous, _oldState, newState) => {
            if (tr.selectionSet) {
              const { from, to, empty } = newState.selection
              return empty
                ? createSelectionState(newState.doc, null, null)
                : createSelectionState(newState.doc, from, to)
            }

            if (!tr.docChanged || previous.from === null || previous.to === null) {
              return previous
            }

            const from = tr.mapping.map(previous.from, 1)
            const to = tr.mapping.map(previous.to, -1)
            return to > from
              ? createSelectionState(newState.doc, from, to)
              : createSelectionState(newState.doc, null, null)
          },
        },
        props: {
          decorations(state) {
            return selectionDecorationsKey.getState(state)?.decorations ?? null
          },
        },
      }),
    ]
  },
})

function createSelectionState(doc: any, from: number | null, to: number | null): SelectionDecorationState {
  if (from === null || to === null || to <= from) {
    return { from: null, to: null, decorations: DecorationSet.empty }
  }

  return {
    from,
    to,
    decorations: DecorationSet.create(doc, [
      Decoration.inline(from, to, { class: 'tu-tiptap-selection-retained' }),
    ]),
  }
}
