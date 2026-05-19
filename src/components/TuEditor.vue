<script setup lang="ts">
import { computed, watch, onBeforeUnmount, onMounted, ref } from 'vue'
import { useEditor, EditorContent } from '@tiptap/vue-3'
import StarterKit from '@tiptap/starter-kit'
import Image from '@tiptap/extension-image'
import Link from '@tiptap/extension-link'
import Highlight from '@tiptap/extension-highlight'
import Placeholder from '@tiptap/extension-placeholder'
import Underline from '@tiptap/extension-underline'
import TextAlign from '@tiptap/extension-text-align'
import TaskList from '@tiptap/extension-task-list'
import TaskItem from '@tiptap/extension-task-item'
import { Table, TableRow, TableCell, TableHeader } from '@tiptap/extension-table'
import type { Block, TextAnnotation } from '@/api/types'
import {
  X6BlockNode,
  TimelineBlockNode,
  RefBlockNode,
  SpacerBlockNode,
  ParagraphNode,
  RichTextEnter,
  BlockActions,
  blocksToTipTap,
  tipTapToBlocks,
} from '@/editor'

interface Props {
  blocks: Block[]
  editable?: boolean
  annotations?: Record<string, TextAnnotation[]>
}

const props = withDefaults(defineProps<Props>(), {
  editable: true,
  annotations: () => ({}),
})

const emit = defineEmits<{
  'update:blocks': [blocks: Block[]]
  'content-change': [blocks: Block[]]
  'selection-change': [hasSelection: boolean, text: string, blockIndex?: number]
  'block-click': [blockId: string, event: MouseEvent]
  'open-block-picker': [afterBlockId: string]
  'open-tag-editor': [blockId: string]
}>()

const editorEl = ref<HTMLElement | null>(null)
let debounceTimer: ReturnType<typeof setTimeout> | null = null
let isInternalUpdate = false
let skipNextContentSync = false

const editor = useEditor({
  content: blocksToTipTap(props.blocks),
  editable: props.editable,
  autofocus: false,
  extensions: [
    RichTextEnter,
    StarterKit.configure({
      heading: { levels: [1, 2, 3, 4, 5, 6] },
      paragraph: false,
      codeBlock: false,
    }),
    Image.configure({ inline: false }),
    Link.configure({ openOnClick: false }),
    Highlight.configure({ multicolor: true }),
    Underline,
    TaskList,
    TaskItem.configure({ nested: true }),
    TextAlign.configure({ types: ['heading', 'paragraph'] }),
    Placeholder.configure({
      placeholder: '输入 / 查看更多选项...',
    }),
    Table.configure({ resizable: true }),
    TableRow,
    TableCell,
    TableHeader,
    X6BlockNode,
    TimelineBlockNode,
    RefBlockNode,
    SpacerBlockNode,
    ParagraphNode,
    BlockActions,
  ],
  editorProps: {
    attributes: {
      class: 'tu-editor-content',
    },
  },
  onCreate: ({ editor }) => {
    (editor.storage as any).blockActions = {
      blocks: props.blocks,
      onBlockAction: (action: string, blockId: string) => handleBlockAction(editor, action, blockId),
      getBlockPosition: (blockId: string) => {
        let foundPos: number | null = null
        editor.state.doc.descendants((node, pos) => {
          if (node.attrs?.blockId === blockId) {
            foundPos = pos
            return false
          }
          return true
        })
        return foundPos
      },
      getBlockById: (blockId: string) => {
        return props.blocks.find(b => b.id === blockId) || null
      },
      createBlock: (type: string) => createBlockByType(type),
    }
  },
  onUpdate: () => {
    if (isInternalUpdate || !editor.value) return
    if (debounceTimer) clearTimeout(debounceTimer)
    debounceTimer = setTimeout(() => {
      const json = editor.value!.getJSON()
      const blocks = tipTapToBlocks(json, props.blocks)
      skipNextContentSync = true
      emit('update:blocks', blocks)
      emit('content-change', blocks)
    }, 300)
  },
  onSelectionUpdate: () => {
    if (!editor.value) return
    const { empty, from, to } = editor.value.state.selection
    const text = empty ? '' : editor.value.state.doc.textBetween(from, to, ' ')
    // Find block index by walking up the resolved path to find the parent blockId
    let blockIndex: number | undefined
    const { $from } = editor.value.state.selection
    for (let d = $from.depth; d >= 1; d--) {
      const node = $from.node(d)
      if (node.attrs.blockId) {
        blockIndex = props.blocks.findIndex(b => b.id === node.attrs.blockId)
        if (blockIndex >= 0) break
      }
    }
    emit('selection-change', !empty, text, blockIndex)
  },
})

