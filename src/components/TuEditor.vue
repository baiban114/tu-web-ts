<script setup lang="ts">
import { watch, onBeforeUnmount, onMounted, ref, computed, provide } from 'vue'
import type { CSSProperties } from 'vue'
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
import type { Block, TextAnnotation, SpannedBlockInfo } from '@/api/types'
import {
  AnnotationDecorations,
  annotationDecorationsKey,
  BlockActions,
  SelectionDecorations,
  SlashCommand,
  X6BlockNode,
  TimelineBlockNode,
  RefBlockNode,
  SpacerBlockNode,
  TableBlockNode,
  ParagraphNode,
  blocksToTipTap,
  tipTapToBlocks,
} from '@/editor'
import { createGraphFromSource, createGraphSourceMetadata } from '@/utils/graphSources'
import { useWorkspaceStore } from '@/stores/workspace'
import HoverHandle from './HoverHandle.vue'

interface Props {
  blocks: Block[]
  editable?: boolean
  annotations?: Record<string, TextAnnotation[]>
  hoverHandle?: boolean
}

const props = withDefaults(defineProps<Props>(), {
  editable: true,
  annotations: () => ({}),
  hoverHandle: true,
})

const emit = defineEmits<{
  'update:blocks': [blocks: Block[]]
  'content-change': [blocks: Block[]]
  'selection-change': [hasSelection: boolean, text: string, from?: number, to?: number, blockId?: string, spannedBlockIds?: string[], spannedBlockMetadata?: SpannedBlockInfo[]]
  'selection-pointer-change': [active: boolean]
  'annotation-click': [payload: { annotationId: string; annotationIds?: string[]; event: MouseEvent }]
  'annotations-mapped': [annotations: TextAnnotation[]]
  'block-click': [blockId: string, event: MouseEvent]
  'compound-badge-click': [blockId: string, annotationId: string, clientY: number, clientX: number]
  'open-block-picker': []
  'open-tag-editor': [blockId: string]
}>()

type InsertBlockType = 'richtext' | 'ref' | 'line' | 'x6' | 'knowledge-roadmap' | 'table' | 'spacer'
type HandleAction = InsertBlockType | 'cut' | 'copy' | 'duplicate' | 'clear-formatting' | 'delete'

interface InsertOption {
  key: InsertBlockType
  label: string
  icon: string
  keywords: string[]
}

const editorEl = ref<HTMLElement | null>(null)
const hoverHandleRef = ref<InstanceType<typeof HoverHandle> | null>(null)
const workspaceStore = useWorkspaceStore()
let debounceTimer: ReturnType<typeof setTimeout> | null = null
let isInternalUpdate = false
let skipNextContentSync = false
let isMounted = false
let pendingRefInsertPos: number | null = null
let selectionPointerDown = false
let lastDocSignature = ''

// --- Hover Handle ---
const LINE_NODE_TYPES = ['paragraph', 'heading', 'list_item', 'blockquote', 'bullet_list', 'ordered_list', 'task_list', 'task_item']
const HANDLE_GUTTER_WIDTH = 44
const hoveredPos = ref<number | null>(null)
const handleVisible = ref(false)
const handleTop = ref(0)
const handleHeight = ref(28)
const handleMenuVisible = ref(false)
let hideHandleTimer: ReturnType<typeof setTimeout> | null = null

const handlePositionStyle = computed<CSSProperties>(() => ({
  '--hover-handle-left': `${HANDLE_GUTTER_WIDTH / 2}px`,
  '--hover-handle-top': `${handleTop.value}px`,
  '--hover-handle-height': `${handleHeight.value}px`,
  '--hover-handle-transform': 'translateX(-50%)',
}))

const insertOptions: InsertOption[] = [
  { key: 'richtext', label: '文本', icon: '📝', keywords: ['text', 'richtext', 'wenben'] },
  { key: 'ref', label: '引用', icon: '🔖', keywords: ['ref', 'reference', 'yinyong'] },
  { key: 'line', label: '时间轴', icon: '🕒', keywords: ['timeline', 'line', 'shijianzhou'] },
  { key: 'x6', label: 'X6 画板', icon: '🧩', keywords: ['x6', 'graph', 'draw', 'huaban'] },
  { key: 'knowledge-roadmap', label: '知识库路线图', icon: '🗺️', keywords: ['roadmap', 'knowledge', 'kb', 'zhishiku'] },
  { key: 'table', label: '表格', icon: '▦', keywords: ['table', 'biaoge'] },
  { key: 'spacer', label: '分割空白', icon: '↕', keywords: ['spacer', 'blank', 'kongbai'] },
]

