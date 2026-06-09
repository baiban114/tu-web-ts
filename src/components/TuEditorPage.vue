<script setup lang="ts">
import { ref, reactive, watch, computed, onMounted, onBeforeUnmount, nextTick, provide } from 'vue'
import { useRouter } from 'vue-router'
import type { Block, BlockTag, EmbeddedObject, ExternalResourceEmbedData, HeadingSourceBinding, PageContent, TextAnnotation, SpannedBlockInfo } from '@/api/types'
import { pageContentToTipTap, tipTapToPageContent } from '@/editor/converters'
import TuEditor from './TuEditor.vue'
import TocTreeList from './TocTreeList.vue'
import SelectionToolbar from './SelectionToolbar.vue'
import BlockPicker from './BlockPicker.vue'
import ExternalResourcePicker from './ExternalResourcePicker.vue'
import BlockMetadataTagEditor from './BlockMetadataTagEditor.vue'
import Toast from './Toast.vue'
import NoteEditor from './NoteEditor.vue'
import NotePopover from './NotePopover.vue'
import { useExpandCollapse } from '@/composables/useExpandCollapse'
import { useAnchoredFloating, type FloatingAnchorRect } from '@/composables/useAnchoredFloating'
import { blockSyncManager } from '@/utils/blockSyncManager'
import { useWorkspaceStore } from '@/stores/workspace'
import { collectBlockTags, getBlockTags, setBlockTags } from '@/utils/blockMetadata'
import { registerExternalUrlFromPaste } from '@/api/externalResource'
import { parseExternalUrl } from '@/utils/externalUrlResource'
import { getAnnotationSelectionPayload } from '@/editor/annotationText'
import { useBlockRegistryStore } from '@/stores/blockRegistry'
import type { Node as ProseMirrorNode } from '@tiptap/pm/model'
import {
  buildHeadingTree,
  type TocTreeItem,
} from '@/utils/toc/headings'
import { collectFlatTocEntries, type TocCollectContext } from '@/utils/toc/collectFlatTocEntries'

type LinkDisplayMode = 'link' | 'image'

type TocItem = TocTreeItem
const NODEVIEW_TYPES = ['x6Block', 'tableBlock', 'multiTableBlock', 'timelineBlock', 'spacerBlock', 'refBlock', 'externalResourceBlock']

const nodeViewToolbar = reactive({
  visible: false,
  blockId: '',
  sourceType: '',
  refId: '',
  canAddNote: false,
})

const EMBED_TOC_SOURCE_TYPES = new Set(['refBlock', 'externalResourceBlock'])

const tocSettingsPopover = reactive({
  visible: false,
  top: 0,
  left: 0,
})

const tocSettingsForm = reactive({
  titleLevel: 0,
  hideTitle: false,
})

const hideNodeViewToolbar = () => {
  nodeViewToolbar.visible = false
  nodeViewToolbar.canAddNote = false
  tocSettingsPopover.visible = false
}

const getNodeViewToolbarAnchor = (): FloatingAnchorRect | null => {
  if (!nodeViewToolbar.blockId) return null
  const editorDom = tuEditorRef.value?.editor?.view.dom
  const nodeView = editorDom?.querySelector<HTMLElement>(`[data-block-id="${CSS.escape(nodeViewToolbar.blockId)}"]`)
  return nodeView?.getBoundingClientRect() ?? null
}

const {
  position: nodeViewToolbarPosition,
  updatePosition: updateNodeViewToolbarPosition,
} = useAnchoredFloating({
  visible: computed({
    get: () => nodeViewToolbar.visible,
    set: (value) => { nodeViewToolbar.visible = value },
  }),
  getAnchorRect: getNodeViewToolbarAnchor,
  placement: 'top',
  offset: 40,
})

const deleteSelectedNodeView = () => {
  const editor = tuEditorRef.value?.editor
  if (editor && nodeViewToolbar.blockId) {
    editor.commands.deleteBlock(nodeViewToolbar.blockId)
  }
  hideNodeViewToolbar()
}

const duplicateSelectedNodeView = () => {
  if (nodeViewToolbar.blockId) {
    tuEditorRef.value?.duplicateBlock?.(nodeViewToolbar.blockId)
  }
  hideNodeViewToolbar()
}

const navigateToReferencedPage = async () => {
  if (nodeViewToolbar.refId) {
    hideNodeViewToolbar()
    await workspaceStore.selectPage(nodeViewToolbar.refId)
  }
}

const findEmbedNodeByBlockId = (blockId: string): { pos: number; node: ProseMirrorNode } | null => {
  const editor = tuEditorRef.value?.editor
  if (!editor || !blockId) return null
  let found: { pos: number; node: ProseMirrorNode } | null = null
  editor.state.doc.descendants((node, pos) => {
    if (node.attrs?.blockId === blockId && EMBED_TOC_SOURCE_TYPES.has(node.type.name)) {
      found = { pos, node }
      return false
    }
    return true
  })
  return found
}

const supportsEmbedTocSettings = (sourceType: string) => EMBED_TOC_SOURCE_TYPES.has(sourceType)

const readEmbedTocSettings = (blockId: string) => {
  const found = findEmbedNodeByBlockId(blockId)
  if (!found) return { titleLevel: 0, hideTitle: false }
  const metadata = (found.node.attrs?.metadata || {}) as { tocSettings?: { titleLevel?: number; hideTitle?: boolean } }
  const tocSettings = metadata.tocSettings || {}
  return {
    titleLevel: Number(found.node.attrs?.headingLevel ?? tocSettings.titleLevel ?? 0),
    hideTitle: Boolean(tocSettings.hideTitle),
  }
}

const openTocSettingsPopover = () => {
  if (!EMBED_TOC_SOURCE_TYPES.has(nodeViewToolbar.sourceType)) return
  const settings = readEmbedTocSettings(nodeViewToolbar.blockId)
  tocSettingsForm.titleLevel = settings.titleLevel
  tocSettingsForm.hideTitle = settings.hideTitle
  tocSettingsPopover.visible = true
  nextTick(() => {
    const toolbar = document.querySelector('.nodeview-toolbar')
    const rect = toolbar?.getBoundingClientRect()
    if (rect) {
      tocSettingsPopover.top = rect.bottom + 8
      tocSettingsPopover.left = rect.left
    }
  })
}

const closeTocSettingsPopover = () => {
  tocSettingsPopover.visible = false
}

const applyTocSettings = () => {
  const editor = tuEditorRef.value?.editor
  const blockId = nodeViewToolbar.blockId
  if (!editor || !blockId) return

  const found = findEmbedNodeByBlockId(blockId)
  if (!found) return

  const existingMetadata = { ...(found.node.attrs?.metadata as Record<string, unknown> || {}) }
  const hideTitle = nodeViewToolbar.sourceType === 'refBlock' && tocSettingsForm.hideTitle
  const titleLevel = hideTitle ? 0 : tocSettingsForm.titleLevel

  editor.chain().focus().command(({ tr, dispatch }) => {
    if (!dispatch) return true
    tr.setNodeMarkup(found!.pos, undefined, {
      ...found!.node.attrs,
      headingLevel: titleLevel,
      metadata: {
        ...existingMetadata,
        tocSettings: {
          titleLevel,
          hideTitle,
        },
      },
    })
    return true
  }).run()

  closeTocSettingsPopover()
}

const handleBlockClick = (blockId: string, event: MouseEvent) => {
  const editor = tuEditorRef.value?.editor
  if (!editor) return

  // Find block type from editor doc
  let typeName = ''
  editor.state.doc.descendants((node) => {
    if (node.attrs?.blockId === blockId) {
      typeName = node.type.name
      return false
    }
    return true
  })
  if (!NODEVIEW_TYPES.includes(typeName)) return

  const nodeViewEl = (event.target as HTMLElement).closest('[data-block-id]')
  if (!nodeViewEl) return
  nodeViewToolbar.canAddNote = canAddNoteFromSelection.value
  nodeViewToolbar.blockId = blockId
  nodeViewToolbar.sourceType = typeName
  nodeViewToolbar.refId = ''
  if (typeName === 'refBlock') {
    editor.state.doc.descendants((node) => {
      if (node.attrs?.blockId === blockId && node.attrs?.refId) {
        nodeViewToolbar.refId = node.attrs.refId
        return false
      }
      return true
    })
  }
  nodeViewToolbar.visible = true
  updateNodeViewToolbarPosition()
}

const handleToolbarDocClick = (e: MouseEvent) => {
  const toolbar = document.querySelector('.nodeview-toolbar')
  const tocPopover = document.querySelector('.toc-settings-popover')
  if (toolbar?.contains(e.target as Node)) return
  if (tocPopover?.contains(e.target as Node)) return
  if ((e.target as HTMLElement).closest('[data-block-id]')) return
  hideNodeViewToolbar()
}
const handleToolbarKeydown = (e: KeyboardEvent) => {
  if (e.key === 'Escape') hideNodeViewToolbar()
}

