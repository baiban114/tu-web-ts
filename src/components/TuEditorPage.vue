<script setup lang="ts">
import { ref, watch, computed, onMounted, onBeforeUnmount, nextTick } from 'vue'
import type { Block, BlockTag, TextAnnotation } from '@/api/types'
import TuEditor from './TuEditor.vue'
import SelectionToolbar from './SelectionToolbar.vue'
import BlockPicker from './BlockPicker.vue'
import BlockMetadataTagEditor from './BlockMetadataTagEditor.vue'
import Toast from './Toast.vue'
import NoteEditor from './NoteEditor.vue'
import NotePopover from './NotePopover.vue'
import { blockSyncManager } from '@/utils/blockSyncManager'
import { useWorkspaceStore } from '@/stores/workspace'
import { collectBlockTags, getBlockTags, setBlockTags } from '@/utils/blockMetadata'
import { ensureExternalLinkResource } from '@/api/externalResource'

type LinkDisplayMode = 'link' | 'image'

interface TocItem {
  id: string
  blockId: string
  level: number
  text: string
  pos: number
}

const workspaceStore = useWorkspaceStore()

interface Props {
  contentList: Block[]
  pageTitle?: string
  editable?: boolean
}

const props = withDefaults(defineProps<Props>(), {
  pageTitle: '',
  editable: true,
})

const emit = defineEmits<{
  'content-change': [contentList: Block[]]
  'page-title-change': [title: string]
}>()

// --- Core state ---
const localBlocks = ref<Block[]>([])
const pageTitleDraft = ref('')
const tuEditorRef = ref<InstanceType<typeof TuEditor> | null>(null)
const showBlockPicker = ref(false)
const highlightedBlockId = ref<string | null>(null)
const tocExpanded = ref(true)

// --- Selection state ---
const hasSelection = ref(false)
const selectedText = ref('')
const selectionPosition = ref({ top: 0, left: 0 })
const selectionToolbarVisible = ref(false)
const selectionBlockIndex = ref(-1)
const selectionBlockId = ref('')
const selectionFrom = ref(0)
const selectionTo = ref(0)
let selectionToolbarTimer: ReturnType<typeof setTimeout> | null = null

// --- Toast ---
const toastMessages = ref<Array<{ id: string; message: string }>>([])
const toastEnabled = ref(true)

// --- Link popover ---
const linkPopoverVisible = ref(false)
const linkPopoverTarget = ref({ top: 0, left: 0 })
const linkPopoverUrl = ref('')
const linkPopoverLabel = ref('')
const linkPopoverUrlInput = ref<HTMLInputElement | null>(null)

// --- Inserted link toolbar ---
const insertedLinkToolbarVisible = ref(false)
const insertedLinkToolbar = ref({ top: 0, left: 0, url: '', label: '', display: 'link' as LinkDisplayMode, canShowAsImage: false })

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
let annotationPersistTimer: ReturnType<typeof setTimeout> | null = null

const notePopoverVisible = ref(false)
const notePopoverAnnotation = ref<TextAnnotation | null>(null)
const notePopoverAnnotations = ref<TextAnnotation[]>([])
const notePopoverPos = ref({ top: 0, left: 0 })

// --- Watchers ---
// Track the blocks reference we most recently emitted upward. When the parent
// hands those exact blocks back via `contentList`, we must NOT re-clone them
// into localBlocks — doing so triggers a second TuEditor blocks watch after
// `skipNextContentSync` is already consumed, which causes setContent to fire
// and visibly rearrange interactive nodes (e.g. table rows collapsing).
let pendingSelfEmittedBlocks: Block[] | null = null

const emitLocalContentChange = (blocks: Block[] = localBlocks.value) => {
  pendingSelfEmittedBlocks = blocks
  emit('content-change', blocks)
}

watch(
  () => props.contentList,
  (val, oldVal) => {
    if (val === oldVal) return
    if (pendingSelfEmittedBlocks && val === pendingSelfEmittedBlocks) {
      pendingSelfEmittedBlocks = null
      return
    }
    pendingSelfEmittedBlocks = null
    localBlocks.value = JSON.parse(JSON.stringify(val))
  },
  { immediate: true },
)