const handleItems = [
  { key: 'insert-divider', label: '插入', divider: true },
  ...insertOptions.map((option) => ({ key: option.key, label: option.label, icon: option.icon })),
  { key: 'action-divider', label: '操作', divider: true },
  { key: 'cut', label: '剪切行', icon: '✂️' },
  { key: 'copy', label: '复制', icon: '📋' },
  { key: 'duplicate', label: '复制行', icon: '📄' },
  { key: 'clear-formatting', label: '清除格式', icon: '🧹' },
  { key: 'delete', label: '删除行', icon: '🗑️', danger: true },
]

const slashQuery = ref('')
const slashMenuVisible = ref(false)
const slashMenuTop = ref(0)
const slashMenuLeft = ref(0)

const filteredSlashOptions = computed(() => {
  const keyword = slashQuery.value.trim().toLowerCase()
  if (!keyword) return insertOptions
  return insertOptions.filter((option) => (
    option.label.toLowerCase().includes(keyword)
    || option.key.includes(keyword)
    || option.keywords.some((item) => item.includes(keyword))
  ))
})

const flattenedAnnotations = computed(() => Object.values(props.annotations).flat())

const compoundAnnotationBadges = computed(() => {
  const map: Record<string, { annotationId: string; color: string }[]> = {}
  for (const annotations of Object.values(props.annotations)) {
    for (const ann of annotations) {
      if (ann.scope === 'compound' && ann.spannedBlockIds?.length) {
        for (const bid of ann.spannedBlockIds) {
          if (!map[bid]) map[bid] = []
          map[bid].push({ annotationId: ann.id, color: ann.color || '#FFEB3B' })
        }
      }
    }
  }
  return map
})

provide('compoundAnnotationBadges', compoundAnnotationBadges)

const handleCompoundBadgeClick = (blockId: string, annotationId: string, event: MouseEvent) => {
  emit('compound-badge-click', blockId, annotationId, event.clientY, event.clientX)
}
provide('onCompoundBadgeClick', handleCompoundBadgeClick)

const getBlockIdAtPos = (pos: number): string | undefined => {
  if (!editor.value) return undefined
  const doc = editor.value.state.doc
  const clamped = Math.max(0, Math.min(pos, doc.content.size))
  const resolved = doc.resolve(clamped)

  for (let depth = resolved.depth; depth >= 1; depth -= 1) {
    const blockId = resolved.node(depth).attrs?.blockId
    if (blockId) return blockId
  }

  const topLevel = resolved.depth >= 1 ? resolved.node(1) : resolved.nodeAfter
  const blockId = topLevel?.attrs?.blockId
  return typeof blockId === 'string' && blockId ? blockId : undefined
}

const getDocSignature = (): string => {
  if (!editor.value) return ''
  return JSON.stringify(editor.value.getJSON())
}

const getBlockRange = (resolved: any) => {
  const from = resolved.before(1)
  const to = resolved.after(1)
  return { from, to }
}

const generateBlockId = (): string => `block-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`

const createExternalBlock = (type: InsertBlockType): Block | null => {
  const id = generateBlockId()
  switch (type) {
    case 'richtext':
      return { id, type: 'richtext', content: '' }
    case 'line':
      return { id, type: 'line', title: '新的时间轴', timelineData: [] }
    case 'x6':
      return {
        id,
        type: 'x6',
        title: '新的画板',
        graphData: {
          nodes: [
            { id: `${id}-node-1`, x: 100, y: 100, width: 80, height: 40, label: '节点 1' },
            { id: `${id}-node-2`, x: 300, y: 100, width: 80, height: 40, label: '节点 2' },
          ],
          edges: [
            { id: `${id}-edge-1`, source: `${id}-node-1`, target: `${id}-node-2` },
          ],
        },
      }
    case 'knowledge-roadmap':
      return {
        id,
        type: 'x6',
        title: '知识库路线图',
        metadata: createGraphSourceMetadata('knowledge-base-pages', {
          sourceId: workspaceStore.currentKbId,
          syncMode: 'bidirectional',
        }),
        graphData: createGraphFromSource('knowledge-base-pages', workspaceStore.pageTree),
      }
    case 'table':
      return {
        id,
        type: 'table',
        title: '新表格',
        tableData: {
          headers: ['列 1', '列 2'],
          rows: [['', '']],
        },
      }
    case 'spacer':
      return { id, type: 'spacer', spacerHeight: 40 }
    case 'ref':
      return { id, type: 'ref', refId: '', refType: 'block' }
    default:
      return null
  }
}

