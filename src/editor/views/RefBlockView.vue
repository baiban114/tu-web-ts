<script setup lang="ts">
import { computed, inject, onMounted, ref, unref, watch, type Ref } from 'vue'
import { nodeViewProps, NodeViewWrapper } from '@tiptap/vue-3'
import ResizableBlockWrapper from '../components/ResizableBlockWrapper.vue'
import ReferencedBlockRenderer from '@/components/ReferencedBlockRenderer.vue'
import TuEditor from '@/components/TuEditor.vue'
import X6Component from '@/components/X6Component.vue'
import TableBlock from '@/components/TableBlock.vue'
import { getPageContent } from '@/api/page'
import type { Block } from '@/api/types'
import { useBlockRegistryStore } from '@/stores/blockRegistry'
import { useWorkspaceStore } from '@/stores/workspace'

interface CompoundBadge {
  annotationId: string
  color: string
}

const props = defineProps(nodeViewProps)

const compoundAnnotationBadges = inject<Record<string, CompoundBadge[]> | Ref<Record<string, CompoundBadge[]>>>('compoundAnnotationBadges', {})
const onCompoundBadgeClick = inject<((blockId: string, annotationId: string, event: MouseEvent) => void)>('onCompoundBadgeClick', () => {})

const blockId = computed(() => props.node.attrs.blockId || '')
const compoundBadges = computed(() => unref(compoundAnnotationBadges)[blockId.value] || [])

const handleBadgeClick = (bid: string, annotationId: string, event: MouseEvent) => {
  onCompoundBadgeClick(bid, annotationId, event)
}

const registryStore = useBlockRegistryStore()
const workspaceStore = useWorkspaceStore()
const pageBlocks = ref<Block[]>([])
const loading = ref(false)
const error = ref('')

const refId = computed(() => String(props.node.attrs.refId ?? ''))
const refType = computed<'block' | 'page'>(() => props.node.attrs.refType === 'page' ? 'page' : 'block')
const referencedBlock = computed(() => refType.value === 'block' ? registryStore.getBlock(refId.value) : undefined)

const pageTitle = computed(() => {
  const find = (items: Array<{ id: string; title: string; children?: any[] }>): string | null => {
    for (const item of items) {
      if (item.id === refId.value) return item.title
      const nested = item.children?.length ? find(item.children) : null
      if (nested) return nested
    }
    return null
  }
  return find(workspaceStore.pageTree) ?? '未知页面'
})

const isRichTextBlock = (block: Block): boolean => block.type === 'richtext' || block.type === 'richText'

const renderFallbackText = (block: Block): string => {
  if (block.type === 'x6') return block.title?.trim() || '画板'
  if (block.type === 'table') return block.title?.trim() || '表格'
  if (block.type === 'line') return block.title?.trim() || '时间轴'
  if (block.type === 'container') return block.title?.trim() || '组合单元'
  return block.content ?? ''
}

const loadPageReference = async () => {
  if (refType.value !== 'page' || !refId.value || loading.value) return
  loading.value = true
  error.value = ''
  try {
    const blocks = await getPageContent(refId.value)
    pageBlocks.value = blocks
    registryStore.registerBlocks(blocks, refId.value, pageTitle.value)
  } catch (err) {
    error.value = err instanceof Error ? err.message : '页面内容加载失败'
  } finally {
    loading.value = false
  }
}

const openReferencedPage = async () => {
  if (refType.value === 'page' && refId.value) {
    await workspaceStore.selectPage(refId.value)
  }
}

const onResize = (width: number | null, _height: number | null) => {
  props.updateAttributes({ width })
}

watch([refId, refType], () => {
  pageBlocks.value = []
  error.value = ''
  void loadPageReference()
})

onMounted(() => {
  void loadPageReference()
})
</script>