watch(
  () => props.pageTitle,
  (val) => { pageTitleDraft.value = val },
  { immediate: true },
)

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
  localBlocks.value = blocks
  emitLocalContentChange(blocks)
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
) => {
  if (selectionToolbarTimer !== null) {
    clearTimeout(selectionToolbarTimer)
    selectionToolbarTimer = null
  }

  hasSelection.value = selHasSelection
  selectedText.value = selText
  selectionFrom.value = selFrom ?? 0
  selectionTo.value = selTo ?? 0
  selectionBlockIndex.value = -1
  selectionBlockId.value = selBlockId ?? ''

  if (selHasSelection && tuEditorRef.value) {
    const pos = tuEditorRef.value.getSelectionPosition?.()
    if (pos) {
      selectionPosition.value = { top: pos.top + 4, left: pos.left }
    }
    selectionToolbarTimer = setTimeout(() => {
      selectionToolbarTimer = null
      selectionToolbarVisible.value = hasSelection.value && selectedText.value.trim().length > 0
    }, 120)
  } else {
    selectionToolbarVisible.value = false
  }
}

// --- Block picker ---
const handleOpenBlockPicker = () => {
  showBlockPicker.value = true
}

const getSelectionContext = (from: number, to: number) => {
  const editor = tuEditorRef.value?.editor
  if (!editor) return { before: '', after: '' }
  const start = Math.max(0, from - 50)
  const end = Math.min(editor.state.doc.content.size, to + 50)
  return {
    before: editor.state.doc.textBetween(start, from, ''),
    after: editor.state.doc.textBetween(to, end, ''),
  }
}

const handleBlockPickerSelect = (target: { type: 'block' | 'page'; id: string }) => {
  tuEditorRef.value?.completePendingRefInsert?.(target.id, target.type)
  showBlockPicker.value = false
}

// --- TOC ---
const tocItems = computed<TocItem[]>(() => {
  const editor = tuEditorRef.value?.editor
  if (!editor) return []

  const items: TocItem[] = []
  editor.state.doc.descendants((node, pos) => {
    if (node.type.name === 'heading') {
      const text = node.textContent.trim()
      if (text) {
        items.push({
          id: `${pos}-${node.attrs?.level}`,
          blockId: node.attrs?.blockId || `heading-${pos}`,
          level: node.attrs?.level || 1,
          text,
          pos,
        })
      }
    }
    return true
  })

  return items
})

const handleTocItemClick = (item: TocItem) => {
  const editor = tuEditorRef.value?.editor
  if (!editor) return

  const from = item.pos
  const to = from + (editor.state.doc.nodeAt(from)?.nodeSize || 0)
  editor.commands.setTextSelection({ from, to })
  editor.commands.scrollIntoView()
  highlightedBlockId.value = item.blockId
  setTimeout(() => { highlightedBlockId.value = null }, 2000)
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

  // Position the popover near the selection
  try {
    const start = editor.view.coordsAtPos(from)
    linkPopoverTarget.value = {
      top: Math.max(12, Math.min(start.top - 10, window.innerHeight - 180)),
      left: Math.max(12, Math.min(start.left, window.innerWidth - 332)),
    }
  } catch {
    linkPopoverTarget.value = { top: 100, left: 100 }
  }

  linkPopoverUrl.value = ''
  linkPopoverLabel.value = label
  linkPopoverVisible.value = true
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
  registerExternalLinkResource(url, label)
  showInsertedLinkToolbar(url, label)
  closeLinkPopover()
}

const registerExternalLinkResource = (url: string, label: string) => {
  void ensureExternalLinkResource(url, label).catch((error) => {
    console.warn('Failed to register external link resource:', error)
    showToast('链接已插入，但外部资源登记失败')
  })
}

const showInsertedLinkToolbar = (url: string, label: string) => {
  const display: LinkDisplayMode = isImageUrl(url) ? 'image' : 'link'
  insertedLinkToolbar.value = {
    top: linkPopoverTarget.value.top,
    left: linkPopoverTarget.value.left,
    url,
    label,
    display,
    canShowAsImage: isImageUrl(url),
  }
  insertedLinkToolbarVisible.value = true
}

const closeInsertedLinkToolbar = () => {
  insertedLinkToolbarVisible.value = false
}

