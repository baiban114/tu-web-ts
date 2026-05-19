import { Node, mergeAttributes } from '@tiptap/core'
import { VueNodeViewRenderer } from '@tiptap/vue-3'
import RefBlockView from '../views/RefBlockView.vue'

export const RefBlockNode = Node.create({
  name: 'refBlock',
  group: 'block',
  atom: true,
  isolating: true,
  selectable: true,
  draggable: true,

  addAttributes() {
    return {
      blockId: { default: '' },
      refId: { default: '' },
      refType: { default: 'block' },
    }
  },

  parseHTML() {
    return [{ tag: 'div[data-type=\"ref-block\"]' }]
  },

  renderHTML({ HTMLAttributes }) {
    return ['div', mergeAttributes(HTMLAttributes, { 'data-type': 'ref-block' })]
  },

  addNodeView() {
    return VueNodeViewRenderer(RefBlockView)
  },

  addKeyboardShortcuts() {
    return {
      Backspace: () => {
        const { empty, $from } = this.editor.state.selection
        if (!empty) return false
        const nodePos = this.editor.state.doc.resolve($from.pos)
        if (nodePos.parent.type.name !== this.name && nodePos.parentOffset === 0) {
          return this.editor.commands.deleteNode(this.name)
        }
        return false
      },
    }
  },
})
