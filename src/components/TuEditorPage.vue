<script setup lang="ts">
import { ref, watch, computed } from 'vue'
import type { Block } from '@/api/types'
import TuEditor from './TuEditor.vue'
import SelectionToolbar from './SelectionToolbar.vue'
import BlockPicker from './BlockPicker.vue'
import { blockSyncManager } from '@/utils/blockSyncManager'
import { useWorkspaceStore } from '@/stores/workspace'

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

const localBlocks = ref<Block[]>([])
const pageTitleDraft = ref('')
const hasSelection = ref(false)
const selectedText = ref('')
const selectionPosition = ref({ top: 0, left: 0 })

const tuEditorRef = ref<InstanceType<typeof TuEditor> | null>(null)
const showBlockPicker = ref(false)
const pendingRefInsertAfterBlockId = ref<string | null>(null)
const highlightedBlockId = ref<string | null>(null)
const tocExpanded = ref(true)

watch(
  () => props.contentList,
  (val) => { localBlocks.value = JSON.parse(JSON.stringify(val)) },
  { immediate: true, deep: true },
)

watch(
  () => props.pageTitle,
  (val) => { pageTitleDraft.value = val },
  { immediate: true },
)

const handleBlocksChange = (blocks: Block[]) => {
  localBlocks.value = blocks
  emit('content-change', blocks)
  blockSyncManager.sync()
}

const handleSelectionChange = (selHasSelection: boolean, selText: string) => {
  hasSelection.value = selHasSelection
  selectedText.value = selText
}

const handleOpenBlockPicker = (afterBlockId: string) => {
  pendingRefInsertAfterBlockId.value = afterBlockId
  showBlockPicker.value = true
}

const handleBlockPickerSelect = (target: { type: 'block' | 'page'; id: string }) => {
  if (!pendingRefInsertAfterBlockId.value || !tuEditorRef.value?.editor) return

  const refBlock: Block = {
    id: 'block-' + Date.now() + '-' + Math.random().toString(36).slice(2, 8),
    type: 'ref',
    refId: target.id,
    refType: target.type,
  }

  tuEditorRef.value.editor.commands.insertBlockAfter(refBlock, pendingRefInsertAfterBlockId.value)

  showBlockPicker.value = false
  pendingRefInsertAfterBlockId.value = null
}

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

const handleInsertLinkButtonClick = () => {
  const editor = tuEditorRef.value?.editor
  if (!editor) return
  const { from, to } = editor.state.selection
  if (from === to) {
    alert('请先选中文字后再插入链接')
    return
  }
  const url = prompt('请输入链接地址:')
  if (url) {
    editor.chain().focus().setLink({ href: url }).run()
  }
}

const handleExtractSelectionButtonClick = () => {
  const editor = tuEditorRef.value?.editor
  if (!editor) return
  const { from, to } = editor.state.selection
  if (from === to) {
    alert('请先选中文字后再提取')
    return
  }
  const selectedText = editor.state.doc.textBetween(from, to, ' ')
  if (selectedText) {
    editor.chain()
      .focus()
      .insertContent(`<p>${selectedText}</p>`)
      .run()
  }
}
</script>

<template>
  <div class="tu-editor-page">
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

    <section class="page-title-row">
      <input
        v-if="editable"
        v-model="pageTitleDraft"
        class="page-title-input"
        type="text"
        aria-label="页面标题"
        placeholder="未命名页面"
        @input="emit('page-title-change', pageTitleDraft)"
      />
      <h1 v-else class="page-title-heading">{{ pageTitleDraft || '未命名页面' }}</h1>
    </section>

    <div class="content-shell">
      <div class="content-container">
        <TuEditor
          ref="tuEditorRef"
          :blocks="localBlocks"
          :editable="editable"
          @update:blocks="handleBlocksChange"
          @content-change="handleBlocksChange"
          @selection-change="handleSelectionChange"
          @open-block-picker="handleOpenBlockPicker"
        />
      </div>

      <aside v-if="tocItems.length > 0" class="page-toc" :class="{ 'page-toc--collapsed': !tocExpanded }">
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

    <SelectionToolbar
      v-if="hasSelection && selectedText"
      :visible="hasSelection"
      :top="selectionPosition.top"
      :left="selectionPosition.left"
    />

    <BlockPicker
      :visible="showBlockPicker"
      :pages="workspaceStore.pageTree"
      :current-page-id="workspaceStore.currentPageId"
      @select="handleBlockPickerSelect"
      @update:visible="showBlockPicker = $event"
    />
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

