<script setup lang="ts">
import { computed, markRaw, nextTick, onBeforeUnmount, ref, shallowRef, watch } from 'vue'
import { nodeViewProps, NodeViewWrapper } from '@tiptap/vue-3'
import { buildFileUrl } from '@/api/fileStorage'
import ResizableBlockWrapper from '../components/ResizableBlockWrapper.vue'
import {
  PDF_EXCERPT_DEFAULT_HEIGHT,
  PDF_EXCERPT_MAX_HEIGHT,
  PDF_EXCERPT_MIN_HEIGHT,
  normalizePdfPageRange,
} from '@/utils/pdfExcerpt'
import { acquirePdfDocument, releasePdfDocument } from '@/utils/pdfDocumentCache'
import type { PdfDocumentProxy } from '@/utils/pdfjsSetup'

const props = defineProps(nodeViewProps)

const blockId = computed(() => props.node.attrs.blockId || '')
const fileId = computed(() => String(props.node.attrs.fileId || ''))
const fileName = computed(() => String(props.node.attrs.fileName || 'PDF'))
const startPage = computed(() => Number(props.node.attrs.startPage) || 1)
const endPage = computed(() => Number(props.node.attrs.endPage) || 1)
const height = computed(() => Number(props.node.attrs.height) || PDF_EXCERPT_DEFAULT_HEIGHT)

const fileUrl = computed(() => (fileId.value ? buildFileUrl(fileId.value) : ''))
const loadError = ref('')
const loading = ref(false)
const pageCanvases = ref<Array<{ pageNumber: number; height: number }>>([])
const docRef = shallowRef<PdfDocumentProxy | null>(null)

const pageRefs = new Map<number, HTMLElement>()
const renderedPages = new Set<number>()
const renderTasks = new Map<number, { cancel?: () => void }>()
let observer: IntersectionObserver | null = null
let resizeObserver: ResizeObserver | null = null
let boundUrl = ''
let loadGeneration = 0

function setPageRef(pageNumber: number, el: unknown) {
  if (el instanceof HTMLElement) {
    pageRefs.set(pageNumber, el)
  } else {
    pageRefs.delete(pageNumber)
  }
}

function openInNewTab() {
  if (!fileUrl.value) return
  window.open(fileUrl.value, '_blank', 'noopener,noreferrer')
}

function onResize(_width: number | null, nextHeight: number | null) {
  if (nextHeight == null) return
  const clamped = Math.min(PDF_EXCERPT_MAX_HEIGHT, Math.max(PDF_EXCERPT_MIN_HEIGHT, Math.round(nextHeight)))
  props.updateAttributes({ height: clamped })
}

function disconnectObserver() {
  observer?.disconnect()
  observer = null
  resizeObserver?.disconnect()
  resizeObserver = null
}

function cancelRenderTasks() {
  renderTasks.forEach((task) => task.cancel?.())
  renderTasks.clear()
  renderedPages.clear()
}

async function renderPage(pageNumber: number) {
  if (!docRef.value || renderedPages.has(pageNumber)) return
  const host = pageRefs.get(pageNumber)
  if (!host) return

  const hostWidth = host.clientWidth || host.parentElement?.clientWidth || 0
  if (hostWidth <= 0) return

  renderedPages.add(pageNumber)
  try {
    const page = await docRef.value.getPage(pageNumber)
    const viewport = page.getViewport({ scale: 1 })
    const scale = hostWidth / viewport.width
    const scaledViewport = page.getViewport({ scale })

    const canvas = document.createElement('canvas')
    canvas.width = Math.floor(scaledViewport.width)
    canvas.height = Math.floor(scaledViewport.height)
    canvas.className = 'pdf-excerpt-block__canvas'
    host.replaceChildren(canvas)

    const context = canvas.getContext('2d')
    if (!context) return
    const task = page.render({ canvasContext: context, viewport: scaledViewport, canvas })
    renderTasks.set(pageNumber, task)
    await task.promise
    renderTasks.delete(pageNumber)
  } catch (error) {
    renderedPages.delete(pageNumber)
    loadError.value = error instanceof Error ? error.message : 'PDF 页面渲染失败'
  }
}

function setupObserver() {
  disconnectObserver()
  observer = new IntersectionObserver((entries) => {
    entries.forEach((entry) => {
      if (!entry.isIntersecting) return
      const pageNumber = Number((entry.target as HTMLElement).dataset.pageNumber)
      if (!Number.isFinite(pageNumber)) return
      void renderPage(pageNumber)
    })
  }, { root: null, threshold: 0.1 })

  resizeObserver = new ResizeObserver((entries) => {
    entries.forEach((entry) => {
      const pageNumber = Number((entry.target as HTMLElement).dataset.pageNumber)
      if (!Number.isFinite(pageNumber) || renderedPages.has(pageNumber)) return
      void renderPage(pageNumber)
    })
  })

  pageRefs.forEach((el, pageNumber) => {
    el.dataset.pageNumber = String(pageNumber)
    observer?.observe(el)
    resizeObserver?.observe(el)
  })
}

async function schedulePageRendering() {
  await nextTick()
  if (pageRefs.size === 0 && pageCanvases.value.length > 0) {
    await new Promise<void>((resolve) => {
      requestAnimationFrame(() => resolve())
    })
  }
  setupObserver()
  pageRefs.forEach((_el, pageNumber) => {
    void renderPage(pageNumber)
  })
}

