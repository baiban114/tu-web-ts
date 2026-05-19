import { Node, mergeAttributes } from '@tiptap/core'
import { VueNodeViewRenderer } from '@tiptap/vue-3'
import SpacerBlockView from '../views/SpacerBlockView.vue'

export const SpacerBlockNode = Node.create({
  name: 'spacerBlock',
  group: 'block',
  atom: true,
  isolating: true,
  selectable: true,
  draggable: true,

  addAttributes() {
    return {
      blockId: { default: '' },
      spacerHeight: { default: 40 },
    }
  },

  parseHTML() {
    return [{ tag: 'div[data-type=\"spacer-block\"]' }]
  },

  renderHTML({ HTMLAttributes }) {
    return ['div', mergeAttributes(HTMLAttributes, { 'data-type': 'spacer-block' })]
  },

  addNodeView() {
    return VueNodeViewRenderer(SpacerBlockView)
  },
})
