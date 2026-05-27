import { Node, mergeAttributes } from '@tiptap/core'
import { VueNodeViewRenderer } from '@tiptap/vue-3'
import MultiTableBlockView from '../views/MultiTableBlockView.vue'

export const MultiTableBlockNode = Node.create({
  name: 'multiTableBlock',
  group: 'block',
  atom: true,
  isolating: true,
  selectable: true,
  draggable: true,

  addAttributes() {
    return {
      blockId: { default: '' },
      title: { default: '' },
      headingLevel: { default: 0 },
      width: { default: null },
      height: { default: null },
      multiTableData: { default: { fields: [], records: [], views: [] } },
      metadata: { default: {} },
    }
  },

  parseHTML() {
    return [{ tag: 'div[data-type="multi-table-block"]' }]
  },

  renderHTML({ HTMLAttributes }) {
    return ['div', mergeAttributes(HTMLAttributes, { 'data-type': 'multi-table-block' })]
  },

  addNodeView() {
    return VueNodeViewRenderer(MultiTableBlockView)
  },
})