const updateInsertedLinkDisplay = (display: LinkDisplayMode) => {
  insertedLinkToolbar.value.display = display
}

// --- Paste URL detection ---
const normalizePastedUrl = (text: string): string | null => {
  const value = text.trim()
  if (!value || /\s/.test(value)) return null
  try {
    const url = new URL(value)
    return url.protocol === 'http:' || url.protocol === 'https:' ? url.href : null
  } catch {
    return null
  }
}

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
const handleOpenTagEditor = (blockId: string) => {
  const block = localBlocks.value.find(b => b.id === blockId)
  if (!block) return
  tagEditorBlockTags.value = getBlockTags(block)
  tagEditorState.value = {
    visible: true,
    blockId,
    top: window.innerHeight / 2 - 160,
    left: window.innerWidth / 2 - 160,
  }
}

const closeTagEditor = () => {
  tagEditorState.value.visible = false
  tagEditorState.value.blockId = ''
}

const updateBlockTags = (tags: BlockTag[]) => {
  const block = localBlocks.value.find(b => b.id === tagEditorState.value.blockId)
  if (!block) return
  setBlockTags(block, tags)
  emitLocalContentChange()
  localBlocks.value = [...localBlocks.value]
}

const availableTags = computed(() => collectBlockTags(localBlocks.value))
const editorAnnotations = computed<Record<string, TextAnnotation[]>>(() => {
  const result: Record<string, TextAnnotation[]> = {}
  for (const block of localBlocks.value) {
    const annotations = block.metadata?.annotations as TextAnnotation[] | undefined
    if (annotations?.length) {
      result[block.id] = annotations
    }
  }
  return result
})
const allAnnotations = computed(() => Object.values(editorAnnotations.value).flat())

// --- Note / Annotation ---
const handleAddNoteFromSelection = () => {
  if (!selectedText.value) return

  const blockIndex = selectionBlockIndex.value >= 0 ? selectionBlockIndex.value : 0
  const targetBlock = selectionBlockId.value
    ? localBlocks.value.find(block => block.id === selectionBlockId.value)
    : localBlocks.value[blockIndex]
  if (!targetBlock) return

  pendingNoteBlockId.value = targetBlock.id || ''
  pendingNoteSelectedText.value = selectedText.value
  const context = getSelectionContext(selectionFrom.value, selectionTo.value)
  pendingNoteContextBefore.value = context.before
  pendingNoteContextAfter.value = context.after
  pendingNoteFrom.value = selectionFrom.value
  pendingNoteTo.value = selectionTo.value

  editingAnnotation.value = undefined
  noteEditorVisible.value = true
}

const handleSaveAnnotation = (note: string) => {
  if (!pendingNoteBlockId.value) return

  const now = Date.now()
  const existing = editingAnnotation.value
  const block = localBlocks.value.find(b => b.id === pendingNoteBlockId.value)
  if (!block) return

  const annotations: TextAnnotation[] = (block.metadata?.annotations as TextAnnotation[]) || []

  if (existing) {
    const idx = annotations.findIndex(a => a.id === existing.id)
    if (idx >= 0) {
      annotations[idx] = { ...existing, note, updatedAt: now }
    }
  } else {
    const annotation: TextAnnotation = {
      id: `annot-${now}-${Math.random().toString(36).substr(2, 6)}`,
      selectedText: pendingNoteSelectedText.value,
      contextBefore: pendingNoteContextBefore.value,
      contextAfter: pendingNoteContextAfter.value,
      note,
      color: '#FFEB3B',
      createdAt: now,
      updatedAt: now,
      from: pendingNoteFrom.value,
      to: pendingNoteTo.value,
      blockId: pendingNoteBlockId.value,
      anchorVersion: 1,
      lastResolvedAt: now,
      unresolved: false,
    }
    annotations.push(annotation)
  }

  block.metadata = { ...(block.metadata || {}), annotations }
  emitLocalContentChange()
  localBlocks.value = [...localBlocks.value]

  noteEditorVisible.value = false
  editingAnnotation.value = undefined
  hasSelection.value = false
  selectionToolbarVisible.value = false
  selectionBlockIndex.value = -1
  selectionBlockId.value = ''
  pendingNoteBlockId.value = ''
  pendingNoteSelectedText.value = ''
  pendingNoteFrom.value = 0
  pendingNoteTo.value = 0
}