const insertBlockAfterPos = (block: Block, pos: number) => {
  if (!editor.value) return false
  return editor.value.commands.insertExternalBlockAfterPos(block, pos)
}

const insertBlockAtSelection = (block: Block) => {
  if (!editor.value) return false
  return editor.value.commands.insertExternalBlockAtSelection(block)
}

const requestRefInsertAfterPos = (pos: number) => {
  pendingRefInsertPos = pos
  emit('open-block-picker')
}

const insertExternalBlockAfterPos = (type: InsertBlockType, pos: number) => {
  if (type === 'ref') {
    requestRefInsertAfterPos(pos)
    return
  }

  const block = createExternalBlock(type)
  if (!block) return
  insertBlockAfterPos(block, pos)
}

const insertExternalBlockAtSelection = (type: InsertBlockType) => {
  if (!editor.value) return
  if (type === 'ref') {
    pendingRefInsertPos = editor.value.state.selection.from
    emit('open-block-picker')
    return
  }

  const block = createExternalBlock(type)
  if (!block) return
  insertBlockAtSelection(block)
}

const completePendingRefInsert = (refId: string, refType: 'block' | 'page') => {
  const block: Block = {
    id: generateBlockId(),
    type: 'ref',
    refId,
    refType,
  }

  if (pendingRefInsertPos != null) {
    insertBlockAfterPos(block, pendingRefInsertPos)
  } else {
    insertBlockAtSelection(block)
  }
  pendingRefInsertPos = null
}

const scheduleHideHandle = () => {
  if (hideHandleTimer) return
  hideHandleTimer = setTimeout(() => {
    if (!handleMenuVisible.value) {
      handleVisible.value = false
      hoveredPos.value = null
    }
    hideHandleTimer = null
  }, 200)
}

const clearHideHandle = () => {
  if (hideHandleTimer) {
    clearTimeout(hideHandleTimer)
    hideHandleTimer = null
  }
}

const handleEditorMouseMove = (event: MouseEvent) => {
  if (!editor.value || !editorEl.value || !props.editable) return
  if (handleMenuVisible.value) return

  const wrapperRect = editorEl.value.getBoundingClientRect()
  const isInsideEditor = event.clientX >= wrapperRect.left
    && event.clientX <= wrapperRect.right
    && event.clientY >= wrapperRect.top
    && event.clientY <= wrapperRect.bottom
  if (!isInsideEditor) { scheduleHideHandle(); return }

  if (event.clientX < wrapperRect.left + HANDLE_GUTTER_WIDTH && handleVisible.value) {
    clearHideHandle()
    return
  }

  const pos = editor.value.view.posAtCoords({ left: event.clientX, top: event.clientY })
  if (!pos) { scheduleHideHandle(); return }

  const resolved = editor.value.state.doc.resolve(pos.pos)
  if (resolved.depth < 1) { scheduleHideHandle(); return }

  const node = resolved.node(1)
  if (!node || !LINE_NODE_TYPES.includes(node.type.name)) { scheduleHideHandle(); return }

  const domPos = editor.value.view.nodeDOM(resolved.before(1))
  if (!domPos || !(domPos instanceof HTMLElement)) { scheduleHideHandle(); return }

  const lineRect = domPos.getBoundingClientRect()
  const top = lineRect.top - wrapperRect.top
  const height = Math.max(28, lineRect.height)

  hoveredPos.value = pos.pos
  handleTop.value = top
  handleHeight.value = height
  handleVisible.value = true

  clearHideHandle()
}

