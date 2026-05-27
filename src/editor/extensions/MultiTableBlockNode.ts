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
    return VueNodeViewRenderer(MultiTableBlockView, {
      stopEvent: ({ event }) => {
        const target = event.target
        if (!(target instanceof Element)) return false
        if (!target.closest('.multi-table')) return false
        return [
          'contextmenu',
          'mousedown',
          'mousemove',
          'mouseup',
          'click',
          'dblclick',
          'input',
          'change',
          'keydown',
          'keyup',
          'pointerdown',
          'pointermove',
          'pointerup',
          'pointercancel',
          'touchstart',
          'touchmove',
          'touchend',
          'dragstart',
          'drag',
          'dragenter',
          'dragover',
          'dragleave',
          'drop',
          'dragend',
        ].includes(event.type)
      },
    })
  },
})