const sortAnnotationsByTimeDesc = (annotations: TextAnnotation[]) => {
  return [...annotations].sort((a, b) => (b.updatedAt || b.createdAt || 0) - (a.updatedAt || a.createdAt || 0))
}

const handleAnnotationClick = (payload: { annotationId: string; annotationIds?: string[]; event: MouseEvent }) => {
  const annotations = getBlockAnnotations()
  const ids = payload.annotationIds?.length ? payload.annotationIds : [payload.annotationId]
  const idSet = new Set(ids)
  const matched = sortAnnotationsByTimeDesc(annotations.filter(a => idSet.has(a.id)))
  const annotation = matched[0] ?? annotations.find(a => a.id === payload.annotationId)
  if (!annotation) return
  notePopoverAnnotation.value = annotation
  notePopoverAnnotations.value = matched.length ? matched : [annotation]
  notePopoverPos.value = { top: payload.event.clientY - 10, left: payload.event.clientX + 12 }
  notePopoverVisible.value = true
}

const getBlockAnnotations = (): TextAnnotation[] => {
  return allAnnotations.value
}

const hasAnnotationAnchorChange = (previous: TextAnnotation, next: TextAnnotation): boolean => {
  return previous.from !== next.from
    || previous.to !== next.to
    || previous.unresolved !== next.unresolved
    || previous.anchorVersion !== next.anchorVersion
    || previous.blockId !== next.blockId
}

const handleAnnotationsMapped = (mappedAnnotations: TextAnnotation[]) => {
  if (annotationPersistTimer) clearTimeout(annotationPersistTimer)
  annotationPersistTimer = setTimeout(() => {
    annotationPersistTimer = null
    const byId = new Map(mappedAnnotations.map((annotation) => [annotation.id, annotation]))
    let changed = false
    for (const block of localBlocks.value) {
      const annotations = block.metadata?.annotations as TextAnnotation[] | undefined
      if (!annotations?.length) continue
      const next = annotations.map((annotation) => byId.get(annotation.id) ?? annotation)
      if (next.some((annotation, index) => hasAnnotationAnchorChange(annotations[index], annotation))) {
        block.metadata = { ...(block.metadata || {}), annotations: next }
        changed = true
      }
    }
    if (changed) {
      emitLocalContentChange()
      localBlocks.value = [...localBlocks.value]
    }
  }, 400)
}

const handleEditAnnotation = (annotation?: TextAnnotation) => {
  const target = annotation ?? notePopoverAnnotation.value
  if (!target) return
  const block = localBlocks.value.find(b => {
    const anns = b.metadata?.annotations as TextAnnotation[] | undefined
    return anns?.some(a => a.id === target.id)
  })
  if (!block) return

  pendingNoteBlockId.value = block.id
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
  const block = localBlocks.value.find(b => {
    const anns = b.metadata?.annotations as TextAnnotation[] | undefined
    return anns?.some(a => a.id === target.id)
  })
  if (!block) return

  const annotations: TextAnnotation[] = (block.metadata?.annotations as TextAnnotation[]) || []
  const idx = annotations.findIndex(a => a.id === target.id)
  if (idx >= 0) {
    annotations.splice(idx, 1)
    block.metadata = { ...(block.metadata || {}), annotations }
    emitLocalContentChange()
  }
  notePopoverAnnotations.value = notePopoverAnnotations.value.filter(item => item.id !== target.id)
  notePopoverAnnotation.value = notePopoverAnnotations.value[0] ?? null
  notePopoverVisible.value = notePopoverAnnotations.value.length > 0
}

