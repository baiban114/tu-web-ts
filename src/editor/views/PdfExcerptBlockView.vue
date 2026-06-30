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
import {
  buildPdfSidebarTree,
  type PdfSidebarNode,
  type PdfSidebarSource,
} from '@/utils/pdfOutline'
import PdfExcerptSidebar from './PdfExcerptSidebar.vue'

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
const sidebarNodes = ref<PdfSidebarNode[]>([])
const sidebarSource = ref<PdfSidebarSource>('pages')
const sidebarOpen = ref(true)
const activePage = ref<number | null>(null)
const pagesScrollRef = ref<HTMLElement | null>(null)

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

const sidebarTitle = computed(() => (sidebarSource.value === 'outline' ? '书签' : '目录'))
const showSidebar = computed(() => sidebarNodes.value.length > 0)

function toggleSidebar() {
  sidebarOpen.value = !sidebarOpen.value
}

function scrollToPage(pageNumber: number) {
  if (pageNumber < startPage.value || pageNumber > endPage.value) return
  activePage.value = pageNumber
  const el = pageRefs.get(pageNumber)
  el?.scrollIntoView({ behavior: 'smooth', block: 'start' })
  void renderPage(pageNumber)
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
  sidebarNodes.value = []
  sidebarSource.value = 'pages'
  activePage.value = null
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
    const sidebar = await buildPdfSidebarTree(doc, normalized.startPage, normalized.endPage)
    if (generation !== loadGeneration) return
    sidebarNodes.value = sidebar.nodes
    sidebarSource.value = sidebar.source
    if (pages.length > 0) {
      activePage.value = pages[0].pageNumber
    }
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

watch(sidebarOpen, () => {
  renderedPages.clear()
  cancelRenderTasks()
  void nextTick().then(() => schedulePageRendering())
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
        <div v-else class="pdf-excerpt-block__content">
          <aside
            v-if="showSidebar && sidebarOpen"
            class="pdf-excerpt-block__sidebar"
            @mousedown.stop
          >
            <div class="pdf-excerpt-block__sidebar-header">
              <span class="pdf-excerpt-block__sidebar-title">{{ sidebarTitle }}</span>
              <button
                type="button"
                class="pdf-excerpt-block__sidebar-toggle"
                :title="`隐藏${sidebarTitle}`"
                :aria-label="`隐藏${sidebarTitle}`"
                @click="toggleSidebar"
              >
                ‹
              </button>
            </div>
            <nav class="pdf-excerpt-block__sidebar-nav" aria-label="PDF 目录">
              <PdfExcerptSidebar
                :nodes="sidebarNodes"
                :start-page="startPage"
                :end-page="endPage"
                :active-page="activePage"
                @navigate="scrollToPage"
              />
            </nav>
          </aside>
          <div class="pdf-excerpt-block__main">
            <button
              v-if="showSidebar && !sidebarOpen"
              type="button"
              class="pdf-excerpt-block__sidebar-expand"
              :title="`显示${sidebarTitle}`"
              :aria-label="`显示${sidebarTitle}`"
              @mousedown.stop
              @click="toggleSidebar"
            >
              <span class="pdf-excerpt-block__sidebar-expand-icon">›</span>
              <span class="pdf-excerpt-block__sidebar-expand-label">{{ sidebarTitle }}</span>
            </button>
            <div ref="pagesScrollRef" class="pdf-excerpt-block__pages">
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
  overflow: hidden;
  background: #f8fafc;
}

.pdf-excerpt-block__content {
  display: flex;
  min-height: 0;
  height: 100%;
}

.pdf-excerpt-block__sidebar {
  flex: 0 0 200px;
  width: 200px;
  min-height: 0;
  display: flex;
  flex-direction: column;
  border-right: 1px solid #e2e8f0;
  background: #f1f5f9;
  box-sizing: border-box;
}

.pdf-excerpt-block__sidebar-header {
  flex-shrink: 0;
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 8px;
  padding: 8px 8px 8px 12px;
}

.pdf-excerpt-block__sidebar-title {
  font-size: 11px;
  font-weight: 600;
  letter-spacing: 0.04em;
  color: #64748b;
}

.pdf-excerpt-block__sidebar-toggle {
  flex-shrink: 0;
  width: 24px;
  height: 24px;
  padding: 0;
  border: none;
  border-radius: 4px;
  background: transparent;
  color: #64748b;
  font-size: 16px;
  line-height: 1;
  cursor: pointer;
}

.pdf-excerpt-block__sidebar-toggle:hover {
  background: #e2e8f0;
  color: #334155;
}

.pdf-excerpt-block__main {
  flex: 1;
  min-width: 0;
  min-height: 0;
  display: flex;
  overflow: hidden;
}

.pdf-excerpt-block__sidebar-expand {
  flex: 0 0 28px;
  width: 28px;
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: flex-start;
  gap: 4px;
  padding: 10px 0;
  border: none;
  border-right: 1px solid #e2e8f0;
  background: #f1f5f9;
  color: #64748b;
  cursor: pointer;
  box-sizing: border-box;
}

.pdf-excerpt-block__sidebar-expand:hover {
  background: #e2e8f0;
  color: #334155;
}

.pdf-excerpt-block__sidebar-expand-icon {
  font-size: 14px;
  line-height: 1;
}

.pdf-excerpt-block__sidebar-expand-label {
  font-size: 11px;
  writing-mode: vertical-rl;
  letter-spacing: 0.08em;
}

.pdf-excerpt-block__sidebar-nav {
  flex: 1;
  min-height: 0;
  overflow-y: auto;
  padding: 0 6px 8px;
}

.pdf-excerpt-block__pages {
  flex: 1;
  min-width: 0;
  min-height: 0;
  overflow: auto;
  display: flex;
  flex-direction: column;
  gap: 12px;
  padding: 12px;
  box-sizing: border-box;
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