watch(() => nodeViewToolbar.visible, (visible, wasVisible) => {
  if (visible && !wasVisible) {
    nextTick(() => {
      document.addEventListener('click', handleToolbarDocClick)
      document.addEventListener('keydown', handleToolbarKeydown)
    })
  } else if (!visible && wasVisible) {
    document.removeEventListener('click', handleToolbarDocClick)
    document.removeEventListener('keydown', handleToolbarKeydown)
  }
})

const workspaceStore = useWorkspaceStore()
const router = useRouter()
const registryStore = useBlockRegistryStore()

interface Props {
  contentList: PageContent
  pageTitle?: string
  editable?: boolean
}

const props = withDefaults(defineProps<Props>(), {
  pageTitle: '',
  editable: true,
})

const emit = defineEmits<{
  'content-change': [contentList: PageContent]
  'page-title-change': [title: string]
}>()

// --- Core state ---
const localContent = ref('')
const localEmbeds = ref<EmbeddedObject[]>([])
const localAnnotations = ref<TextAnnotation[]>([])
const pageTitleDraft = ref('')
const pageTitleEditing = ref(false)
const tuEditorRef = ref<InstanceType<typeof TuEditor> | null>(null)
const showBlockPicker = ref(false)
const showResourcePicker = ref(false)
const resourcePickerMode = ref<'insert' | 'markExcerpt' | 'bindSource'>('insert')
const pendingResourceExcerptText = ref('')
const pendingResourceExcerptTitle = ref('')
const highlightedBlockId = ref<string | null>(null)
const tocExpanded = ref(true)

// Backward compat: convert PageContent → Block[] for template/TuEditor
const localBlocks = computed<Block[]>(() => {
  const blocks: Block[] = []
  if ((localContent.value || '').trim()) {
    blocks.push({
      id: 'page-content',
      type: 'richtext',
      content: localContent.value,
      metadata: { annotations: localAnnotations.value as unknown as any[] },
    })
  }
  for (const embed of localEmbeds.value || []) {
    blocks.push({
      id: embed.id,
      type: embed.type,
      title: embed.title,
      graphData: embed.graphData,
      tableData: embed.tableData,
      multiTableData: embed.multiTableData,
      timelineData: embed.timelineData,
      refId: embed.refId,
      refType: embed.refType,
      externalResource: embed.externalResource,
      spacerHeight: embed.spacerHeight,
      width: embed.width,
      height: embed.height,
      metadata: { ...embed.metadata, annotations: localAnnotations.value as unknown as any[] },
    })
  }
  return blocks
})

// --- Selection state ---
const hasSelection = ref(false)
const selectedText = ref('')
const selectionToolbarVisible = ref(false)
const selectionBlockIndex = ref(-1)
const selectionBlockId = ref('')
const selectionFrom = ref(0)
const selectionTo = ref(0)
const selectionSpannedBlockIds = ref<string[]>([])
const selectionSpannedBlockMetadata = ref<SpannedBlockInfo[]>([])
let selectionToolbarTimer: ReturnType<typeof setTimeout> | null = null
const selectionStateVersion = ref(0)

const isSelectionInHeading = computed(() => {
  selectionStateVersion.value
  return tuEditorRef.value?.isSelectionInHeading?.() ?? false
})

const headingSourceBindingAtSelection = computed(() => {
  selectionStateVersion.value
  return tuEditorRef.value?.getHeadingSourceBindingAtSelection?.() ?? null
})

const canAddNoteFromSelection = computed(() => {
  return hasSelection.value && (selectedText.value.trim().length > 0 || selectionSpannedBlockIds.value.length > 0)
})

const canMarkResourceExcerptFromSelection = computed(() => {
  return hasSelection.value && selectedText.value.trim().length > 0 && !isSelectionInHeading.value
})

const canMarkHeadingSourceFromSelection = computed(() => {
  return hasSelection.value && isSelectionInHeading.value
})

const canClearHeadingSourceFromSelection = computed(() => {
  return hasSelection.value && isSelectionInHeading.value && Boolean(headingSourceBindingAtSelection.value)
})

const canShowSelectionToolbar = computed(() => (
  canAddNoteFromSelection.value
  || canMarkResourceExcerptFromSelection.value
  || canMarkHeadingSourceFromSelection.value
  || canClearHeadingSourceFromSelection.value
))

const tocContextMenu = ref<{ visible: boolean; top: number; left: number; item: TocItem | null }>({
  visible: false,
  top: 0,
  left: 0,
  item: null,
})

const clearSelectionToolbarTimer = () => {
  if (selectionToolbarTimer !== null) {
    clearTimeout(selectionToolbarTimer)
    selectionToolbarTimer = null
  }
}

const hideSelectionToolbar = () => {
  clearSelectionToolbarTimer()
  selectionToolbarVisible.value = false
}

const getSelectionAnchor = (): FloatingAnchorRect | null => {
  const pos = tuEditorRef.value?.getSelectionPosition?.()
  if (!pos) return null
  return {
    top: pos.top,
    left: pos.left,
    right: pos.left,
    bottom: pos.top,
    width: 0,
    height: 0,
  }
}

const {
  position: selectionToolbarPosition,
  updatePosition: updateSelectionToolbarPosition,
} = useAnchoredFloating({
  visible: selectionToolbarVisible,
  getAnchorRect: getSelectionAnchor,
  placement: 'top',
  offset: 40,
})

// --- Toast ---
const toastMessages = ref<Array<{ id: string; message: string }>>([])
const toastEnabled = ref(true)

// --- Link popover ---
const linkPopoverVisible = ref(false)
const linkPopoverUrl = ref('')
const linkPopoverLabel = ref('')
const linkPopoverUrlInput = ref<HTMLInputElement | null>(null)

const {
  position: linkPopoverPosition,
  updatePosition: updateLinkPopoverPosition,
} = useAnchoredFloating({
  visible: linkPopoverVisible,
  getAnchorRect: getSelectionAnchor,
  placement: 'top',
  offset: 10,
})

// --- Inserted link toolbar ---
const insertedLinkToolbarVisible = ref(false)
const insertedLinkToolbar = ref({ url: '', label: '', display: 'link' as LinkDisplayMode, canShowAsImage: false })

const {
  position: insertedLinkToolbarPosition,
  updatePosition: updateInsertedLinkToolbarPosition,
} = useAnchoredFloating({
  visible: insertedLinkToolbarVisible,
  getAnchorRect: getSelectionAnchor,
  placement: 'top',
  offset: 44,
})

// --- Tag editor ---
const tagEditorState = ref({ visible: false, blockId: '', top: 0, left: 0 })
const tagEditorBlockTags = ref<BlockTag[]>([])

// --- Note / Annotation ---
const noteEditorVisible = ref(false)
const editingAnnotation = ref<TextAnnotation | undefined>()
const pendingNoteBlockId = ref('')
const pendingNoteSelectedText = ref('')
const pendingNoteContextBefore = ref('')
const pendingNoteContextAfter = ref('')
const pendingNoteFrom = ref(0)
const pendingNoteTo = ref(0)
const pendingNoteSpannedBlockIds = ref<string[]>([])
const pendingNoteSpannedBlockMetadata = ref<SpannedBlockInfo[]>([])
let annotationPersistTimer: ReturnType<typeof setTimeout> | null = null

const notePopoverVisible = ref(false)
const notePopoverAnnotation = ref<TextAnnotation | null>(null)
const notePopoverAnnotations = ref<TextAnnotation[]>([])
const notePopoverAnchor = ref<FloatingAnchorRect | null>(null)

const {
  position: notePopoverPosition,
  updatePosition: updateNotePopoverPosition,
} = useAnchoredFloating({
  visible: notePopoverVisible,
  getAnchorRect: () => notePopoverAnchor.value,
  placement: 'right',
  offset: 12,
})

// --- Watchers ---
const emitLocalContentChange = (content: string, embeds: EmbeddedObject[], annotations: TextAnnotation[]) => {
  emit('content-change', { content, embeds, annotations })
}

watch(
  () => props.contentList,
  (val) => {
    if (!val) return
    localContent.value = val.content
    localEmbeds.value = val.embeds
    localAnnotations.value = val.annotations
  },
  { immediate: true, deep: true },
)

watch(
  () => props.pageTitle,
  (val) => {
    if (pageTitleEditing.value) return
    pageTitleDraft.value = displayPageTitle(val)
  },
  { immediate: true },
)

function onPageTitleFocus() {
  pageTitleEditing.value = true
}

function onPageTitleBlur() {
  pageTitleEditing.value = false
  if (!pageTitleDraft.value.trim()) {
    pageTitleDraft.value = '未命名页面'
    emit('page-title-change', pageTitleDraft.value)
    return
  }
  pageTitleDraft.value = displayPageTitle(props.pageTitle)
}

function displayPageTitle(title: string) {
  const value = title.trim()
  return value && !/^p-[\w-]+$/.test(value) ? value : '未命名页面'
}

// --- Toast ---
const showToast = (message: string) => {
  if (!toastEnabled.value) return
  const id = `toast-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`
  toastMessages.value.push({ id, message })
}

