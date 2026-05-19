import { Node, mergeAttributes } from '@tiptap/core'
import { VueNodeViewRenderer } from '@tiptap/vue-3'
import ParagraphView from '../views/ParagraphView.vue'

export const ParagraphNode = Node.create({
  name: 'paragraph',
  group: 'block',
  content: 'inline*',
  selectable: true,
  draggable: true,

  addAttributes() {
    return {
      blockId: { default: '' },
    }
  },

  parseHTML() {
    return [{ tag: 'p' }]
  },

  renderHTML({ HTMLAttributes }) {
    return ['p', mergeAttributes(HTMLAttributes), 0]
  },

  addNodeView() {
    return VueNodeViewRenderer(ParagraphView)
  },

  addKeyboardShortcuts() {
    return {
      Backspace: () => {
        const { empty, $from } = this.editor.state.selection
        if (!empty) return false
        if ($from.parent.type.name !== this.name) return false
        if ($from.parentOffset > 0) return false

        const $before = this.editor.state.doc.resolve($from.before() - 1)
        if ($before.parent.type.name === this.name) {
          return this.editor.commands.joinItemBackward()
        }

        const prevNode = this.editor.state.doc.resolve($from.before()).nodeBefore
        if (!prevNode) {
          return this.editor.commands.deleteNode(this.name)
        }

        return false
      },
    }
  },
})
