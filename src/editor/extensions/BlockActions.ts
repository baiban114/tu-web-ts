import { Extension, type CommandProps } from '@tiptap/core'
import type { Block } from '@/api/types'

export interface BlockActionsStorage {
  blocks: Block[]
  onBlockAction: (action: string, blockId: string) => void
  getBlockPosition: (blockId: string) => number | null
  getBlockById: (blockId: string) => Block | null
  createBlock: (type: string) => Block | null
}

declare module '@tiptap/core' {
  interface Commands<ReturnType> {
    blockActions: {
      insertBlockAfter: (block: Block, afterBlockId: string) => ReturnType
      insertBlockBefore: (block: Block, beforeBlockId: string) => ReturnType
      deleteBlock: (blockId: string) => ReturnType
    }
  }
}

export const BlockActions = Extension.create({
  name: 'blockActions',

  addStorage(): BlockActionsStorage {
    return {
      blocks: [],
      onBlockAction: () => {},
      getBlockPosition: () => null,
      getBlockById: () => null,
      createBlock: () => null,
    }
  },

  addCommands() {
    return {
      insertBlockAfter: (block: Block, afterBlockId: string) => ({ tr, dispatch }: CommandProps) => {
        const pos = this.storage.getBlockPosition(afterBlockId)
        if (pos === null) return false

        const $pos = tr.doc.resolve(pos)
        const insertPos = $pos.after()

        const tipTapNode = blockToTipTapNode(block, this.editor)
        if (!tipTapNode) return false

        if (dispatch) {
          tr.insert(insertPos, tipTapNode)
          tr.scrollIntoView()
        }
        return true
      },

      insertBlockBefore: (block: Block, beforeBlockId: string) => ({ tr, dispatch }: CommandProps) => {
        const pos = this.storage.getBlockPosition(beforeBlockId)
        if (pos === null) return false

        const tipTapNode = blockToTipTapNode(block, this.editor)
        if (!tipTapNode) return false

        if (dispatch) {
          tr.insert(pos, tipTapNode)
          tr.scrollIntoView()
        }
        return true
      },

      deleteBlock: (blockId: string) => ({ tr, dispatch }: CommandProps) => {
        const pos = this.storage.getBlockPosition(blockId)
        if (pos === null) return false

        const $pos = tr.doc.resolve(pos)

        if (dispatch) {
          tr.delete($pos.before(), $pos.after())
          tr.scrollIntoView()
        }
        return true
      },
    }
  },
})

function blockToTipTapNode(block: Block, editor: any) {
  const schema = editor.schema
  const attrs = { blockId: block.id, title: block.title || '' }

  switch (block.type) {
    case 'richtext':
    case 'richText':
      return schema.nodes.paragraph.create(attrs, schema.text(block.content || ''))

    case 'x6':
      return schema.nodes.x6Block.create({
        ...attrs,
        graphData: block.graphData || { nodes: [], edges: [] },
        metadata: block.metadata || {},
      })

    case 'line':
      return schema.nodes.timelineBlock.create({
        ...attrs,
        timelineData: block.timelineData || [],
      })

    case 'ref':
      return schema.nodes.refBlock.create({
        ...attrs,
        refId: block.refId || '',
        refType: block.refType || 'block',
      })

    case 'spacer':
      return schema.nodes.spacerBlock.create({
        ...attrs,
        spacerHeight: block.spacerHeight || 40,
      })

    case 'table':
      return schema.nodes.tableBlock.create({
        ...attrs,
        tableData: block.tableData || { headers: [], rows: [] },
      })

    default:
      return schema.nodes.paragraph.create(attrs, schema.text(''))
  }
}