<template>
  <node-view-wrapper class="ref-block-view">
    <ResizableBlockWrapper
      :selected="selected"
      :resizable-axes="{ width: true, height: false }"
      :min-width="200"
      block-type-label="引用"
      :block-id="blockId"
      block-type="ref"
      :compound-badges="compoundBadges"
      @resize="onResize"
      @compound-badge-click="handleBadgeClick"
    >
    <div v-if="refType === 'page'" class="ref-page-card">
      <button type="button" class="ref-page-card__header" @click="openReferencedPage">
        <span class="ref-page-card__label">页面引用</span>
        <span class="ref-page-card__title">{{ pageTitle }}</span>
      </button>
      <div v-if="loading" class="ref-page-card__status">正在加载页面内容...</div>
      <div v-else-if="error" class="ref-page-card__status ref-page-card__status--error">{{ error }}</div>
      <div v-else class="ref-page-content">
        <div v-if="pageBlocks.length === 0" class="ref-page-card__status">空页面</div>
        <template v-for="block in pageBlocks" :key="block.id">
          <TuEditor
            v-if="isRichTextBlock(block)"
            :blocks="[block]"
            :editable="false"
            class="ref-page-content__block"
          />
          <X6Component
            v-else-if="block.type === 'x6'"
            :graphData="block.graphData"
            :editable="false"
            :block-actions-enabled="false"
            class="ref-page-content__block ref-page-content__board"
          />
          <TableBlock
            v-else-if="block.type === 'table'"
            :data="block.tableData"
            :editable="false"
            class="ref-page-content__block"
          />
          <ReferencedBlockRenderer
            v-else-if="block.type === 'container'"
            :block="block"
            :editable="false"
            class="ref-page-content__block"
          />
          <div v-else-if="block.type !== 'ref'" class="ref-page-content__fallback">
            {{ renderFallbackText(block) }}
          </div>
        </template>
      </div>
    </div>

    <div v-else class="ref-block-card">
      <div class="ref-block-card__badge">
        引用自：{{ registryStore.getMeta(refId)?.pageTitle ?? '未知页面' }}
      </div>
      <ReferencedBlockRenderer
        :block="referencedBlock"
        :editable="editor.isEditable"
        class="ref-block-card__content"
      />
    </div>
    </ResizableBlockWrapper>
  </node-view-wrapper>
</template>

<style scoped>
.ref-page-card,
.ref-block-card {
  overflow: hidden;
  border: 1px solid #d6e4ff;
  border-radius: 8px;
  background: #f8fbff;
}

.ref-page-card__header {
  display: flex;
  align-items: center;
  gap: 10px;
  width: 100%;
  padding: 10px 12px;
  border: 0;
  border-bottom: 1px solid #d6e4ff;
  background: #eef6ff;
  color: #1f2937;
  cursor: pointer;
  text-align: left;
}

.ref-page-card__label {
  flex: 0 0 auto;
  color: #1677ff;
  font-size: 12px;
  font-weight: 700;
}

.ref-page-card__title {
  flex: 1;
  min-width: 0;
  font-size: 14px;
  font-weight: 700;
}

.ref-page-card__status {
  padding: 12px;
  color: #6b7280;
  font-size: 13px;
}

.ref-page-card__status--error {
  color: #cf1322;
}

.ref-page-content {
  display: flex;
  flex-direction: column;
  gap: 10px;
  padding: 12px;
}

.ref-page-content__block,
.ref-page-content__fallback {
  border-radius: 6px;
  background: #ffffff;
}

.ref-page-content__board {
  min-height: 400px;
}

.ref-page-content__fallback {
  padding: 10px 12px;
  color: #4b5563;
  font-size: 13px;
  line-height: 1.5;
  white-space: pre-wrap;
  word-break: break-word;
}

.ref-block-card {
  padding: 10px 12px;
}

.ref-block-card__badge {
  margin-bottom: 8px;
  color: #64748b;
  font-size: 12px;
}

.ref-block-card__content {
  min-width: 0;
}
</style>