const handleEditorMouseDown = (event: MouseEvent) => {
  if (!props.editable || event.button !== 0) return
  selectionPointerDown = true
  emit('selection-pointer-change', true)
}

const handleDocumentMouseUp = () => {
  if (!selectionPointerDown) return
  selectionPointerDown = false
  emit('selection-pointer-change', false)
}

const handleEditorMouseLeave = () => {
  scheduleHideHandle()
}

const handleHandleMenuVisibilityChange = (visible: boolean) => {
  handleMenuVisible.value = visible
  if (!visible) scheduleHideHandle()
}

const handleHandleSelect = (key: HandleAction) => {
  if (!editor.value || hoveredPos.value == null) return

  const resolved = editor.value.state.doc.resolve(hoveredPos.value)
  if (resolved.depth < 1) return

  const { from, to } = getBlockRange(resolved)

  if (insertOptions.some((option) => option.key === key)) {
    insertExternalBlockAfterPos(key as InsertBlockType, hoveredPos.value)
    handleVisible.value = false
    hoveredPos.value = null
    return
  }

  switch (key) {
    case 'cut': {
      const text = editor.value.state.doc.textBetween(from, to)
      navigator.clipboard.writeText(text).catch(() => {})
      editor.value.chain().focus().deleteRange({ from, to }).run()
      break
    }
    case 'copy': {
      const text = editor.value.state.doc.textBetween(from, to)
      navigator.clipboard.writeText(text).catch(() => {})
      break
    }
    case 'duplicate': {
      const slice = editor.value.state.doc.slice(from, to)
      editor.value.chain().focus().insertContentAt(to, slice.toJSON()).run()
      break
    }
    case 'clear-formatting':
      editor.value.chain().focus().setTextSelection({ from, to }).clearNodes().unsetAllMarks().run()
      break
    case 'delete':
      editor.value.chain().focus().deleteRange({ from, to }).run()
      break
  }

  handleVisible.value = false
  hoveredPos.value = null
}

const getSlashClientRect = (props: any) => {
  const rect = props.clientRect?.()
  if (rect) {
    slashMenuTop.value = rect.bottom + 8
    slashMenuLeft.value = rect.left
    return
  }
  slashMenuTop.value = 120
  slashMenuLeft.value = 120
}

const selectSlashOption = (option: InsertOption) => {
  if (!editor.value) return
  const range = currentSlashRange
  slashMenuVisible.value = false
  slashQuery.value = ''

  if (range) {
    editor.value.chain().focus().deleteRange(range).run()
  }
  insertExternalBlockAtSelection(option.key)
}

let currentSlashRange: { from: number; to: number } | null = null