const removeToast = (id: string) => {
  const idx = toastMessages.value.findIndex(t => t.id === id)
  if (idx >= 0) toastMessages.value.splice(idx, 1)
}

// --- Block sync ---
const handleBlocksChange = (blocks: Block[]) => {
  // Legacy: TuEditor still emits Block[], convert back to PageContent
  const tempPc: PageContent = { content: '', embeds: [], annotations: localAnnotations.value }
  let contentParts: string[] = []
  const embeds: EmbeddedObject[] = []

  for (const block of blocks) {
    if (block.type === 'richtext' || block.type === 'richText') {
      if (block.content) contentParts.push(block.content)
    } else {
      embeds.push({
        id: block.id,
        type: block.type as EmbeddedObject['type'],
        title: block.title,
        graphData: block.graphData,
        tableData: block.tableData,
        multiTableData: block.multiTableData,
        timelineData: block.timelineData,
        refId: block.refId,
        refType: block.refType,
        externalResource: block.externalResource,
        spacerHeight: block.spacerHeight,
        width: block.width,
        height: block.height,
        metadata: block.metadata,
      })
      contentParts.push(`<!--tu:embed id="${block.id}" type="${block.type}"-->`)
    }
  }

  localContent.value = contentParts.join('\n\n').replace(/\n{3,}/g, '\n\n').trim()
  localEmbeds.value = embeds
  emitLocalContentChange(localContent.value, localEmbeds.value, localAnnotations.value)
}

// --- Focus editor from title ---
const focusEditorFromStart = () => {
  const editor = tuEditorRef.value?.editor
  if (!editor) return
  editor.commands.focus()
  // Move cursor to the beginning of the document
  editor.commands.setTextSelection({ from: 1, to: 1 })
}

// --- Selection ---
const handleSelectionChange = (
  selHasSelection: boolean,
  selText: string,
  selFrom?: number,
  selTo?: number,
  selBlockId?: string,
  selSpannedBlockIds?: string[],
  selSpannedBlockMetadata?: SpannedBlockInfo[],
) => {
  clearSelectionToolbarTimer()

  hasSelection.value = selHasSelection
  selectedText.value = selText
  selectionFrom.value = selFrom ?? 0
  selectionTo.value = selTo ?? 0
  selectionBlockIndex.value = -1
  selectionBlockId.value = selBlockId ?? ''
  selectionSpannedBlockIds.value = selSpannedBlockIds ?? []
  selectionSpannedBlockMetadata.value = selSpannedBlockMetadata ?? []
  selectionStateVersion.value += 1

  if (selHasSelection && tuEditorRef.value) {
    updateSelectionToolbarPosition()
    selectionToolbarTimer = setTimeout(() => {
      selectionToolbarTimer = null
      selectionToolbarVisible.value = canShowSelectionToolbar.value
      updateSelectionToolbarPosition()
    }, 120)
  } else {
    hideSelectionToolbar()
  }
}

// --- Block picker ---
const handleOpenBlockPicker = () => {
  showBlockPicker.value = true
}

const handleOpenResourcePicker = () => {
  resourcePickerMode.value = 'insert'
  pendingResourceExcerptText.value = ''
  pendingResourceExcerptTitle.value = ''
  showResourcePicker.value = true
}

const getSelectionAnnotationPayload = (from: number, to: number) => {
  const editor = tuEditorRef.value?.editor
  if (!editor) return {
    selectedText: '',
    contextBefore: '',
    contextAfter: '',
    from: undefined,
    to: undefined,
    blockId: undefined,
  }
  return getAnnotationSelectionPayload(editor.state.doc, from, to)
}

const handleBlockPickerSelect = (target: { type: 'block' | 'page'; id: string }) => {
  tuEditorRef.value?.completePendingRefInsert?.(target.id, target.type)
  showBlockPicker.value = false
}

const handleResourcePickerSelect = (selection: { title: string; externalResource: ExternalResourceEmbedData }) => {
  const block: Block = {
    id: 'external-resource-' + Date.now() + '-' + Math.random().toString(36).slice(2, 8),
    type: 'externalResource',
    title: selection.title,
    externalResource: selection.externalResource,
  }
  tuEditorRef.value?.completePendingExternalResourceInsert?.(block)
  showResourcePicker.value = false
}

const normalizeResourceExcerptSelectionText = (value: string): string => {
  let text = value.trim()
  const wrappedQuote = text.match(/^\{>\s*([\s\S]*?)\s*\}$/)
  if (wrappedQuote) text = wrappedQuote[1].trim()
  else text = text.replace(/^\{>\s*/, '').replace(/\s*\}$/, '').trim()
  text = text
    .split(/\r?\n/)
    .map((line) => line.replace(/^\s*>\s?/, ''))
    .join('\n')
    .trim()
  return text
}