watch(
  () => props.blocks,
  (newBlocks, oldBlocks) => {
    if (!editor.value) return
    if (newBlocks === oldBlocks) return
    // If the change originated from our own emit, skip redundant setContent
    // (the editor already has the correct content)
    if (skipNextContentSync) {
      skipNextContentSync = false
      return
    }
    isInternalUpdate = true
    try {
      const content = blocksToTipTap(newBlocks)
      editor.value.commands.setContent(content, { emitUpdate: false })
    } finally {
      isInternalUpdate = false
    }
  },
)

watch(
  () => props.editable,
  (val) => {
    editor.value?.setEditable(val)
  },
)

function createBlockByType(type: string): Block | null {
  const id = 'block-' + Date.now() + '-' + Math.random().toString(36).slice(2, 8)
  switch (type) {
    case 'richtext':
      return { id, type: 'richtext', content: '' }
    case 'x6':
      return {
        id, type: 'x6', title: '新的画板',
        graphData: {
          nodes: [
            { id: `${id}-node-1`, x: 100, y: 100, width: 80, height: 40, label: '节点 1' },
            { id: `${id}-node-2`, x: 300, y: 100, width: 80, height: 40, label: '节点 2' },
          ],
          edges: [{ id: `${id}-edge-1`, source: `${id}-node-1`, target: `${id}-node-2` }],
        },
      }
    case 'line':
      return { id, type: 'line', title: '新的时间轴', timelineData: [] }
    case 'table':
      return { id, type: 'table', tableData: { headers: ['列 1', '列 2'], rows: [['', '']] } }
    case 'spacer':
      return { id, type: 'spacer', spacerHeight: 40 }
    default:
      return null
  }
}

function handleBlockAction(ed: any, action: string, blockId: string) {
  switch (action) {
    case 'insert-richtext': {
      const block = createBlockByType('richtext')
      if (block) ed.commands.insertBlockAfter(block, blockId)
      break
    }
    case 'insert-x6': {
      const block = createBlockByType('x6')
      if (block) ed.commands.insertBlockAfter(block, blockId)
      break
    }
    case 'insert-line': {
      const block = createBlockByType('line')
      if (block) ed.commands.insertBlockAfter(block, blockId)
      break
    }
    case 'insert-table': {
      const block = createBlockByType('table')
      if (block) ed.commands.insertBlockAfter(block, blockId)
      break
    }
    case 'insert-ref':
      emit('open-block-picker', blockId)
      break
    case 'delete':
      ed.commands.deleteBlock(blockId)
      break
    case 'edit-tags':
      emit('open-tag-editor', blockId)
      break
  }
}

onBeforeUnmount(() => {
  if (debounceTimer) clearTimeout(debounceTimer)
  editor.value?.destroy()
})

defineExpose({
  editor,
  getSelectionAsMarkdown: () => {
    if (!editor.value) return ''
    const { from, to, empty } = editor.value.state.selection
    if (empty) return ''
    return editor.value.state.doc.textBetween(from, to, '\n')
  },
  getSelectionPosition: () => {
    if (!editorEl.value || !editor.value) return undefined
    const { from, to } = editor.value.state.selection
    if (from === to) return undefined
    try {
      const start = editor.value.view.coordsAtPos(from)
      const end = editor.value.view.coordsAtPos(to)
      return {
        top: Math.min(start.top, end.top),
        left: (start.left + end.left) / 2,
      }
    } catch {
      return undefined
    }
  },
  getSelectionJSON: () => {
    if (!editor.value) return null
    const { from, to, empty } = editor.value.state.selection
    if (empty) return null
    return editor.value.state.doc.slice(from, to).toJSON()
  },
  focus: () => editor.value?.commands.focus(),
})
</script>

<template>
  <div ref="editorEl" class="tu-editor-wrapper">
    <editor-content :editor="editor" />
  </div>
</template>

<style scoped>
.tu-editor-wrapper {
  width: 100%;
  min-height: 200px;
}

.tu-editor-wrapper :deep(.tu-editor-content) {
  outline: none;
  min-height: 200px;
  padding: 8px 0;
  line-height: 1.7;
  font-size: 15px;
  color: #333;
}

.tu-editor-wrapper :deep(.tu-editor-content p) {
  margin: 0.5em 0;
}

.tu-editor-wrapper :deep(.tu-editor-content h1),
.tu-editor-wrapper :deep(.tu-editor-content h2),
.tu-editor-wrapper :deep(.tu-editor-content h3),
.tu-editor-wrapper :deep(.tu-editor-content h4),
.tu-editor-wrapper :deep(.tu-editor-content h5),
.tu-editor-wrapper :deep(.tu-editor-content h6) {
  margin: 1em 0 0.5em;
  font-weight: 600;
  line-height: 1.3;
}