const editor = useEditor({
  content: blocksToTipTap(props.blocks),
  editable: props.editable,
  autofocus: false,
  extensions: [
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
    AnnotationDecorations.configure({
      annotations: flattenedAnnotations.value,
      onAnnotationClick: (payload) => emit('annotation-click', payload),
      onAnnotationsMapped: (annotations) => emit('annotations-mapped', annotations),
    }),
    SelectionDecorations,
    BlockActions,
    SlashCommand.configure({
      suggestion: {
        items: ({ query }: { query: string }) => {
          const keyword = query.trim().toLowerCase()
          if (!keyword) return insertOptions
          return insertOptions.filter((option) => (
            option.label.toLowerCase().includes(keyword)
            || option.key.includes(keyword)
            || option.keywords.some((item) => item.includes(keyword))
          ))
        },
        render: () => ({
          onStart: (props: any) => {
            currentSlashRange = props.range
            slashQuery.value = props.query ?? ''
            slashMenuVisible.value = true
            getSlashClientRect(props)
          },
          onUpdate: (props: any) => {
            currentSlashRange = props.range
            slashQuery.value = props.query ?? ''
            slashMenuVisible.value = true
            getSlashClientRect(props)
          },
          onKeyDown: (props: any) => {
            if (props.event.key === 'Escape') {
              slashMenuVisible.value = false
              slashQuery.value = ''
              currentSlashRange = null
              return true
            }
            if (props.event.key === 'Enter' && filteredSlashOptions.value[0]) {
              selectSlashOption(filteredSlashOptions.value[0])
              return true
            }
            return false
          },
          onExit: () => {
            slashMenuVisible.value = false
            slashQuery.value = ''
            currentSlashRange = null
          },
        }),
      },
    }),
    X6BlockNode,
    TimelineBlockNode,
    RefBlockNode,
    SpacerBlockNode,
    TableBlockNode,
    ParagraphNode,
  ],
  editorProps: {
    attributes: {
      class: 'tu-editor-content',
    },
  },
  onCreate: () => {
    isInternalUpdate = false
    if (editor.value) {
      editor.value.view.dom.addEventListener('mousemove', handleEditorMouseMove)
      editor.value.view.dom.addEventListener('mouseleave', handleEditorMouseLeave)
      editor.value.view.dom.addEventListener('mousedown', handleEditorMouseDown)
      document.addEventListener('mouseup', handleDocumentMouseUp, true)
      lastDocSignature = getDocSignature()
    }
  },
  onUpdate: () => {
    if (isInternalUpdate || !editor.value) return
    const currentSignature = getDocSignature()
    if (currentSignature === lastDocSignature) return
    lastDocSignature = currentSignature
    if (debounceTimer) clearTimeout(debounceTimer)
    debounceTimer = setTimeout(() => {
      if (!isMounted || !editor.value) return
      const json = editor.value.getJSON()
      const blocks = tipTapToBlocks(json, props.blocks)
      skipNextContentSync = true
      emit('update:blocks', blocks)
      emit('content-change', blocks)
    }, 300)
  },
  onSelectionUpdate: () => {
    if (!isMounted || !editor.value) return
    const { empty, from, to } = editor.value.state.selection
    const text = empty ? '' : editor.value.state.doc.textBetween(from, to, ' ')
    const spannedBlockIds: string[] = []
    const spannedBlockMetadata: { blockId: string; blockType: string }[] = []
    if (!empty) {
      const seen = new Set<string>()
      editor.value.state.doc.nodesBetween(from!, to!, (node) => {
        const bid = node.attrs?.blockId
        if (node.type.isAtom && bid && !seen.has(bid) && node.type.name !== 'paragraph') {
          seen.add(bid)
          spannedBlockIds.push(bid)
          spannedBlockMetadata.push({ blockId: bid, blockType: node.type.name })
        }
        return true
      })
    }
    emit('selection-change', !empty, text, from, to, getBlockIdAtPos(from), spannedBlockIds.length ? spannedBlockIds : undefined, spannedBlockMetadata.length ? spannedBlockMetadata : undefined)
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
      // If the rebuilt doc spec matches the live doc, skip setContent. The
      // round-trip through tipTapToBlocks → blocksToTipTap normalizes attrs
      // the same way Tiptap does, so the comparison stays meaningful even
      // when ProseMirror would have stripped unknown attrs on parse. Without
      // this guard, every metadata-only blocks reassignment (tags, annotation
      // remap, etc.) tears down and rebuilds the doc, which is what made
      // interactive nodes like tables visibly rearrange after typing.
      const liveDocJson = editor.value.getJSON()
      const liveSpec = blocksToTipTap(tipTapToBlocks(liveDocJson, newBlocks))
      if (JSON.stringify(content) === JSON.stringify(liveSpec)) {
        lastDocSignature = JSON.stringify(liveDocJson)
        return
      }
      // Capture caret state before setContent rebuilds the doc — without this,
      // ProseMirror's selection mapping over a full doc replace clamps the
      // caret to the doc end whenever the new structure differs even slightly
      // from the live one (e.g. table cells re-rendered from saved data).
      const prevSelection = editor.value.state.selection
      const wasFocused = editor.value.isFocused
      editor.value.commands.setContent(content, { emitUpdate: false })
      const docSize = editor.value.state.doc.content.size
      const from = Math.min(prevSelection.from, docSize)
      const to = Math.min(prevSelection.to, docSize)
      if (from <= docSize && to <= docSize && from >= 0) {
        try {
          editor.value.commands.setTextSelection({ from, to })
        } catch {
          // Position may land inside a non-text node after the rebuild; let
          // Tiptap fall back to its default selection in that case.
        }
      }
      if (wasFocused) editor.value.commands.focus(undefined, { scrollIntoView: false })
      lastDocSignature = JSON.stringify(content)
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

watch(
  flattenedAnnotations,
  (annotations) => {
    if (!editor.value) return
    editor.value.view.dispatch(
      editor.value.state.tr.setMeta(annotationDecorationsKey, { annotations }),
    )
  },
  { deep: true },
)

onMounted(() => {
  isMounted = true
})

onBeforeUnmount(() => {
  isMounted = false
  if (debounceTimer) {
    clearTimeout(debounceTimer)
    debounceTimer = null
  }
  if (editor.value) {
    try {
      const view = (editor.value as any).view
      if (view) {
        view.dom.removeEventListener('mousemove', handleEditorMouseMove)
        view.dom.removeEventListener('mouseleave', handleEditorMouseLeave)
        view.dom.removeEventListener('mousedown', handleEditorMouseDown)
        document.removeEventListener('mouseup', handleDocumentMouseUp, true)
      }
    } catch {
      // view already destroyed by Tiptap internal cleanup
    }
  }
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
  completePendingRefInsert,
  focus: () => editor.value?.commands.focus(),
})
</script>

<template>
  <div ref="editorEl" class="tu-editor-wrapper">
    <editor-content :editor="editor" />
    <div
      v-if="slashMenuVisible && filteredSlashOptions.length > 0"
      class="slash-command-menu"
      :style="{ top: `${slashMenuTop}px`, left: `${slashMenuLeft}px` }"
      @mousedown.prevent
    >
      <button
        v-for="option in filteredSlashOptions"
        :key="option.key"
        type="button"
        class="slash-command-menu__item"
        @click="selectSlashOption(option)"
      >
        <span class="slash-command-menu__icon">{{ option.icon }}</span>
        <span class="slash-command-menu__label">{{ option.label }}</span>
      </button>
    </div>
    <HoverHandle
      v-if="hoverHandle && handleVisible && editor"
      ref="hoverHandleRef"
      :items="handleItems"
      :style="handlePositionStyle"
      :menu-min-width="'140px'"
      :menu-gap="4"
      @select="(key: string) => handleHandleSelect(key as HandleAction)"
      @menu-visibility-change="handleHandleMenuVisibilityChange"
    />
  </div>
</template>

<style scoped>
.tu-editor-wrapper {
  position: relative;
  width: 100%;
  min-height: 200px;
  --tiptap-handle-gutter: 44px;
}

.tu-editor-wrapper :deep(.tu-editor-content) {
  outline: none;
  min-height: 200px;
  padding: 8px 0 8px var(--tiptap-handle-gutter);
  line-height: 1.7;
  font-size: 15px;
  color: #333;
  box-sizing: border-box;
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

.tu-editor-wrapper :deep(.tu-tiptap-selection-retained) {
  background: rgba(22, 119, 255, 0.22);
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

.tu-editor-wrapper :deep(.is-editor-empty:first-child::before) {
  content: attr(data-placeholder);
  float: left;
  color: #adb5bd;
  pointer-events: none;
  height: 0;
}

.slash-command-menu {
  position: fixed;
  z-index: 1000003;
  display: flex;
  flex-direction: column;
  min-width: 190px;
  max-width: min(280px, calc(100vw - 24px));
  max-height: min(360px, calc(100vh - 24px));
  overflow: auto;
  padding: 6px;
  border: 1px solid #e5e7eb;
  border-radius: 8px;
  background: #ffffff;
  box-shadow: 0 16px 36px rgba(15, 23, 42, 0.14);
}

.slash-command-menu__item {
  display: flex;
  align-items: center;
  gap: 8px;
  width: 100%;
  padding: 8px 10px;
  border: 0;
  border-radius: 6px;
  background: transparent;
  color: #1f2937;
  cursor: pointer;
  text-align: left;
  font-size: 14px;
}

.slash-command-menu__item:hover {
  background: #f0f7ff;
  color: #0958d9;
}

.slash-command-menu__icon {
  width: 20px;
  text-align: center;
}

.slash-command-menu__label {
  flex: 1;
  min-width: 0;
}
</style>
