<script setup lang="ts">
import { computed, inject, onMounted, ref, unref, watch, type Ref } from 'vue'
import { nodeViewProps, NodeViewWrapper } from '@tiptap/vue-3'
import ResizableBlockWrapper from '../components/ResizableBlockWrapper.vue'
import {
  getResourceExcerpt,
  getResourceItem,
  type ResourceExcerpt,
  type ResourceItem,
} from '@/api/externalResource'
import type { ExternalResourceEmbedData, ExternalResourceSnapshot } from '@/api/types'

interface CompoundBadge {
  annotationId: string
  color: string
}

const props = defineProps(nodeViewProps)

const compoundAnnotationBadges = inject<Record<string, CompoundBadge[]> | Ref<Record<string, CompoundBadge[]>>>('compoundAnnotationBadges', {})
const onCompoundBadgeClick = inject<((blockId: string, annotationId: string, event: MouseEvent) => void)>('onCompoundBadgeClick', () => {})

const latestItem = ref<ResourceItem | null>(null)
const latestExcerpt = ref<ResourceExcerpt | null>(null)
const loading = ref(false)
const loadError = ref('')

const blockId = computed(() => props.node.attrs.blockId || '')
const headingLevel = computed(() => props.node.attrs.headingLevel || 0)
const data = computed<ExternalResourceEmbedData>(() => props.node.attrs.externalResource || {
  resourceItemId: '',
  resourceExcerptId: null,
  mode: 'resource',
  snapshot: { resourceTitle: '' },
})
const snapshot = computed<ExternalResourceSnapshot>(() => data.value.snapshot || { resourceTitle: '' })
const compoundBadges = computed(() => unref(compoundAnnotationBadges)[blockId.value] || [])

const resourceTitle = computed(() => latestItem.value?.title || snapshot.value.resourceTitle || '外部资源')
const resourceTypeName = computed(() => latestItem.value?.typeName || snapshot.value.resourceTypeName || '外部资源')
const workTitle = computed(() => latestItem.value?.workTitle || snapshot.value.workTitle || '')
const identityLabel = computed(() => latestItem.value?.identityFieldLabel || snapshot.value.identityFieldLabel || '标识')
const identityValue = computed(() => latestItem.value?.identityValue || snapshot.value.identityValue || '')
const sourceUrl = computed(() => latestItem.value?.sourceUrl || snapshot.value.sourceUrl || '')
const excerptTitle = computed(() => latestExcerpt.value?.title || snapshot.value.excerptTitle || '')
const excerptLocator = computed(() => latestExcerpt.value?.locator || snapshot.value.excerptLocator || '')
const excerptText = computed(() => latestExcerpt.value?.excerptText || snapshot.value.excerptText || '')
const excerptNote = computed(() => latestExcerpt.value?.note || snapshot.value.excerptNote || '')
const isExcerpt = computed(() => data.value.mode === 'excerpt' || Boolean(data.value.resourceExcerptId))
const usingSnapshot = computed(() => Boolean(loadError.value || (!latestItem.value && snapshot.value.resourceTitle)))
const headingText = computed(() => props.node.attrs.title || (isExcerpt.value ? excerptTitle.value : resourceTitle.value))

const loadResource = async () => {
  if (!data.value.resourceItemId) return
  loading.value = true
  loadError.value = ''
  latestItem.value = null
  latestExcerpt.value = null
  try {
    latestItem.value = await getResourceItem(data.value.resourceItemId)
    if (data.value.resourceExcerptId) {
      latestExcerpt.value = await getResourceExcerpt(data.value.resourceExcerptId)
    }
  } catch (err) {
    loadError.value = err instanceof Error ? err.message : '资源加载失败'
  } finally {
    loading.value = false
  }
}

const onResize = (width: number | null, _height: number | null) => {
  props.updateAttributes({ width })
}

const handleBadgeClick = (bid: string, annotationId: string, event: MouseEvent) => {
  onCompoundBadgeClick(bid, annotationId, event)
}

watch(() => [data.value.resourceItemId, data.value.resourceExcerptId], () => {
  void loadResource()
})

onMounted(() => {
  void loadResource()
})
</script>

<template>
  <node-view-wrapper class="external-resource-block-view">
    <ResizableBlockWrapper
      :selected="selected"
      :resizable-axes="{ width: true, height: false }"
      :min-width="260"
      block-type-label="外部资源"
      :block-id="blockId"
      block-type="externalResource"
      :compound-badges="compoundBadges"
      :heading-level="headingLevel"
      :heading-text="headingText"
      @resize="onResize"
      @compound-badge-click="handleBadgeClick"
    >
      <article class="external-resource-card" :class="{ 'external-resource-card--excerpt': isExcerpt }">
        <header class="external-resource-card__header">
          <span class="external-resource-card__badge">{{ isExcerpt ? '图书节选' : resourceTypeName }}</span>
          <span v-if="usingSnapshot" class="external-resource-card__snapshot">快照</span>
        </header>
        <h3>{{ isExcerpt ? (excerptTitle || resourceTitle) : resourceTitle }}</h3>
        <p class="external-resource-card__meta">
          <span>{{ resourceTypeName }}</span>
          <span v-if="workTitle"> · {{ workTitle }}</span>
          <span v-if="identityValue"> · {{ identityLabel }}: {{ identityValue }}</span>
        </p>
        <p v-if="isExcerpt && excerptLocator" class="external-resource-card__locator">{{ excerptLocator }}</p>
        <blockquote v-if="isExcerpt && excerptText">{{ excerptText }}</blockquote>
        <p v-if="isExcerpt && excerptNote" class="external-resource-card__note">{{ excerptNote }}</p>
        <a v-if="sourceUrl" :href="sourceUrl" target="_blank" rel="noreferrer">{{ sourceUrl }}</a>
        <p v-if="loading" class="external-resource-card__status">正在加载最新资源...</p>
        <p v-else-if="loadError" class="external-resource-card__status external-resource-card__status--warn">
          最新资源不可用，已显示插入时快照。
        </p>
      </article>
    </ResizableBlockWrapper>
  </node-view-wrapper>
</template>

<style scoped>
.external-resource-card {
  display: grid;
  gap: 8px;
  border: 1px solid #d8dee8;
  border-radius: 8px;
  padding: 14px;
  background: #ffffff;
  color: #1f2937;
}

.external-resource-card__header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 8px;
}

.external-resource-card__badge,
.external-resource-card__snapshot {
  border-radius: 999px;
  padding: 2px 8px;
  font-size: 12px;
}

.external-resource-card__badge {
  color: #075985;
  background: #e0f2fe;
}

.external-resource-card__snapshot {
  color: #92400e;
  background: #fef3c7;
}

.external-resource-card h3,
.external-resource-card p {
  margin: 0;
}

.external-resource-card h3 {
  font-size: 16px;
}

.external-resource-card__meta,
.external-resource-card__locator,
.external-resource-card__note,
.external-resource-card__status {
  color: #64748b;
  font-size: 13px;
}

.external-resource-card blockquote {
  margin: 0;
  border-left: 3px solid #38bdf8;
  padding: 8px 10px;
  background: #f8fafc;
  color: #334155;
  white-space: pre-wrap;
}

.external-resource-card a {
  color: #1677ff;
  font-size: 13px;
  overflow-wrap: anywhere;
}

.external-resource-card__status--warn {
  color: #b45309;
}
</style>