// --- Document tail insert ---
const shouldShowTailInsert = computed(() => {
  const blocks = localBlocks.value
  if (blocks.length === 0) return true
  const last = blocks[blocks.length - 1]
  return last.type !== 'richtext' && last.type !== 'richText'
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

  // If there's a text selection, apply the link to it
  const { empty } = editor.state.selection
  if (!empty) {
    editor.chain().focus().setLink({ href: url }).run()
    registerExternalLinkResource(url, url)
    event.preventDefault()
    event.stopPropagation()
    showToast('链接已插入')
  }
}

// --- Lifecycle ---
onMounted(() => {
  document.addEventListener('paste', handleGlobalPaste, true)

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
  if (selectionToolbarTimer !== null) {
    clearTimeout(selectionToolbarTimer)
    selectionToolbarTimer = null
  }
  if (annotationPersistTimer) {
    clearTimeout(annotationPersistTimer)
    annotationPersistTimer = null
  }
  document.removeEventListener('paste', handleGlobalPaste, true)
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
      :style="{ top: `${linkPopoverTarget.top}px`, left: `${linkPopoverTarget.left}px` }"
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
      :style="{ top: `${insertedLinkToolbar.top}px`, left: `${insertedLinkToolbar.left}px` }"
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
        @input="emit('page-title-change', pageTitleDraft)"
        @keydown.enter="focusEditorFromStart"
      />
      <h1 v-else class="page-title-heading">{{ pageTitleDraft || '未命名页面' }}</h1>
    </section>

    <div class="content-shell">
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
          @open-block-picker="handleOpenBlockPicker"
          @open-tag-editor="handleOpenTagEditor"
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
            :aria-expanded="tocExpanded"
            @click="tocExpanded = !tocExpanded"
          >
            <span class="page-toc__title">目录</span>
            <span class="page-toc__meta">{{ tocItems.length }}</span>
            <span class="page-toc__toggle">{{ tocExpanded ? '收起' : '展开' }}</span>
          </button>
          <div v-show="tocExpanded" class="page-toc__list">
            <button
              v-for="item in tocItems"
              :key="item.id"
              type="button"
              class="page-toc__item"
              :class="{
                'page-toc__item--active': highlightedBlockId === item.blockId,
                [`page-toc__item--level-${item.level}`]: true,
              }"
              @click="handleTocItemClick(item)"
            >
              <span class="page-toc__bullet">H{{ item.level }}</span>
              <span class="page-toc__text">{{ item.text }}</span>
            </button>
          </div>
        </div>
      </aside>
    </div>

    <!-- 选中文本工具栏 -->
    <SelectionToolbar
      v-if="selectionToolbarVisible"
      :visible="selectionToolbarVisible"
      :top="selectionPosition.top"
      :left="selectionPosition.left"
      @add-note="handleAddNoteFromSelection"
    />

    <!-- 引用块选择器 -->
    <BlockPicker
      :visible="showBlockPicker"
      :pages="workspaceStore.pageTree"
      :current-page-id="workspaceStore.currentPageId"
      @select="handleBlockPickerSelect"
      @update:visible="showBlockPicker = $event"
    />

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
      :top="notePopoverPos.top"
      :left="notePopoverPos.left"
      @edit="handleEditAnnotation"
      @delete="handleDeleteAnnotation"
      @close="notePopoverVisible = false; notePopoverAnnotation = null; notePopoverAnnotations = []"
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
  gap: 20px;
  width: 100%;
  min-height: 0;
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
  flex-basis: 112px;
  width: 112px;
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

.page-toc--collapsed .page-toc__header {
  justify-content: center;
}

.page-toc--collapsed .page-toc__title,
.page-toc--collapsed .page-toc__meta {
  display: none;
}

.page-toc__list {
  display: flex;
  flex-direction: column;
  gap: 6px;
  margin-top: 6px;
  overflow: auto;
}

.page-toc__item {
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

.page-toc__item:hover {
  background: rgba(22, 119, 255, 0.08);
  color: #0958d9;
}

.page-toc__item--active {
  background: rgba(22, 119, 255, 0.12);
  color: #0958d9;
}

.page-toc__bullet {
  flex: 0 0 auto;
  min-width: 26px;
  padding-top: 1px;
  font-size: 11px;
  font-weight: 700;
  color: #1677ff;
}

.page-toc__text {
  flex: 1;
  min-width: 0;
  font-size: 13px;
  line-height: 1.45;
  word-break: break-word;
}

.page-toc__item--level-2 {
  padding-left: 18px;
}

.page-toc__item--level-3 {
  padding-left: 28px;
}

.page-toc__item--level-4 {
  padding-left: 38px;
}

.page-toc__item--level-5 {
  padding-left: 48px;
}

.page-toc__item--level-6 {
  padding-left: 58px;
}
</style>

