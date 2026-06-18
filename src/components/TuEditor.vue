<script setup lang="ts">
import { watch, onBeforeUnmount, onMounted, nextTick, ref, computed, provide, inject, type ComputedRef } from 'vue'
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
import type { Block, HeadingSourceBinding, TextAnnotation, SpannedBlockInfo } from '@/api/types'
import { uploadFile } from '@/api/fileStorage'
import {
  AnnotationDecorations,
  annotationDecorationsKey,
  BlockActions,
  SelectionDecorations,
  SlashCommand,
  X6BlockNode,
  TimelineBlockNode,
  RefBlockNode,
  ExternalResourceBlockNode,
  SpacerBlockNode,
  TableBlockNode,
  MultiTableBlockNode,
  ParagraphNode,
  HeadingNode,
  HeadingSourceDecorations,
  HeadingSectionFold,
  blocksToTipTap,
  tipTapToBlocks,
} from '@/editor'
import { getAnnotationSelectionPayload } from '@/editor/annotationText'
import { createGraphFromSource, createGraphSourceMetadata } from '@/utils/graphSources'
import { createMindmapStarterGraphData } from '@/components/x6'
import { createHeadingBlockId } from '@/utils/headingSource'
import { getContentScrollGutterAnchor } from '@/utils/editorGutterLayout'
import type { TocCollectContext } from '@/utils/toc/collectFlatTocEntries'
import { HEADING_SECTION_FOLD_META } from '@/utils/toc/tocSectionFoldActions'
import { getSectionFoldRevision } from '@/stores/sectionFoldSession'
import { useWorkspaceStore } from '@/stores/workspace'
import HoverHandle from './HoverHandle.vue'
import HeadingSectionFoldGutter from './HeadingSectionFoldGutter.vue'

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
  'open-resource-picker': []
  'open-tag-editor': [blockId: string]
  'heading-source-click': [binding: HeadingSourceBinding]
  'mark-block-excerpt': [blockId: string]
}>()

type InsertBlockType = 'richtext' | 'ref' | 'externalResource' | 'line' | 'x6' | 'x6-mindmap' | 'knowledge-roadmap' | 'table' | 'multiTable' | 'spacer'
type HandleAction = InsertBlockType | 'mark-excerpt' | 'cut' | 'copy' | 'duplicate' | 'clear-formatting' | 'delete'

interface InsertOption {
  key: InsertBlockType
  label: string
  icon: string
  keywords: string[]
}

const editorEl = ref<HTMLElement | null>(null)
const hoverHandleRef = ref<InstanceType<typeof HoverHandle> | null>(null)
const workspaceStore = useWorkspaceStore()
const tocCollectContext = inject<ComputedRef<TocCollectContext> | undefined>('tocCollectContext', undefined)
let debounceTimer: ReturnType<typeof setTimeout> | null = null
let isInternalUpdate = false
let skipNextContentSync = false
let isMounted = false
let pendingRefInsertPos: number | null = null
let pendingExternalResourceInsertPos: number | null = null
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

const handleFixedLeft = ref(0)
let hoveredLineEl: HTMLElement | null = null
let scrollContainer: HTMLElement | null = null

const handlePositionStyle = computed<CSSProperties>(() => ({
  position: 'fixed',
  left: `${handleFixedLeft.value}px`,
  top: `${handleTop.value}px`,
  height: `${handleHeight.value}px`,
  transform: 'translateX(-50%)',
}))