const buildResourceExcerptTitle = (text: string): string => {
  const firstLine = text
    .split(/\r?\n/)
    .map((line) => line.trim())
    .find(Boolean) || '来自文档的节选'
  return firstLine
    .replace(/^#+\s+/, '')
    .replace(/^[-*]\s+/, '')
    .replace(/^\d+\.\s+/, '')
    .slice(0, 80)
}

const handleMarkResourceExcerptFromSelection = () => {
  if (!canMarkResourceExcerptFromSelection.value) return
  const payload = getSelectionAnnotationPayload(selectionFrom.value, selectionTo.value)
  const excerptText = normalizeResourceExcerptSelectionText(payload.selectedText || selectedText.value)
  if (!excerptText) return
  pendingResourceExcerptText.value = excerptText
  pendingResourceExcerptTitle.value = buildResourceExcerptTitle(excerptText)
  resourcePickerMode.value = 'markExcerpt'
  showResourcePicker.value = true
  hideSelectionToolbar()
}

const handleResourceExcerptCreated = (payload: { excerpt: { title: string } }) => {
  showResourcePicker.value = false
  resourcePickerMode.value = 'insert'
  pendingResourceExcerptText.value = ''
  pendingResourceExcerptTitle.value = ''
  hasSelection.value = false
  showToast(`已创建外部资源节选：${payload.excerpt.title}`)
}

const navigateToHeadingSource = (binding: HeadingSourceBinding) => {
  void router.push({
    path: '/resources',
    query: {
      tab: 'items',
      itemId: binding.resourceItemId,
      excerptId: binding.resourceExcerptId,
    },
  })
}

const handleHeadingSourceClick = (binding: HeadingSourceBinding) => {
  navigateToHeadingSource(binding)
}

const handleMarkHeadingSourceFromSelection = () => {
  if (!canMarkHeadingSourceFromSelection.value) return
  const headingText = tuEditorRef.value?.getHeadingTextAtSelection?.() || selectedText.value.trim()
  pendingResourceExcerptText.value = ''
  pendingResourceExcerptTitle.value = headingText
  resourcePickerMode.value = 'bindSource'
  showResourcePicker.value = true
  hideSelectionToolbar()
}

const handleClearHeadingSourceFromSelection = () => {
  if (!canClearHeadingSourceFromSelection.value) return
  tuEditorRef.value?.clearHeadingSourceBinding?.()
  tuEditorRef.value?.flushContentChange?.()
  hideSelectionToolbar()
  showToast('已解除标题来源')
}

const handleBindHeadingSource = (payload: { binding: HeadingSourceBinding }) => {
  tuEditorRef.value?.applyHeadingSourceBinding?.(payload.binding)
  tuEditorRef.value?.flushContentChange?.()
  showResourcePicker.value = false
  resourcePickerMode.value = 'insert'
  pendingResourceExcerptText.value = ''
  pendingResourceExcerptTitle.value = ''
  showToast(`已标记标题来源：${payload.binding.snapshot.excerptTitle || payload.binding.snapshot.resourceTitle || '外部资源'}`)
}

const focusHeadingAtTocItem = (item: TocItem) => {
  const editor = tuEditorRef.value?.editor
  if (!editor) return
  const from = Math.max(1, Math.min(item.pos + 1, editor.state.doc.content.size - 1))
  editor.commands.setTextSelection({ from, to: from })
}

const closeTocContextMenu = () => {
  tocContextMenu.value.visible = false
  tocContextMenu.value.item = null
}

const handleTocContextMenu = (item: TocItem, event: MouseEvent) => {
  if (item.sourceType !== 'local') return
  event.preventDefault()
  tocContextMenu.value = {
    visible: true,
    top: event.clientY,
    left: event.clientX,
    item,
  }
}

const handleTocMarkSource = () => {
  const item = tocContextMenu.value.item
  if (!item) return
  focusHeadingAtTocItem(item)
  pendingResourceExcerptText.value = ''
  pendingResourceExcerptTitle.value = item.text
  resourcePickerMode.value = 'bindSource'
  showResourcePicker.value = true
  closeTocContextMenu()
}

const handleTocClearSource = () => {
  const item = tocContextMenu.value.item
  if (!item?.sourceBinding) return
  focusHeadingAtTocItem(item)
  tuEditorRef.value?.clearHeadingSourceBinding?.()
  tuEditorRef.value?.flushContentChange?.()
  closeTocContextMenu()
  showToast('已解除标题来源')
}

const handleTocSourceClick = (item: TocItem) => {
  if (!item.sourceBinding) return
  navigateToHeadingSource(item.sourceBinding)
}

const handleResourcePickerVisibleChange = (visible: boolean) => {
  showResourcePicker.value = visible
  if (!visible) {
    resourcePickerMode.value = 'insert'
    pendingResourceExcerptText.value = ''
    pendingResourceExcerptTitle.value = ''
  }
}

// --- TOC ---
const tocExpand = useExpandCollapse()

const getTocExpandKey = (item: TocItem): string => item.id

const allExpandableTocIds = computed(() => {
  const ids: string[] = []
  const walk = (items: TocItem[]) => {
    for (const item of items) {
      if (item.children?.length) ids.push(getTocExpandKey(item))
      if (item.children) walk(item.children)
    }
  }
  walk(tocItems.value)
  return ids
})

const allTocItemsExpanded = computed(() => {
  const ids = allExpandableTocIds.value
  return ids.length > 0 && ids.every(id => tocExpand.isExpanded(id))
})

const toggleAllTocItems = () => {
  const ids = allExpandableTocIds.value
  if (ids.length === 0) return
  if (allTocItemsExpanded.value) tocExpand.collapseAll()
  else tocExpand.expandAll(ids)
}

const toggleTocItem = (item: TocItem) => {
  if (item.children?.length) tocExpand.toggle(getTocExpandKey(item))
}

const isTocItemExpanded = (item: TocItem): boolean => {
  return tocExpand.isExpanded(getTocExpandKey(item))
}

/** Walk workspace page tree to find a page title by pageId. */
function findPageTitle(pageId: string): string {
  const walk = (items: Array<{ id: string; title: string; children?: any[] }>): string | undefined => {
    for (const item of items) {
      if (item.id === pageId) return item.title
      if (item.children?.length) {
        const found = walk(item.children)
        if (found) return found
      }
    }
    return undefined
  }
  return walk(workspaceStore.pageTree) ?? pageId
}

const tocCollectContext = computed<TocCollectContext>(() => ({
  blocks: localBlocks.value,
  getPageBlocks: (pageId: string) => registryStore.getPageBlocks(pageId),
  getBlock: (id: string) => registryStore.getBlock(id),
  getBlockMeta: (id: string) => registryStore.getMeta(id),
  getPageTitle: findPageTitle,
}))

provide('tocCollectContext', tocCollectContext)

const tocItems = computed<TocItem[]>(() => {
  const editor = tuEditorRef.value?.editor
  if (!editor) return []

  const flat = collectFlatTocEntries(editor.state.doc, tocCollectContext.value)
  if (flat.length === 0) return []
  return buildHeadingTree(flat)
})

/** Total flat heading count counting group children. */
const tocFlatCount = computed(() => {
  const count = (items: TocItem[]): number => {
    let n = 0
    for (const item of items) {
      n += 1
      if (item.children) n += count(item.children)
    }
    return n
  }
  return count(tocItems.value)
})

const getEditorScrollContainer = (): HTMLElement | Window => {
  const editorDom = tuEditorRef.value?.editor?.view.dom
  return editorDom?.closest('.content-scroll') as HTMLElement | null ?? window
}

const scrollElementIntoEditorView = (el: HTMLElement) => {
  const scrollContainer = getEditorScrollContainer()
  if (scrollContainer instanceof HTMLElement) {
    const containerRect = scrollContainer.getBoundingClientRect()
    const elRect = el.getBoundingClientRect()
    const targetTop = scrollContainer.scrollTop + elRect.top - containerRect.top - 88
    scrollContainer.scrollTo({ top: Math.max(0, targetTop), behavior: 'smooth' })
    return
  }
  el.scrollIntoView({ behavior: 'smooth', block: 'center' })
}

const findHeadingInEmbedBlock = (blockId: string, headingText?: string): HTMLElement | null => {
  if (!headingText) return null
  const editorDom = tuEditorRef.value?.editor?.view.dom
  const embedRoot = editorDom?.querySelector<HTMLElement>(`[data-block-id="${CSS.escape(blockId)}"]`)
  if (!embedRoot) return null
  const contentRoot = embedRoot.querySelector<HTMLElement>(
    '.ref-page-content, .ref-block-card__content, .external-resource-card',
  ) ?? embedRoot
  const headings = contentRoot.querySelectorAll<HTMLElement>('h1,h2,h3,h4,h5,h6')
  for (const heading of headings) {
    if (heading.textContent?.trim() === headingText.trim()) return heading
  }
  return null
}

const findTocTargetElement = (item: TocItem): HTMLElement | null => {
  if (item.sourceType === 'ref-child') {
    return findHeadingInEmbedBlock(item.blockId, item.targetText || item.text)
  }

  const editor = tuEditorRef.value?.editor
  if (!editor) return null

  const nodeDom = editor.view.nodeDOM(item.pos)
  if (nodeDom instanceof HTMLElement) return nodeDom
  if (nodeDom instanceof Text) return nodeDom.parentElement

  const editorDom = editor.view.dom
  if (item.blockId) {
    const byBlockId = editorDom.querySelector<HTMLElement>(`[data-block-id="${CSS.escape(item.blockId)}"]`)
    if (byBlockId) return byBlockId
  }

  try {
    const coords = editor.view.coordsAtPos(item.pos)
    const element = document.elementFromPoint(coords.left, coords.top)
    return element instanceof HTMLElement ? element.closest<HTMLElement>('.ProseMirror > *') ?? element : null
  } catch {
    return null
  }
}

const handleTocItemClick = (item: TocItem) => {
  const editor = tuEditorRef.value?.editor
  if (!editor) return

  const docSize = editor.state.doc.content.size
  const from = Math.max(0, Math.min(item.pos, docSize))
  const targetNode = editor.state.doc.nodeAt(from)
  try {
    if (targetNode?.isTextblock || targetNode?.isInline) {
      editor.commands.setTextSelection({ from, to: from + 1 })
    } else if (targetNode) {
      editor.commands.setNodeSelection(from)
    }
    const targetEl = findTocTargetElement(item)
    if (targetEl) scrollElementIntoEditorView(targetEl)
    else editor.commands.scrollIntoView()
    highlightedBlockId.value = item.blockId
    setTimeout(() => { highlightedBlockId.value = null }, 2000)
  } catch {
    // Position may be stale after editor rebuild; ignore silently
  }
}

// --- Link insertion ---
const isImageUrl = (url: string): boolean => {
  try {
    const parsed = new URL(url)
    return /\.(png|jpe?g|gif|webp|svg|avif|bmp)(\?.*)?$/i.test(parsed.pathname + parsed.search)
  } catch {
    return /\.(png|jpe?g|gif|webp|svg|avif|bmp)(\?.*)?$/i.test(url)
  }
}

const handleInsertLinkButtonClick = () => {
  const editor = tuEditorRef.value?.editor
  if (!editor) return
  const { from, to } = editor.state.selection
  if (from === to) {
    showToast('请先选中文字后再插入链接')
    return
  }

  const label = editor.state.doc.textBetween(from, to, ' ')

  linkPopoverUrl.value = ''
  linkPopoverLabel.value = label
  linkPopoverVisible.value = true
  updateLinkPopoverPosition()
  nextTick(() => linkPopoverUrlInput.value?.focus())
}

const closeLinkPopover = () => {
  linkPopoverVisible.value = false
  linkPopoverUrl.value = ''
  linkPopoverLabel.value = ''
}

const submitLinkPopover = () => {
  const editor = tuEditorRef.value?.editor
  if (!editor || !linkPopoverUrl.value.trim()) return

  const url = linkPopoverUrl.value.trim()
  const label = linkPopoverLabel.value || url

  editor.chain().focus().setLink({ href: url }).run()
  const excerptText = label.trim() && label.trim() !== url ? label.trim() : undefined
  registerExternalLinkResource(url, label, excerptText)
  showInsertedLinkToolbar(url, label)
  closeLinkPopover()
}

const registerExternalLinkResource = (url: string, label: string, excerptText?: string) => {
  void registerExternalUrlFromPaste(url, { label, excerptText })
    .then((result) => {
      if (result.mode === 'excerpt') {
        if (result.createdExcerpt) {
          showToast('链接已登记为页面节选（已创建父级网络资源）')
        } else {
          showToast('链接已关联到已有页面节选')
        }
        return
      }
      showToast(result.createdItem ? '链接已登记为网络资源实体' : '链接已关联到已有网络资源')
    })
    .catch((error) => {
      console.warn('Failed to register external link resource:', error)
      showToast('链接已插入，但外部资源登记失败')
    })
}

const showInsertedLinkToolbar = (url: string, label: string) => {
  const display: LinkDisplayMode = isImageUrl(url) ? 'image' : 'link'
  insertedLinkToolbar.value = {
    url,
    label,
    display,
    canShowAsImage: isImageUrl(url),
  }
  insertedLinkToolbarVisible.value = true
  updateInsertedLinkToolbarPosition()
}

const closeInsertedLinkToolbar = () => {
  insertedLinkToolbarVisible.value = false
}

const updateInsertedLinkDisplay = (display: LinkDisplayMode) => {
  insertedLinkToolbar.value.display = display
}

// --- Paste URL detection ---
const normalizePastedUrl = (text: string): string | null => parseExternalUrl(text)?.href ?? null

// --- Extract selection ---
const handleExtractSelectionButtonClick = () => {
  const editor = tuEditorRef.value?.editor
  if (!editor) return
  const { from, to } = editor.state.selection
  if (from === to) {
    showToast('请先选中文字后再提取')
    return
  }
  const text = editor.state.doc.textBetween(from, to, ' ')
  if (text) {
    editor.chain()
      .focus()
      .insertContent(`<p>${text}</p>`)
      .run()
  }
}

// --- Tag editor ---
const handleOpenTagEditor = (_blockId: string) => {
  tagEditorBlockTags.value = []
  tagEditorState.value = {
    visible: true,
    blockId: '',
    top: window.innerHeight / 2 - 160,
    left: window.innerWidth / 2 - 160,
  }
}

const closeTagEditor = () => {
  tagEditorState.value.visible = false
  tagEditorState.value.blockId = ''
}

const updateBlockTags = (_tags: BlockTag[]) => {
  // Tags are page-level in the new model — handled by metadata
}

const availableTags = computed(() => collectBlockTags(localBlocks.value))
const editorAnnotations = computed(() => {
  // All annotations apply to the entire page content
  if ((localAnnotations.value || []).length) {
    return { 'page-content': localAnnotations.value ?? [] } as Record<string, TextAnnotation[]>
  }
  return {} as Record<string, TextAnnotation[]>
})
const allAnnotations = computed(() => localAnnotations.value)

// --- Note / Annotation ---
const handleAddNoteFromSelection = () => {
  const payload = getSelectionAnnotationPayload(selectionFrom.value, selectionTo.value)
  const hasText = !!payload.selectedText
  if (!hasText && selectionSpannedBlockIds.value.length === 0) return

  pendingNoteBlockId.value = ''
  pendingNoteSelectedText.value = payload.selectedText
  pendingNoteContextBefore.value = payload.contextBefore
  pendingNoteContextAfter.value = payload.contextAfter
  pendingNoteFrom.value = payload.from ?? selectionFrom.value
  pendingNoteTo.value = payload.to ?? selectionTo.value
  pendingNoteSpannedBlockIds.value = selectionSpannedBlockIds.value
  pendingNoteSpannedBlockMetadata.value = selectionSpannedBlockMetadata.value

  editingAnnotation.value = undefined
  noteEditorVisible.value = true
}

const handleSaveAnnotation = (note: string) => {
  const now = Date.now()
  const existing = editingAnnotation.value
  const annotations = localAnnotations.value

  if (existing) {
    const idx = annotations.findIndex(a => a.id === existing.id)
    if (idx >= 0) {
      annotations[idx] = { ...existing, note, updatedAt: now }
    }
  } else {
    const hasText = !!pendingNoteSelectedText.value
    const hasSpannedBlocks = pendingNoteSpannedBlockIds.value.length > 0
    const isBlockOnly = !hasText && hasSpannedBlocks
    const scope: 'text' | 'block' | 'compound' = isBlockOnly ? 'block' : hasSpannedBlocks ? 'compound' : 'text'
    const spannedBlockMetadata = hasSpannedBlocks
      ? normalizeSpannedBlockMetadata(pendingNoteSpannedBlockIds.value, pendingNoteSpannedBlockMetadata.value)
      : undefined
    const annotation: TextAnnotation = {
      id: `annot-${now}-${Math.random().toString(36).substr(2, 6)}`,
      selectedText: pendingNoteSelectedText.value,
      contextBefore: pendingNoteContextBefore.value,
      contextAfter: pendingNoteContextAfter.value,
      note,
      color: scope === 'compound' ? '#A5D6A7' : scope === 'block' ? '#90CAF9' : '#FFEB3B',
      createdAt: now,
      updatedAt: now,
      from: hasText ? pendingNoteFrom.value : undefined,
      to: hasText ? pendingNoteTo.value : undefined,
      blockId: '',
      anchorVersion: hasText ? 1 : undefined,
      lastResolvedAt: hasText ? now : undefined,
      unresolved: false,
      scope,
      spannedBlockIds: hasSpannedBlocks ? pendingNoteSpannedBlockIds.value : undefined,
      spannedBlockMetadata,
    }
    annotations.push(annotation)
  }

  localAnnotations.value = [...annotations]
  emitLocalContentChange(localContent.value, localEmbeds.value, localAnnotations.value)

  noteEditorVisible.value = false
  editingAnnotation.value = undefined
  hasSelection.value = false
  hideSelectionToolbar()
  selectionBlockIndex.value = -1
  selectionBlockId.value = ''
  pendingNoteBlockId.value = ''
  pendingNoteSelectedText.value = ''
  pendingNoteFrom.value = 0
  pendingNoteTo.value = 0
  pendingNoteSpannedBlockIds.value = []
  pendingNoteSpannedBlockMetadata.value = []
}

const sortAnnotationsByTimeDesc = (annotations: TextAnnotation[]) => {
  return [...annotations].sort((a, b) => (b.updatedAt || b.createdAt || 0) - (a.updatedAt || a.createdAt || 0))
}

const rectFromPoint = (clientX: number, clientY: number): FloatingAnchorRect => ({
  top: clientY,
  left: clientX,
  right: clientX,
  bottom: clientY,
  width: 0,
  height: 0,
})

const handleAnnotationClick = (payload: { annotationId: string; annotationIds?: string[]; event: MouseEvent }) => {
  const annotations = getBlockAnnotations()
  const ids = payload.annotationIds?.length ? payload.annotationIds : [payload.annotationId]
  const idSet = new Set(ids)
  const matched = sortAnnotationsByTimeDesc(annotations.filter(a => idSet.has(a.id)))
  const annotation = matched[0] ?? annotations.find(a => a.id === payload.annotationId)
  if (!annotation) return
  notePopoverAnnotation.value = annotation
  notePopoverAnnotations.value = matched.length ? matched : [annotation]
  notePopoverAnchor.value = (payload.event.target as HTMLElement | null)
    ?.closest('[data-tu-annotation-id]')
    ?.getBoundingClientRect()
    ?? rectFromPoint(payload.event.clientX, payload.event.clientY)
  notePopoverVisible.value = true
  updateNotePopoverPosition()
}

const getBlockAnnotations = (): TextAnnotation[] => {
  return localAnnotations.value
}

const getBlockDisplayType = (block: Block | undefined, fallback: string): string => {
  if (!block) return fallback
  if (block.type === 'x6') return 'x6Block'
  if (block.type === 'line') return 'timelineBlock'
  if (block.type === 'ref') return 'refBlock'
  if (block.type === 'spacer') return 'spacerBlock'
  if (block.type === 'table') return 'tableBlock'
  if (block.type === 'multiTable') return 'multiTableBlock'
  if (block.type === 'externalResource') return 'externalResourceBlock'
  if (block.type === 'richtext' || block.type === 'richText') return 'paragraph'
  return block.type || fallback
}

const normalizeSpannedBlockMetadata = (
  blockIds: string[],
  metadata: SpannedBlockInfo[],
): SpannedBlockInfo[] => {
  const byId = new Map(metadata.map(item => [item.blockId, item]))
  return blockIds.map((blockId) => {
    const embed = localEmbeds.value.find(e => e.id === blockId)
    const existing = byId.get(blockId)
    return {
      blockId,
      blockType: embed?.type || existing?.blockType || 'block',
      title: existing?.title || embed?.title,
    }
  })
}

const handleAnnotationsMapped = (mappedAnnotations: TextAnnotation[]) => {
  if (annotationPersistTimer) clearTimeout(annotationPersistTimer)
  annotationPersistTimer = setTimeout(() => {
    annotationPersistTimer = null
    const byId = new Map(mappedAnnotations.map((a) => [a.id, a]))
    const next = localAnnotations.value.map((a) => byId.get(a.id) ?? a)
    const changed = next.some((a, i) => {
      const prev = localAnnotations.value[i]
      return prev.from !== a.from || prev.to !== a.to || prev.unresolved !== a.unresolved || prev.anchorVersion !== a.anchorVersion
    })
    if (changed) {
      localAnnotations.value = next
      emitLocalContentChange(localContent.value, localEmbeds.value, localAnnotations.value)
    }
  }, 400)
}

const handleCompoundBadgeClick = (_blockId: string, annotationId: string, clientY: number, clientX: number) => {
  const related = sortAnnotationsByTimeDesc(localAnnotations.value.filter(a => a.id === annotationId))
  const annotation = related[0] ?? localAnnotations.value.find(a => a.id === annotationId)
  if (!annotation) return
  notePopoverAnnotation.value = annotation
  notePopoverAnnotations.value = related.length ? related : [annotation]
  notePopoverAnchor.value = rectFromPoint(clientX, clientY)
  notePopoverVisible.value = true
  updateNotePopoverPosition()
}

const handleEditAnnotation = (annotation?: TextAnnotation) => {
  const target = annotation ?? notePopoverAnnotation.value
  if (!target) return

  pendingNoteBlockId.value = ''
  pendingNoteSelectedText.value = target.selectedText
  pendingNoteContextBefore.value = target.contextBefore
  pendingNoteContextAfter.value = target.contextAfter
  editingAnnotation.value = { ...target }
  noteEditorVisible.value = true
  notePopoverVisible.value = false
}

const handleDeleteAnnotation = (annotation?: TextAnnotation) => {
  const target = annotation ?? notePopoverAnnotation.value
  if (!target) return

  localAnnotations.value = localAnnotations.value.filter(a => a.id !== target.id)
  emitLocalContentChange(localContent.value, localEmbeds.value, localAnnotations.value)

  notePopoverAnnotations.value = notePopoverAnnotations.value.filter(item => item.id !== target.id)
  notePopoverAnnotation.value = notePopoverAnnotations.value[0] ?? null
  notePopoverVisible.value = notePopoverAnnotations.value.length > 0
  if (!notePopoverVisible.value) notePopoverAnchor.value = null
}

// --- Document tail insert ---
const shouldShowTailInsert = computed(() => {
  return !(localContent.value || '').trim()
})

const appendRichTextBlock = () => {
  if (!tuEditorRef.value?.editor) return
  const newBlock: Block = {
    id: 'block-' + Date.now() + '-' + Math.random().toString(36).slice(2, 8),
    type: 'richtext',
    content: '',
  }
  tuEditorRef.value.editor.commands.insertBlockAfter(newBlock, '')
}

// --- Paste URL detection ---
const handleGlobalPaste = (event: ClipboardEvent) => {
  if (!props.editable) return
  const clipboardText = event.clipboardData?.getData('text/plain') ?? ''
  const url = normalizePastedUrl(clipboardText)
  if (!url) return

  const editor = tuEditorRef.value?.editor
  if (!editor) return

  const { empty, from, to } = editor.state.selection
  const selectedText = empty ? '' : editor.state.doc.textBetween(from, to, ' ').trim()

  if (!empty) {
    editor.chain().focus().setLink({ href: url }).run()
    registerExternalLinkResource(url, selectedText || url, selectedText || undefined)
    event.preventDefault()
    event.stopPropagation()
    showToast('链接已插入')
    return
  }

  registerExternalLinkResource(url, url)
}

// --- Lifecycle ---
onMounted(() => {
  document.addEventListener('paste', handleGlobalPaste, true)
  document.addEventListener('click', closeTocContextMenu)

  blockSyncManager.onStatusChange((status, error) => {
    if (status === 'syncing') {
      showToast('正在同步内容...')
    } else if (status === 'synced') {
      showToast('内容已同步到服务器')
    } else if (status === 'error') {
      showToast(`同步失败：${error || '网络错误'}`)
    }
  })
})

onBeforeUnmount(() => {
  clearSelectionToolbarTimer()
  if (annotationPersistTimer) {
    clearTimeout(annotationPersistTimer)
    annotationPersistTimer = null
  }
  document.removeEventListener('paste', handleGlobalPaste, true)
  document.removeEventListener('click', closeTocContextMenu)
  blockSyncManager.destroy()
})
</script>

<template>
  <div class="tu-editor-page">
    <!-- 工具栏 -->
    <div class="page-toolbar" v-if="editable">
      <button
        class="toolbar-button"
        @click="handleInsertLinkButtonClick"
        title="在当前选中文字位置插入链接"
      >
        插入链接
      </button>
      <button
        class="toolbar-button"
        @click="handleOpenResourcePicker"
        title="插入外部资源或图书节选"
      >
        插入资源
      </button>
      <button
        class="toolbar-button"
        @click="handleExtractSelectionButtonClick"
        title="提取选中文本为新块"
      >
        提取成块
      </button>
    </div>

    <!-- 链接插入弹窗 -->
    <form
      v-if="linkPopoverVisible"
      class="link-popover"
      :style="{ top: `${linkPopoverPosition.top}px`, left: `${linkPopoverPosition.left}px`, zIndex: linkPopoverPosition.zIndex }"
      @submit.prevent="submitLinkPopover"
      @mousedown.stop
      @click.stop
      @keydown.esc.prevent.stop="closeLinkPopover"
    >
      <label>
        <span>链接</span>
        <input
          ref="linkPopoverUrlInput"
          v-model="linkPopoverUrl"
          type="url"
          placeholder="https://example.com"
          required
        />
      </label>
      <label>
        <span>文字</span>
        <input
          v-model="linkPopoverLabel"
          type="text"
          placeholder="显示文字"
        />
      </label>
      <div class="link-popover__actions">
        <button type="button" @click="closeLinkPopover">取消</button>
        <button type="submit" :disabled="!linkPopoverUrl.trim()">插入</button>
      </div>
    </form>

    <!-- 插入链接后工具栏 -->
    <div
      v-if="insertedLinkToolbarVisible"
      class="inserted-link-toolbar"
      :style="{ top: `${insertedLinkToolbarPosition.top}px`, left: `${insertedLinkToolbarPosition.left}px`, zIndex: insertedLinkToolbarPosition.zIndex }"
      @mousedown.stop
      @click.stop
    >
      <span class="inserted-link-toolbar__url">{{ insertedLinkToolbar.url }}</span>
      <div class="inserted-link-toolbar__actions">
        <button
          type="button"
          :class="{ active: insertedLinkToolbar.display === 'link' }"
          @click="updateInsertedLinkDisplay('link')"
        >
          显示为链接
        </button>
        <button
          type="button"
          :disabled="!insertedLinkToolbar.canShowAsImage"
          :class="{ active: insertedLinkToolbar.display === 'image' }"
          @click="updateInsertedLinkDisplay('image')"
        >
          显示为图片
        </button>
      </div>
    </div>

    <section class="page-title-row">
      <input
        v-if="editable"
        v-model="pageTitleDraft"
        class="page-title-input"
        type="text"
        aria-label="页面标题"
        placeholder="未命名页面"
        @focus="onPageTitleFocus"
        @input="emit('page-title-change', pageTitleDraft)"
        @blur="onPageTitleBlur"
        @keydown.enter="focusEditorFromStart"
      />
      <h1 v-else class="page-title-heading">{{ pageTitleDraft || '未命名页面' }}</h1>
    </section>

    <div class="content-shell" :class="{ 'content-shell--toc-open': tocExpanded && tocItems.length > 0 }">
      <div class="content-container">
        <TuEditor
          ref="tuEditorRef"
          :blocks="localBlocks"
          :editable="editable"
          :annotations="editorAnnotations"
          @update:blocks="handleBlocksChange"
          @selection-change="handleSelectionChange"
          @annotation-click="handleAnnotationClick"
          @annotations-mapped="handleAnnotationsMapped"
          @compound-badge-click="handleCompoundBadgeClick"
          @open-block-picker="handleOpenBlockPicker"
          @open-resource-picker="handleOpenResourcePicker"
          @open-tag-editor="handleOpenTagEditor"
          @block-click="handleBlockClick"
          @heading-source-click="handleHeadingSourceClick"
        />

        <!-- 文档末尾插入按钮 -->
        <button
          v-if="editable && shouldShowTailInsert"
          type="button"
          class="document-tail-insert"
          @click.stop="appendRichTextBlock"
        >
          点击继续输入
        </button>
      </div>

      <aside
        v-if="tocItems.length > 0"
        class="page-toc"
        :class="{ 'page-toc--collapsed': !tocExpanded }"
      >
        <div class="page-toc__card">
          <button
            type="button"
            class="page-toc__header"
            @click="tocExpanded = false"
          >
            <span class="page-toc__title">目录</span>
            <span class="page-toc__meta">{{ tocFlatCount }}</span>
            <span class="page-toc__toggle">收起</span>
          </button>
          <div v-if="tocExpanded && allExpandableTocIds.length > 0" class="page-toc__actions">
            <button
              type="button"
              class="page-toc__action-btn"
              @click="toggleAllTocItems"
            >
              {{ allTocItemsExpanded ? '全部收起' : '全部展开' }}
            </button>
          </div>
          <div v-show="tocExpanded" class="page-toc__list">
            <TocTreeList
              :items="tocItems"
              :highlighted-block-id="highlightedBlockId"
              :is-expanded="isTocItemExpanded"
              @click="handleTocItemClick"
              @toggle="toggleTocItem"
              @context-menu="handleTocContextMenu"
              @source-click="handleTocSourceClick"
            />
          </div>
        </div>
      </aside>

      <!-- Floating TOC expand button (visible only when collapsed) -->
      <button
        v-if="!tocExpanded && tocItems.length > 0"
        type="button"
        class="page-toc__floating-toggle"
        @click="tocExpanded = true"
        title="展开目录"
      >
        目录
      </button>

      <!-- NodeView floating toolbar -->
      <div
        v-if="nodeViewToolbar.visible"
        class="nodeview-toolbar"
        :style="{ top: nodeViewToolbarPosition.top + 'px', left: nodeViewToolbarPosition.left + 'px', zIndex: nodeViewToolbarPosition.zIndex }"
        @mousedown.stop
        @click.stop
      >
        <button
          v-if="nodeViewToolbar.canAddNote"
          class="nodeview-toolbar__btn"
          @click="handleAddNoteFromSelection"
        >添加笔记</button>
        <button class="nodeview-toolbar__btn" @click="deleteSelectedNodeView">删除</button>
        <button class="nodeview-toolbar__btn" @click="duplicateSelectedNodeView">复制</button>
        <button
          v-if="supportsEmbedTocSettings(nodeViewToolbar.sourceType)"
          class="nodeview-toolbar__btn"
          @click="openTocSettingsPopover"
        >目录等级</button>
        <button
          v-if="nodeViewToolbar.sourceType === 'refBlock' && nodeViewToolbar.refId"
          class="nodeview-toolbar__btn"
          @click="navigateToReferencedPage"
        >跳转原页面</button>
      </div>

      <div
        v-if="tocSettingsPopover.visible"
        class="toc-settings-popover"
        :style="{ top: tocSettingsPopover.top + 'px', left: tocSettingsPopover.left + 'px' }"
        @mousedown.stop
        @click.stop
      >
        <div class="toc-settings-popover__field">
          <label class="toc-settings-popover__label">目录标题等级</label>
          <select
            v-model.number="tocSettingsForm.titleLevel"
            class="toc-settings-popover__select"
            :disabled="nodeViewToolbar.sourceType === 'refBlock' && tocSettingsForm.hideTitle"
          >
            <option :value="0">自动（跟随上文）</option>
            <option v-for="level in 6" :key="level" :value="level">H{{ level }}</option>
          </select>
        </div>
        <label
          v-if="nodeViewToolbar.sourceType === 'refBlock'"
          class="toc-settings-popover__checkbox-label"
        >
          <input v-model="tocSettingsForm.hideTitle" type="checkbox" />
          不在目录显示外层标题
        </label>
        <div class="toc-settings-popover__actions">
          <button type="button" class="toc-settings-popover__btn toc-settings-popover__btn--cancel" @click="closeTocSettingsPopover">
            取消
          </button>
          <button type="button" class="toc-settings-popover__btn" @click="applyTocSettings">
            确定
          </button>
        </div>
      </div>

    </div>

    <!-- 选中文本工具栏 -->
    <SelectionToolbar
      v-if="selectionToolbarVisible && !nodeViewToolbar.visible"
      :visible="selectionToolbarVisible"
      :top="selectionToolbarPosition.top"
      :left="selectionToolbarPosition.left"
      :z-index="selectionToolbarPosition.zIndex"
      :can-mark-resource-excerpt="canMarkResourceExcerptFromSelection"
      :can-mark-heading-source="canMarkHeadingSourceFromSelection"
      :can-clear-heading-source="canClearHeadingSourceFromSelection"
      @add-note="handleAddNoteFromSelection"
      @mark-resource-excerpt="handleMarkResourceExcerptFromSelection"
      @mark-heading-source="handleMarkHeadingSourceFromSelection"
      @clear-heading-source="handleClearHeadingSourceFromSelection"
    />

    <!-- 引用块选择器 -->
    <BlockPicker
      :visible="showBlockPicker"
      :pages="workspaceStore.pageTree"
      :current-page-id="workspaceStore.currentPageId"
      @select="handleBlockPickerSelect"
      @update:visible="showBlockPicker = $event"
    />

    <ExternalResourcePicker
      :visible="showResourcePicker"
      :mode="resourcePickerMode"
      :initial-excerpt-text="pendingResourceExcerptText"
      :initial-excerpt-title="pendingResourceExcerptTitle"
      @select="handleResourcePickerSelect"
      @excerpt-created="handleResourceExcerptCreated"
      @bind-source="handleBindHeadingSource"
      @update:visible="handleResourcePickerVisibleChange"
    />

    <div
      v-if="tocContextMenu.visible"
      class="toc-context-menu"
      :style="{ top: `${tocContextMenu.top}px`, left: `${tocContextMenu.left}px` }"
      @mousedown.prevent
    >
      <button type="button" @click="handleTocMarkSource">标记来源</button>
      <button
        v-if="tocContextMenu.item?.sourceBinding"
        type="button"
        @click="handleTocClearSource"
      >
        解除来源
      </button>
    </div>

    <!-- 标签编辑器 -->
    <BlockMetadataTagEditor
      :visible="tagEditorState.visible"
      :selected-tags="tagEditorBlockTags"
      :available-tags="availableTags"
      :top="tagEditorState.top"
      :left="tagEditorState.left"
      @close="closeTagEditor"
      @update:selected-tags="updateBlockTags"
    />

    <!-- 笔记编辑器 -->
    <NoteEditor
      :visible="noteEditorVisible"
      :annotation="editingAnnotation"
      @save="handleSaveAnnotation"
      @cancel="noteEditorVisible = false; editingAnnotation = undefined"
    />

    <!-- 笔记弹窗 -->
    <NotePopover
      :visible="notePopoverVisible"
      :annotation="notePopoverAnnotation"
      :annotations="notePopoverAnnotations"
      :top="notePopoverPosition.top"
      :left="notePopoverPosition.left"
      :z-index="notePopoverPosition.zIndex"
      @edit="handleEditAnnotation"
      @delete="handleDeleteAnnotation"
      @close="notePopoverVisible = false; notePopoverAnnotation = null; notePopoverAnnotations = []; notePopoverAnchor = null"
    />

    <!-- Toast 消息 -->
    <div class="toast-container">
      <Toast
        v-for="toast in toastMessages"
        :key="toast.id"
        :message="toast.message"
        @close="removeToast(toast.id)"
      />
    </div>
  </div>
</template>

<style scoped>
.tu-editor-page {
  position: relative;
  min-height: max(100%, max-content);
  display: flex;
  flex-direction: column;
}

.page-toolbar {
  position: sticky;
  top: 0;
  z-index: 30;
  display: flex;
  align-items: center;
  padding: 10px 20px;
  background-color: rgba(245, 245, 245, 0.96);
  backdrop-filter: blur(8px);
  border-bottom: 1px solid #e0e0e0;
  margin-bottom: 20px;
  border-radius: 4px 4px 0 0;
  box-shadow: 0 2px 8px rgba(31, 35, 40, 0.06);
}

.toolbar-button {
  padding: 6px 12px;
  background-color: #1890ff;
  color: white;
  border: none;
  border-radius: 4px;
  cursor: pointer;
  font-size: 14px;
  transition: background-color 0.3s;
}

.toolbar-button:hover {
  background-color: #40a9ff;
}

.page-title-row {
  flex: 0 0 auto;
  width: 100%;
  box-sizing: border-box;
  margin: 0 0 22px;
  padding: 8px 0 4px;
  cursor: text;
}

.page-title-input,
.page-title-heading {
  display: block;
  width: 100%;
  box-sizing: border-box;
  margin: 0;
  border: 0;
  background: transparent;
  color: #111827;
  font: inherit;
  font-size: clamp(30px, 4vw, 44px);
  font-weight: 760;
  line-height: 1.12;
  letter-spacing: -0.04em;
}

.page-title-input {
  padding: 8px 0;
  outline: none;
}

.page-title-input::placeholder {
  color: #9ca3af;
}

.page-title-input:focus {
  box-shadow: inset 0 -2px 0 rgba(22, 119, 255, 0.28);
}

.content-shell {
  display: flex;
  align-items: flex-start;
  gap: 0;
  width: 100%;
  min-height: 0;
  position: relative;
}

.content-shell--toc-open {
  gap: 20px;
}

.content-container {
  position: relative;
  min-height: 100%;
  display: flex;
  flex-direction: column;
  flex: 1;
  min-width: 0;
}

.page-toc {
  position: sticky;
  top: 72px;
  flex: 0 0 248px;
  width: 248px;
  align-self: flex-start;
  z-index: 24;
  transition: flex-basis 0.2s ease, width 0.2s ease;
}

.page-toc--collapsed {
  flex-basis: 0;
  width: 0;
  min-width: 0;
  overflow: hidden;
  padding: 0;
  border: 0;
  margin: 0;
  opacity: 0;
  pointer-events: none;
}

.page-toc__card {
  display: flex;
  flex-direction: column;
  max-height: calc(100vh - 40px);
  overflow: hidden;
  padding: 10px;
  border: 1px solid #e5e7eb;
  border-radius: 12px;
  background: rgba(252, 253, 255, 0.94);
  backdrop-filter: blur(10px);
  box-shadow: 0 14px 32px rgba(15, 23, 42, 0.12);
}

.page-toc__header {
  display: flex;
  align-items: center;
  gap: 8px;
  width: 100%;
  padding: 6px 8px;
  border: 0;
  border-radius: 8px;
  background: transparent;
  color: #1f2937;
  cursor: pointer;
  text-align: left;
}

.page-toc__header:hover {
  background: rgba(22, 119, 255, 0.08);
}

.page-toc__title {
  flex: 1;
  min-width: 0;
  font-size: 13px;
  font-weight: 700;
}

.page-toc__meta {
  flex: 0 0 auto;
  min-width: 20px;
  padding: 1px 6px;
  border-radius: 999px;
  background: rgba(22, 119, 255, 0.12);
  color: #1677ff;
  font-size: 11px;
  font-weight: 700;
  text-align: center;
}

.page-toc__toggle {
  flex: 0 0 auto;
  color: #6b7280;
  font-size: 12px;
}

.page-toc__floating-toggle {
  position: fixed;
  right: 0;
  top: 50%;
  transform: translateY(-50%);
  z-index: 999;
  padding: 12px 6px;
  border: 1px solid #e5e7eb;
  border-right: 0;
  border-radius: 8px 0 0 8px;
  background: rgba(252, 253, 255, 0.94);
  backdrop-filter: blur(10px);
  box-shadow: -4px 0 16px rgba(15, 23, 42, 0.08);
  color: #6b7280;
  font-size: 12px;
  cursor: pointer;
  writing-mode: vertical-rl;
  letter-spacing: 0.06em;
  line-height: 1.4;
  transition: color 0.15s, background 0.15s;
}

.page-toc__floating-toggle:hover {
  color: #1677ff;
  background: #fff;
}

.page-toc__actions {
  display: flex;
  justify-content: flex-end;
  padding: 2px 8px 0;
}

.page-toc__action-btn {
  border: 0;
  background: transparent;
  color: #1677ff;
  font-size: 11px;
  cursor: pointer;
  padding: 2px 6px;
  border-radius: 4px;
  transition: background 0.15s;
}

.page-toc__action-btn:hover {
  background: rgba(22, 119, 255, 0.08);
}

.page-toc__list {
  display: flex;
  flex-direction: column;
  gap: 6px;
  margin-top: 6px;
  overflow: auto;
}

.page-toc :deep(.page-toc__item) {
  display: flex;
  align-items: flex-start;
  gap: 8px;
  width: 100%;
  padding: 8px 10px;
  border: 0;
  border-radius: 8px;
  background: transparent;
  color: #4b5563;
  cursor: pointer;
  text-align: left;
  transition: background 0.2s ease, color 0.2s ease, transform 0.2s ease;
}

.page-toc :deep(.page-toc__item:hover) {
  background: rgba(22, 119, 255, 0.08);
  color: #0958d9;
}

.page-toc :deep(.page-toc__item--active) {
  background: rgba(22, 119, 255, 0.12);
  color: #0958d9;
}

.page-toc :deep(.page-toc__bullet) {
  flex: 0 0 auto;
  min-width: 26px;
  padding-top: 1px;
  font-size: 11px;
  font-weight: 700;
  color: #1677ff;
}

.page-toc :deep(.page-toc__item--ref) {
  background: rgba(139, 92, 246, 0.06);
}

.page-toc :deep(.page-toc__item--ref:hover) {
  background: rgba(139, 92, 246, 0.12);
}

.page-toc :deep(.page-toc__item--ref.page-toc__item--active) {
  background: rgba(139, 92, 246, 0.14);
}

.page-toc :deep(.page-toc__bullet--group) {
  color: #7c3aed !important;
  font-size: 10px !important;
  min-width: 20px !important;
}

.page-toc :deep(.page-toc__group-count) {
  flex: 0 0 auto;
  min-width: 18px;
  padding: 0 5px;
  border-radius: 999px;
  background: rgba(139, 92, 246, 0.10);
  color: #7c3aed;
  font-size: 10px;
  font-weight: 700;
  text-align: center;
}

.page-toc :deep(.page-toc__children .page-toc__item:hover) {
  background: rgba(139, 92, 246, 0.08);
}

.page-toc :deep(.page-toc__children .page-toc__item--active) {
  background: rgba(139, 92, 246, 0.14);
}

.page-toc :deep(.page-toc__children .page-toc__bullet),
.page-toc :deep(.page-toc__inline-ref-child .page-toc__bullet) {
  color: #8b5cf6;
}

.page-toc :deep(.page-toc__local-children) {
  display: flex;
  flex-direction: column;
  margin-left: 16px;
  padding-left: 8px;
  border-left: 1px solid #e5e7eb;
}

.page-toc :deep(.page-toc__local-children .page-toc__group) {
  margin-top: 2px;
}

.page-toc :deep(.page-toc__local-children .page-toc__group:last-child) {
  margin-bottom: 4px;
}

.page-toc :deep(.page-toc__children) {
  display: flex;
  flex-direction: column;
  margin: 2px 0 4px 14px;
  padding-left: 8px;
  border-left: 1px solid #e5e7eb;
}

.page-toc :deep(.page-toc__text) {
  flex: 1;
  min-width: 0;
  font-size: 13px;
  line-height: 1.45;
  word-break: break-word;
}

.page-toc :deep(.page-toc__item--level-2) {
  padding-left: 18px;
}

.page-toc :deep(.page-toc__item--level-3) {
  padding-left: 28px;
}

.page-toc :deep(.page-toc__item--level-4) {
  padding-left: 38px;
}

.page-toc :deep(.page-toc__item--level-5) {
  padding-left: 48px;
}

.page-toc :deep(.page-toc__item--level-6) {
  padding-left: 58px;
}

.toc-settings-popover {
  position: fixed;
  z-index: 1000003;
  min-width: 200px;
  padding: 12px;
  border: 1px solid #e5e7eb;
  border-radius: 10px;
  background: #fff;
  box-shadow: 0 16px 36px rgba(15, 23, 42, 0.14);
  display: flex;
  flex-direction: column;
  gap: 10px;
}
.toc-settings-popover__field {
  display: flex;
  flex-direction: column;
  gap: 4px;
}
.toc-settings-popover__label {
  font-size: 12px;
  font-weight: 600;
  color: #374151;
}
.toc-settings-popover__select {
  padding: 6px 8px;
  border: 1px solid #d1d5db;
  border-radius: 6px;
  font-size: 13px;
  color: #1f2937;
  background: #fff;
  outline: none;
  cursor: pointer;
}
.toc-settings-popover__select:focus {
  border-color: #1677ff;
  box-shadow: 0 0 0 2px rgba(22, 119, 255, 0.12);
}
.toc-settings-popover__checkbox-label {
  display: flex;
  align-items: center;
  gap: 6px;
  font-size: 13px;
  color: #374151;
  cursor: pointer;
}
.toc-settings-popover__checkbox-label input {
  width: 14px;
  height: 14px;
  cursor: pointer;
}
.toc-settings-popover__actions {
  display: flex;
  justify-content: flex-end;
  gap: 6px;
  margin-top: 2px;
}
.toc-settings-popover__btn {
  padding: 5px 12px;
  border: 1px solid #1677ff;
  border-radius: 6px;
  background: #1677ff;
  color: #fff;
  font-size: 12px;
  cursor: pointer;
  transition: background 0.15s;
}
.toc-settings-popover__btn:hover {
  background: #4096ff;
}
.toc-settings-popover__btn--cancel {
  border-color: #d1d5db;
  background: #fff;
  color: #374151;
}
.toc-settings-popover__btn--cancel:hover {
  background: #f3f4f6;
}

.nodeview-toolbar {
  position: fixed;
  display: flex;
  gap: 4px;
  padding: 4px 6px;
  background: #fff;
  border: 1px solid #e5e7eb;
  border-radius: 8px;
  box-shadow: 0 8px 20px rgba(15, 23, 42, 0.12);
}
.nodeview-toolbar__btn {
  padding: 4px 10px;
  border: none;
  border-radius: 4px;
  background: transparent;
  color: #374151;
  font-size: 12px;
  cursor: pointer;
  white-space: nowrap;
}
.nodeview-toolbar__btn:hover {
  background: #f3f4f6;
}

.toc-context-menu {
  position: fixed;
  z-index: 40;
  display: grid;
  gap: 2px;
  min-width: 120px;
  padding: 4px;
  background: #fff;
  border: 1px solid #e5e7eb;
  border-radius: 8px;
  box-shadow: 0 8px 20px rgba(15, 23, 42, 0.12);
}

.toc-context-menu button {
  border: 0;
  background: transparent;
  color: #374151;
  font-size: 12px;
  text-align: left;
  padding: 6px 10px;
  border-radius: 6px;
  cursor: pointer;
}

.toc-context-menu button:hover {
  background: #f3f4f6;
}
</style>