.tu-editor-wrapper :deep(.tu-editor-content h1) { font-size: 2em; }
.tu-editor-wrapper :deep(.tu-editor-content h2) { font-size: 1.5em; }
.tu-editor-wrapper :deep(.tu-editor-content h3) { font-size: 1.25em; }
.tu-editor-wrapper :deep(.tu-editor-content h4) { font-size: 1.1em; }

.tu-editor-wrapper :deep(.tu-editor-content ul),
.tu-editor-wrapper :deep(.tu-editor-content ol) {
  padding-left: 1.5em;
  margin: 0.5em 0;
}

.tu-editor-wrapper :deep(.tu-editor-content blockquote) {
  border-left: 3px solid #e0e0e0;
  padding-left: 1em;
  margin: 0.5em 0;
  color: #666;
}

.tu-editor-wrapper :deep(.tu-editor-content code) {
  background: #f5f5f5;
  padding: 2px 6px;
  border-radius: 4px;
  font-family: 'SFMono-Regular', Consolas, 'Liberation Mono', Menlo, monospace;
  font-size: 0.9em;
}

.tu-editor-wrapper :deep(.tu-editor-content pre) {
  background: #f5f5f5;
  padding: 1em;
  border-radius: 8px;
  overflow-x: auto;
  margin: 0.5em 0;
}

.tu-editor-wrapper :deep(.tu-editor-content pre code) {
  background: none;
  padding: 0;
}

.tu-editor-wrapper :deep(.tu-editor-content img) {
  max-width: 100%;
  height: auto;
  border-radius: 4px;
}

.tu-editor-wrapper :deep(.tu-editor-content a) {
  color: #1677ff;
  text-decoration: underline;
}

.tu-editor-wrapper :deep(.tu-editor-content hr) {
  border: none;
  border-top: 1px solid #e0e0e0;
  margin: 1em 0;
}

.tu-editor-wrapper :deep(.tu-editor-content table) {
  border-collapse: collapse;
  width: 100%;
  margin: 0.5em 0;
}

.tu-editor-wrapper :deep(.tu-editor-content th),
.tu-editor-wrapper :deep(.tu-editor-content td) {
  border: 1px solid #e0e0e0;
  padding: 8px 12px;
  text-align: left;
}

.tu-editor-wrapper :deep(.tu-editor-content th) {
  background: #f5f5f5;
  font-weight: 600;
}

.tu-editor-wrapper :deep(.tiptap-block) {
  position: relative;
  margin: 8px 0;
  border: 1px solid transparent;
  border-radius: 8px;
  transition: border-color 0.15s ease;
}

.tu-editor-wrapper :deep(.tiptap-block:hover) {
  border-color: #e0e0e0;
}

.tu-editor-wrapper :deep(.tiptap-block--selected) {
  border-color: transparent;
  box-shadow: none;
}

.tu-editor-wrapper :deep(.tiptap-block .block-action-handle) {
  opacity: 0 !important;
  transition: opacity 0.15s ease;
  z-index: 25;
}

.tu-editor-wrapper :deep(.tiptap-block:hover .block-action-handle) {
  opacity: 1 !important;
}

.tu-editor-wrapper :deep(.tiptap-block .hover-handle) {
  position: absolute;
  left: var(--hover-handle-left, calc(var(--block-handle-gutter, 36px) / 2));
  top: var(--hover-handle-top, calc(var(--block-shell-pad-y, 20px) + 6px));
  transform: var(--hover-handle-transform, translateX(-50%));
  width: 28px;
  height: var(--hover-handle-height, 28px);
  display: flex;
  align-items: center;
  justify-content: center;
}

.tu-editor-wrapper :deep(.tiptap-block__header) {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 8px 12px;
  background: #f9f9f9;
  border-radius: 8px 8px 0 0;
}

.tu-editor-wrapper :deep(.tiptap-block__title) {
  font-size: 13px;
  font-weight: 600;
  color: #666;
}

.tu-editor-wrapper :deep(.tiptap-block__type-badge) {
  font-size: 11px;
  padding: 2px 6px;
  background: #e0e0e0;
  border-radius: 4px;
  color: #666;
}

.tu-editor-wrapper :deep(.tiptap-block--spacer) {
  border: 1px dashed #e0e0e0;
  background: #fafafa;
}

.tu-editor-wrapper :deep(.ProseMirror-selectednode) {
  outline: 2px solid #1677ff;
}

.tu-editor-wrapper :deep([data-drag-handle]) {
  cursor: grab;
}

.tu-editor-wrapper :deep(.is-editor-empty:first-child::before) {
  content: attr(data-placeholder);
  float: left;
  color: #adb5bd;
  pointer-events: none;
  height: 0;
}
</style>