const insertOptions: InsertOption[] = [
  { key: 'richtext', label: '文本', icon: '📝', keywords: ['text', 'richtext', 'wenben'] },
  { key: 'ref', label: '引用', icon: '🔖', keywords: ['ref', 'reference', 'yinyong'] },
  { key: 'externalResource', label: '外部资源', icon: '▣', keywords: ['resource', 'external', 'book', 'ziyuan', 'tushu'] },
  { key: 'line', label: '时间轴', icon: '🕒', keywords: ['timeline', 'line', 'shijianzhou'] },
  { key: 'x6', label: 'X6 画板', icon: '🧩', keywords: ['x6', 'graph', 'draw', 'huaban'] },
  { key: 'x6-mindmap', label: '思维导图', icon: '◇', keywords: ['mindmap', '思维导图', '脑图', 'tree'] },
  { key: 'knowledge-roadmap', label: '知识库路线图', icon: '🗺️', keywords: ['roadmap', 'knowledge', 'kb', 'zhishiku'] },
  { key: 'table', label: '表格', icon: '▦', keywords: ['table', 'biaoge'] },
  { key: 'multiTable', label: '多维表格', icon: '▤', keywords: ['multi', 'database', 'kanban', 'duowei'] },
  { key: 'spacer', label: '分割空白', icon: '↕', keywords: ['spacer', 'blank', 'kongbai'] },
]