async function loadDocument() {
  if (!fileUrl.value) return
  const generation = ++loadGeneration
  if (boundUrl && boundUrl !== fileUrl.value) {
    releasePdfDocument(boundUrl)
    boundUrl = ''
    docRef.value = null
  }

  loading.value = true
  loadError.value = ''
  cancelRenderTasks()
  pageCanvases.value = []
  pageRefs.clear()

  try {
    if (!docRef.value || boundUrl !== fileUrl.value) {
      if (boundUrl) {
        releasePdfDocument(boundUrl)
      }
      docRef.value = markRaw(await acquirePdfDocument(fileUrl.value))
      boundUrl = fileUrl.value
    }
    if (generation !== loadGeneration) return

    const doc = docRef.value
    const normalized = normalizePdfPageRange(startPage.value, endPage.value, doc.numPages)
    if (
      normalized.startPage !== startPage.value
      || normalized.endPage !== endPage.value
    ) {
      props.updateAttributes({
        startPage: normalized.startPage,
        endPage: normalized.endPage,
      })
    }
    const pages: Array<{ pageNumber: number; height: number }> = []
    for (let pageNumber = normalized.startPage; pageNumber <= normalized.endPage; pageNumber += 1) {
      pages.push({ pageNumber, height: 0 })
    }
    pageCanvases.value = pages
  } catch (error) {
    loadError.value = error instanceof Error ? error.message : 'PDF 加载失败'
    pageCanvases.value = []
  } finally {
    loading.value = false
  }

  if (generation !== loadGeneration || loadError.value || pageCanvases.value.length === 0) {
    return
  }
  await schedulePageRendering()
}

watch(fileUrl, () => {
  void loadDocument()
}, { immediate: true })

watch([startPage, endPage], () => {
  void loadDocument()
})

onBeforeUnmount(() => {
  disconnectObserver()
  cancelRenderTasks()
  if (boundUrl) {
    releasePdfDocument(boundUrl)
    boundUrl = ''
  }
  docRef.value = null
})
</script>

<template>
  <node-view-wrapper class="pdf-excerpt-block-nv" :data-block-id="blockId">
    <ResizableBlockWrapper
      :selected="selected"
      :resizable-axes="{ width: false, height: true }"
      :height="height"
      :min-height="PDF_EXCERPT_MIN_HEIGHT"
      :max-height="PDF_EXCERPT_MAX_HEIGHT"
      block-type-label="PDF 摘页"
      :block-id="blockId"
      block-type="pdfExcerpt"
      @resize="onResize"
    >
      <template #header-meta>
        <span class="pdf-excerpt-block__meta" :title="fileName">
          {{ fileName }} · 第 {{ startPage }}–{{ endPage }} 页
        </span>
      </template>

      <div class="pdf-excerpt-block">
        <div v-if="loading" class="pdf-excerpt-block__status">正在加载 PDF…</div>
        <div v-else-if="loadError" class="pdf-excerpt-block__fallback">
          <p class="pdf-excerpt-block__error">{{ loadError }}</p>
          <button type="button" class="pdf-excerpt-block__open-btn" @click="openInNewTab">
            在新标签打开正本
          </button>
        </div>
        <div v-else class="pdf-excerpt-block__pages">
          <div
            v-for="page in pageCanvases"
            :key="page.pageNumber"
            :ref="(el) => setPageRef(page.pageNumber, el)"
            class="pdf-excerpt-block__page"
            :data-page-number="page.pageNumber"
          >
            <div class="pdf-excerpt-block__page-label">第 {{ page.pageNumber }} 页</div>
          </div>
        </div>
      </div>
    </ResizableBlockWrapper>
  </node-view-wrapper>
</template>

<style scoped>
.pdf-excerpt-block__meta {
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.pdf-excerpt-block {
  flex: 1;
  min-height: 0;
  overflow: auto;
  background: #f8fafc;
}

.pdf-excerpt-block__status,
.pdf-excerpt-block__fallback {
  display: flex;
  flex-direction: column;
  align-items: flex-start;
  justify-content: center;
  gap: 10px;
  min-height: 120px;
  padding: 16px;
  box-sizing: border-box;
}

.pdf-excerpt-block__error {
  margin: 0;
  color: #b91c1c;
  font-size: 13px;
}

.pdf-excerpt-block__open-btn {
  padding: 6px 12px;
  border: 1px solid #d1d5db;
  border-radius: 6px;
  background: #fff;
  color: #374151;
  font-size: 12px;
  cursor: pointer;
}

.pdf-excerpt-block__pages {
  display: flex;
  flex-direction: column;
  gap: 12px;
  padding: 12px;
}

.pdf-excerpt-block__page {
  background: #fff;
  border: 1px solid #e5e7eb;
  border-radius: 8px;
  padding: 8px;
}

.pdf-excerpt-block__page-label {
  margin-bottom: 6px;
  font-size: 11px;
  color: #64748b;
}

.pdf-excerpt-block__page :deep(.pdf-excerpt-block__canvas) {
  display: block;
  width: 100%;
  height: auto;
}
</style>