const handleItems = [
  { key: 'insert-divider', label: '插入', divider: true },
  ...insertOptions.map((option) => ({ key: option.key, label: option.label, icon: option.icon })),
  { key: 'action-divider', label: '操作', divider: true },
  { key: 'mark-excerpt', label: '标记节选', icon: '▣' },
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
      if ((ann.scope === 'compound' || ann.scope === 'block') && ann.spannedBlockIds?.length) {
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

// --- Lasso (multi-select) ---
const lassoSelectedBlockIds = ref(new Set<string>())
provide('lassoSelectedBlockIds', lassoSelectedBlockIds)

let lassoActive = false
let lassoStartX = 0
let lassoStartY = 0
let lassoListenersAttached = false
const lassoRect = ref<{ left: number; top: number; width: number; height: number } | null>(null)

function updateLassoSelection() {
  const rect = lassoRect.value
  if (!rect || !editorEl.value) return

  const wrappers = editorEl.value.querySelectorAll<HTMLElement>('[data-block-id]')
  const newSelection = new Set<string>()

  wrappers.forEach((el) => {
    const elRect = el.getBoundingClientRect()
    const overlap = !(
      rect.left + rect.width < elRect.left ||
      rect.left > elRect.left + elRect.width ||
      rect.top + rect.height < elRect.top ||
      rect.top > elRect.top + elRect.height
    )
    if (overlap) {
      const bid = el.getAttribute('data-block-id')
      if (bid) newSelection.add(bid)
    }
  })

  lassoSelectedBlockIds.value = newSelection
}

function startLasso(clientX: number, clientY: number) {
  lassoActive = true
  lassoStartX = clientX
  lassoStartY = clientY
  lassoRect.value = { left: clientX, top: clientY, width: 0, height: 0 }
  lassoSelectedBlockIds.value = new Set()

  if (lassoListenersAttached) return
  lassoListenersAttached = true

  document.addEventListener('mousemove', handleLassoMouseMove)
  document.addEventListener('mouseup', handleLassoMouseUp)
}

function handleLassoMouseMove(event: MouseEvent) {
  if (!lassoActive) return
  const x1 = Math.min(lassoStartX, event.clientX)
  const y1 = Math.min(lassoStartY, event.clientY)
  const x2 = Math.max(lassoStartX, event.clientX)
  const y2 = Math.max(lassoStartY, event.clientY)

  if (x2 - x1 < 5 && y2 - y1 < 5) return // Ignore tiny clicks

  lassoRect.value = { left: x1, top: y1, width: x2 - x1, height: y2 - y1 }
  updateLassoSelection()
}

function handleLassoMouseUp() {
  if (!lassoActive) return
  lassoActive = false
  lassoRect.value = null

  if (lassoListenersAttached) {
    lassoListenersAttached = false
    document.removeEventListener('mousemove', handleLassoMouseMove)
    document.removeEventListener('mouseup', handleLassoMouseUp)
  }
}

const handleDocumentKeyDown = (event: KeyboardEvent) => {
  if ((event.key === 'Delete' || event.key === 'Backspace') && lassoSelectedBlockIds.value.size > 0) {
    deleteLassoSelected()
    event.preventDefault()
  }
}

function clearLassoSelection() {
  lassoSelectedBlockIds.value = new Set()
}

function deleteLassoSelected() {
  if (!editor.value || lassoSelectedBlockIds.value.size === 0) return

  const ids = lassoSelectedBlockIds.value
  const doc = editor.value.state.doc

  // Find all top-level node positions matching lasso-selected blockIds
  const positions: number[] = []
  doc.descendants((node, pos) => {
    if (node.isBlock && node.attrs.blockId && ids.has(node.attrs.blockId)) {
      positions.push(pos)
    }
    return true
  })
  positions.sort((a, b) => b - a) // descending → delete from end to avoid offset shifts

  let tr = editor.value.state.tr
  for (const pos of positions) {
    const node = tr.doc.nodeAt(pos)
    if (node) tr = tr.delete(pos, pos + node.nodeSize)
  }
  tr.scrollIntoView()
  editor.value.view.dispatch(tr)
  clearLassoSelection()

  // Immediately flush content sync instead of waiting for 300ms debounce
  if (debounceTimer) {
    clearTimeout(debounceTimer)
    debounceTimer = null
  }
  if (isMounted && editor.value) {
    const json = editor.value.getJSON()
    const blocks = tipTapToBlocks(json, props.blocks)
    skipNextContentSync = true
    emit('update:blocks', blocks)
    emit('content-change', blocks)
  }
}

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

const TEXT_BLOCK_NODE_TYPES = new Set([
  'paragraph',
  'heading',
  'bulletList',
  'orderedList',
  'blockquote',
  'horizontalRule',
  'taskList',
  'image',
])

const collectSelectionBlockInfo = (from: number, to: number): {
  ids: string[]
  metadata: SpannedBlockInfo[]
} => {
  if (!editor.value) return { ids: [], metadata: [] }
  const seen = new Set<string>()
  const ids: string[] = []
  const metadata: SpannedBlockInfo[] = []
  let hasNonTextBlock = false

  editor.value.state.doc.nodesBetween(from, to, (node) => {
    const blockId = node.attrs?.blockId
    if (!blockId || seen.has(blockId)) return true
    if (!node.isBlock && !node.type.isAtom) return true

    const blockType = node.type.name
    if (!TEXT_BLOCK_NODE_TYPES.has(blockType)) {
      hasNonTextBlock = true
    }
    seen.add(blockId)
    ids.push(blockId)
    metadata.push({
      blockId,
      blockType,
      title: typeof node.attrs?.title === 'string' && node.attrs.title ? node.attrs.title : undefined,
    })
    return true
  })

  return ids.length > 1 || hasNonTextBlock
    ? { ids, metadata }
    : { ids: [], metadata: [] }
}

const getDocSignature = (): string => {
  if (!editor.value) return ''
  return JSON.stringify(editor.value.getJSON())
}

const flushContentChange = () => {
  if (debounceTimer) {
    clearTimeout(debounceTimer)
    debounceTimer = null
  }
  if (!isMounted || !editor.value) return
  lastDocSignature = getDocSignature()
  const json = editor.value.getJSON()
  const blocks = tipTapToBlocks(json, props.blocks)
  skipNextContentSync = true
  emit('update:blocks', blocks)
  emit('content-change', blocks)
}

provide('flushEditorContentChange', flushContentChange)

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
    case 'x6-mindmap':
      return {
        id,
        type: 'x6',
        title: '思维导图',
        graphData: createMindmapStarterGraphData(),
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
    case 'multiTable':
      return {
        id,
        type: 'multiTable',
        title: '多维表格',
        multiTableData: {
          fields: [],
          records: [],
          views: [
            { id: 'view-table', name: '表格', type: 'table' },
          ],
          activeViewId: 'view-table',
        },
      }
    case 'spacer':
      return { id, type: 'spacer', spacerHeight: 40 }
    case 'ref':
      return { id, type: 'ref', refId: '', refType: 'block' }
    case 'externalResource':
      return {
        id,
        type: 'externalResource',
        title: '外部资源',
        externalResource: {
          resourceItemId: '',
          resourceExcerptId: null,
          mode: 'resource',
          snapshot: { resourceTitle: '' },
        },
      }
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

const requestExternalResourceInsertAfterPos = (pos: number) => {
  pendingExternalResourceInsertPos = pos
  emit('open-resource-picker')
}

const insertExternalBlockAfterPos = (type: InsertBlockType, pos: number) => {
  if (type === 'ref') {
    requestRefInsertAfterPos(pos)
    return
  }
  if (type === 'externalResource') {
    requestExternalResourceInsertAfterPos(pos)
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
  if (type === 'externalResource') {
    pendingExternalResourceInsertPos = editor.value.state.selection.from
    emit('open-resource-picker')
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

const completePendingExternalResourceInsert = (block: Block) => {
  if (pendingExternalResourceInsertPos != null) {
    insertBlockAfterPos(block, pendingExternalResourceInsertPos)
  } else {
    insertBlockAtSelection(block)
  }
  pendingExternalResourceInsertPos = null
}

const handleScrollInEditor = () => {
  if (!handleVisible.value || !hoveredLineEl || !editorEl.value) return
  if (!document.contains(hoveredLineEl)) {
    handleVisible.value = false
    hoveredPos.value = null
    hoveredLineEl = null
    return
  }
  handleTop.value = hoveredLineEl.getBoundingClientRect().top
}

const scheduleHideHandle = () => {
  if (hideHandleTimer) return
  hideHandleTimer = setTimeout(() => {
    if (!handleMenuVisible.value) {
      handleVisible.value = false
      hoveredPos.value = null
      hoveredLineEl = null
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
  const gutter = getContentScrollGutterAnchor(editorEl.value)
  const isInsideEditor = event.clientX >= wrapperRect.left
    && event.clientX <= wrapperRect.right
    && event.clientY >= wrapperRect.top
    && event.clientY <= wrapperRect.bottom
  const isInLeftGutter = Boolean(
    gutter
    && event.clientX >= gutter.rect.left
    && event.clientX < wrapperRect.left
    && event.clientY >= wrapperRect.top
    && event.clientY <= wrapperRect.bottom,
  )
  if (!isInsideEditor && !isInLeftGutter) { scheduleHideHandle(); return }

  if (isInLeftGutter) {
    if (handleVisible.value) clearHideHandle()
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
  const height = Math.max(28, lineRect.height)

  hoveredLineEl = domPos
  handleFixedLeft.value = gutter?.hoverLeft ?? (wrapperRect.left - 24)
  hoveredPos.value = pos.pos
  handleTop.value = lineRect.top
  handleHeight.value = height
  handleVisible.value = true

  clearHideHandle()
}

// Lasso mousedown: capture phase so it fires BEFORE ProseMirror's handler and @*.stop
const handleLassoStart = (event: MouseEvent) => {
  if (!props.editable || event.button !== 0) return

  // Detect nodeView clicks (non-Shift) — capture phase bypasses @*.stop on nodeView roots
  if (!event.shiftKey) {
    const target = event.target as HTMLElement
    const nodeView = target.closest('[data-block-id]')
    if (nodeView) {
      const bid = nodeView.getAttribute('data-block-id')
      if (bid) emit('block-click', bid, event)
    }
    // Non-shift click clears lasso selection
    if (lassoSelectedBlockIds.value.size > 0) {
      clearLassoSelection()
    }
    return
  }

  const target = event.target as HTMLElement
  const nodeView = target.closest('[data-block-id]')

  if (nodeView) {
    const bid = nodeView.getAttribute('data-block-id')
    if (bid) {
      const next = new Set(lassoSelectedBlockIds.value)
      if (next.has(bid)) { next.delete(bid) } else { next.add(bid) }
      lassoSelectedBlockIds.value = next
    }
    event.preventDefault()
    event.stopPropagation()
    return
  }

  // Shift+click on empty area: start drag lasso, stop ProseMirror selection
  startLasso(event.clientX, event.clientY)
  event.preventDefault()
  event.stopPropagation()
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
    case 'mark-excerpt': {
      const blockId = resolved.node(1)?.attrs?.blockId as string | undefined
      if (blockId) emit('mark-block-excerpt', blockId)
      break
    }
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
      const json = slice.toJSON()
      if (json) {
        const assignNewId = (node: Record<string, any>) => {
          if (node.attrs?.blockId) {
            node.attrs.blockId = generateBlockId()
          }
          if (node.content) {
            for (const child of node.content) {
              assignNewId(child)
            }
          }
        }
        assignNewId(json)
      }
      editor.value.chain().focus().insertContentAt(to, json).run()
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

function findClipboardImageFile(clipboard: DataTransfer | null): File | null {
  if (!clipboard) return null
  const fromFiles = Array.from(clipboard.files).find((file) => file.type.startsWith('image/'))
  if (fromFiles) return fromFiles
  for (const item of Array.from(clipboard.items ?? [])) {
    if (!item.type.startsWith('image/')) continue
    const file = item.getAsFile()
    if (file) return file
  }
  return null
}

const editor = useEditor({
  content: blocksToTipTap(props.blocks),
  editable: props.editable,
  autofocus: false,
  extensions: [
    StarterKit.configure({
      heading: false,
      paragraph: false,
      codeBlock: false,
    }),
    HeadingNode.configure({ levels: [1, 2, 3, 4, 5, 6] }),
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
    HeadingSourceDecorations.configure({
      onSourceClick: (binding) => emit('heading-source-click', binding),
    }),
    HeadingSectionFold.configure({
      getTocContext: () => tocCollectContext?.value ?? null,
      getFoldRevision: () => getSectionFoldRevision(),
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
    ExternalResourceBlockNode,
    SpacerBlockNode,
    TableBlockNode,
    MultiTableBlockNode,
    ParagraphNode,
  ],
  editorProps: {
    attributes: {
      class: 'tu-editor-content',
      spellcheck: 'false',
    },
    handlePaste: (_view, event) => {
      if (!props.editable) return false
      const imageFile = findClipboardImageFile(event.clipboardData)
      if (!imageFile) return false

      event.preventDefault()
      void uploadFile(imageFile)
        .then((result) => {
          if (result.url) {
            editor.value?.chain().focus().setImage({ src: result.url }).run()
          }
        })
        .catch((error: unknown) => {
          console.error('[TuEditor] image upload failed', error)
        })
      return true
    },
    handleKeyDown: (view, event) => {
      if ((event.key === 'Delete' || event.key === 'Backspace') && lassoSelectedBlockIds.value.size > 0) {
        deleteLassoSelected()
        return true
      }
      return false
    },
  },
  onCreate: () => {
    isInternalUpdate = false
    if (editor.value) {
      editor.value.view.dom.addEventListener('mousemove', handleEditorMouseMove)
      editor.value.view.dom.addEventListener('mouseleave', handleEditorMouseLeave)
      editor.value.view.dom.addEventListener('mousedown', handleEditorMouseDown)
      document.addEventListener('mouseup', handleDocumentMouseUp, true)
      document.addEventListener('keydown', handleDocumentKeyDown)

      // nextTick so the template ref editorEl is available
      nextTick(() => {
        editorEl.value?.addEventListener('mousedown', handleLassoStart, { capture: true })
      })

      lastDocSignature = getDocSignature()

      scrollContainer = editor.value.view.dom.closest('.content-scroll') as HTMLElement | null
      if (scrollContainer) {
        scrollContainer.addEventListener('scroll', handleScrollInEditor, { passive: true })
      }
    }
  },
  onUpdate: ({ transaction }) => {
    if (isInternalUpdate || !editor.value) return
    if (transaction.getMeta(HEADING_SECTION_FOLD_META)) return
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
    const payload = empty ? null : getAnnotationSelectionPayload(editor.value.state.doc, from, to)
    const text = payload?.selectedText ?? ''
    const spanned = empty ? { ids: [], metadata: [] } : collectSelectionBlockInfo(from, to)
    emit('selection-change', !empty, text, from, to, payload?.blockId ?? getBlockIdAtPos(from), spanned.ids.length ? spanned.ids : undefined, spanned.metadata.length ? spanned.metadata : undefined)
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
  if (scrollContainer) {
    scrollContainer.removeEventListener('scroll', handleScrollInEditor)
    scrollContainer = null
  }
  // Clean up lasso listeners if still attached
  document.removeEventListener('keydown', handleDocumentKeyDown)
  if (lassoListenersAttached) {
    lassoListenersAttached = false
    document.removeEventListener('mousemove', handleLassoMouseMove)
    document.removeEventListener('mouseup', handleLassoMouseUp)
  }
  if (editor.value) {
    try {
      const view = (editor.value as any).view
      if (view) {
        view.dom.removeEventListener('mousemove', handleEditorMouseMove)
        view.dom.removeEventListener('mouseleave', handleEditorMouseLeave)
        view.dom.removeEventListener('mousedown', handleEditorMouseDown)
        document.removeEventListener('mouseup', handleDocumentMouseUp, true)
        document.removeEventListener('keydown', handleDocumentKeyDown)
        editorEl.value?.removeEventListener('mousedown', handleLassoStart, { capture: true })
      }
    } catch {
      // view already destroyed by Tiptap internal cleanup
    }
  }
  editor.value?.destroy()
})

function findBlockPos(doc: any, blockId: string): number | null {
  let pos: number | null = null
  doc.descendants((node: any, p: number) => {
    if (node.attrs?.blockId === blockId) { pos = p; return false }
    return true
  })
  return pos
}

function duplicateBlock(blockId: string) {
  const ed = editor.value
  if (!ed) return
  const pos = findBlockPos(ed.state.doc, blockId)
  if (pos === null) return
  const node = ed.state.doc.nodeAt(pos)
  if (!node) return
  const to = pos + node.nodeSize
  const slice = ed.state.doc.slice(pos, to)
  const json = slice.toJSON()
  if (json) {
    const assignNewId = (n: Record<string, any>) => {
      if (n.attrs?.blockId) n.attrs.blockId = generateBlockId()
      if (n.content) n.content.forEach(assignNewId)
    }
    assignNewId(json)
  }
  ed.chain().focus().insertContentAt(to, json).run()
}

function findHeadingAtSelection(): { pos: number; node: import('@tiptap/pm/model').Node } | null {
  const ed = editor.value
  if (!ed) return null
  const { $from } = ed.state.selection
  for (let depth = $from.depth; depth > 0; depth -= 1) {
    const node = $from.node(depth)
    if (node.type.name === 'heading') {
      return { pos: $from.before(depth), node }
    }
  }
  return null
}

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
      let rect: DOMRect | undefined
      editor.value.state.doc.nodesBetween(from, to, (node, pos) => {
        if (rect || !node.attrs?.blockId) return false
        const dom = editor.value?.view.nodeDOM(pos)
        if (dom instanceof HTMLElement) {
          rect = dom.getBoundingClientRect()
          return false
        }
        return true
      })
      const fallbackRect = rect
      if (!fallbackRect) return undefined
      return {
        top: fallbackRect.top,
        left: fallbackRect.left + fallbackRect.width / 2,
      }
    }
  },
  getSelectionJSON: () => {
    if (!editor.value) return null
    const { from, to, empty } = editor.value.state.selection
    if (empty) return null
    return editor.value.state.doc.slice(from, to).toJSON()
  },
  completePendingRefInsert,
  completePendingExternalResourceInsert,
  focus: () => editor.value?.commands.focus(),
  duplicateBlock,
  flushContentChange,
  isSelectionInHeading: () => Boolean(findHeadingAtSelection()),
  getHeadingSourceBindingAtSelection: () => {
    const found = findHeadingAtSelection()
    return (found?.node.attrs.sourceBinding as HeadingSourceBinding | null) ?? null
  },
  getHeadingTextAtSelection: () => findHeadingAtSelection()?.node.textContent.trim() || '',
  applyHeadingSourceBinding: (binding: HeadingSourceBinding) => {
    const found = findHeadingAtSelection()
    const ed = editor.value
    if (!found || !ed) return false
    const blockId = found.node.attrs.blockId || createHeadingBlockId()
    ed.chain().focus().command(({ tr }) => {
      tr.setNodeMarkup(found.pos, undefined, {
        ...found.node.attrs,
        blockId,
        sourceBinding: binding,
      })
      return true
    }).run()
    return true
  },
  clearHeadingSourceBinding: () => {
    const found = findHeadingAtSelection()
    const ed = editor.value
    if (!found || !ed) return false
    ed.chain().focus().command(({ tr }) => {
      tr.setNodeMarkup(found.pos, undefined, {
        ...found.node.attrs,
        sourceBinding: null,
      })
      return true
    }).run()
    return true
  },
})
</script>

<template>
  <div ref="editorEl" class="tu-editor-wrapper">
    <editor-content :editor="editor" />
    <HeadingSectionFoldGutter :editor="editor" :wrapper-el="editorEl" />
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
      @mouseenter="clearHideHandle"
    />
    <div
      v-if="lassoRect"
      class="lasso-selection-rect"
      :style="{
        left: `${lassoRect.left}px`,
        top: `${lassoRect.top}px`,
        width: `${lassoRect.width}px`,
        height: `${lassoRect.height}px`,
      }"
      @mousedown.prevent
      @mouseup.stop
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
  padding: 8px 28px 8px 0;
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

.tu-editor-wrapper :deep(.heading-section--collapsed) {
  display: none !important;
}

.tu-editor-wrapper :deep(.heading-section--collapsed-embed .ref-page-content),
.tu-editor-wrapper :deep(.heading-section--collapsed-embed .ref-block-card__content),
.tu-editor-wrapper :deep(.heading-section--collapsed-embed .external-resource-card__excerpt-editor) {
  display: none !important;
}

.tu-editor-wrapper :deep(.heading-section--embed-section-collapsed) {
  display: none !important;
}

.tu-editor-wrapper :deep(.tu-editor-content h1) { font-size: 2em; }
.tu-editor-wrapper :deep(.tu-editor-content h2) { font-size: 1.5em; }
.tu-editor-wrapper :deep(.tu-editor-content h3) { font-size: 1.25em; }
.tu-editor-wrapper :deep(.tu-editor-content h4) { font-size: 1.1em; }

.tu-editor-wrapper :deep(.heading-source-badge) {
  display: inline-flex;
  align-items: center;
  margin-left: 8px;
  padding: 1px 8px;
  border: 1px solid #bfdbfe;
  border-radius: 999px;
  background: #eff6ff;
  color: #075985;
  font-size: 11px;
  font-weight: 500;
  line-height: 1.4;
  vertical-align: middle;
  cursor: pointer;
  white-space: nowrap;
  max-width: 180px;
  overflow: hidden;
  text-overflow: ellipsis;
}

.tu-editor-wrapper :deep(.heading-source-badge:hover) {
  background: #dbeafe;
}

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

.lasso-selection-rect {
  position: fixed;
  z-index: 1000000;
  pointer-events: none;
  background: rgba(22, 119, 255, 0.06);
  border: 1px solid rgba(22, 119, 255, 0.35);
  border-radius: 3px;
}
</style>
