<script setup lang="ts">
import { computed, reactive, ref, watch } from 'vue'
import { ElDialog, ElEmpty, ElInput, ElScrollbar } from 'element-plus'
import {
  createResourceExcerpt,
  listResourceExcerpts,
  listResourceChapters,
  listResourceItems,
  listResourceTypes,
  supportsResourceExcerpts,
  supportsBookChapters,
  type ResourceChapter,
  type ResourceExcerpt,
  type ResourceItem,
  type ResourceType,
} from '@/api/externalResource'
import { MAX_PAGE_SIZE } from '@/constants/pagination'
import { buildTreeFromFlat } from '@/utils/tree'
import type { Block, ExternalResourceEmbedData } from '@/api/types'
import TuEditor from './TuEditor.vue'

export interface ExternalResourcePickerSelection {
  title: string
  externalResource: ExternalResourceEmbedData
}

export interface ExternalResourcePickerExcerptCreated {
  item: ResourceItem
  excerpt: ResourceExcerpt
}

const props = defineProps<{
  visible: boolean
  mode?: 'insert' | 'markExcerpt'
  initialExcerptText?: string
  initialExcerptTitle?: string
}>()

const emit = defineEmits<{
  (e: 'update:visible', val: boolean): void
  (e: 'select', selection: ExternalResourcePickerSelection): void
  (e: 'excerpt-created', payload: ExternalResourcePickerExcerptCreated): void
}>()

const loading = ref(false)
const excerptLoading = ref(false)
const error = ref('')
const keyword = ref('')
const types = ref<ResourceType[]>([])
const items = ref<ResourceItem[]>([])
const excerpts = ref<ResourceExcerpt[]>([])
const chapters = ref<ResourceChapter[]>([])
const selectedItemId = ref('')
const EXCERPT_EDITOR_BLOCK_ID = 'resource-picker-excerpt-editor'

const excerptForm = reactive({
  title: '',
  chapterId: '' as string | null,
  locator: '',
  excerptText: '',
  note: '',
})

const typeById = computed(() => new Map(types.value.map((type) => [type.id, type])))
const selectedItem = computed(() => items.value.find((item) => item.id === selectedItemId.value) || null)
const selectedItemType = computed(() => selectedItem.value ? typeById.value.get(selectedItem.value.typeId) : null)
const selectedSupportsExcerpts = computed(() => supportsResourceExcerpts(selectedItemType.value?.code))
const selectedSupportsBookChapters = computed(() => supportsBookChapters(selectedItemType.value?.code))
const isMarkExcerptMode = computed(() => props.mode === 'markExcerpt')
const excerptLocatorPlaceholder = computed(() => (
  selectedItemType.value?.code === 'web-link'
    ? '章节锚点 / 段落位置（可选）'
    : '页码/段落，例如 p. 18'
))
const excerptChapterTreeOptions = computed(() => {
  type TreeSelectOption = { value: string; label: string; children?: TreeSelectOption[] };
  const flat = chapters.value.map((chapter) => ({
    id: chapter.id,
    parentId: chapter.parentId ?? null,
    label: chapter.title,
    order: chapter.sortOrder,
  }));
  const toTreeSelect = (nodes: ReturnType<typeof buildTreeFromFlat>): TreeSelectOption[] => (
    nodes.map((node) => ({
      value: node.id,
      label: node.label,
      ...(node.children?.length ? { children: toTreeSelect(node.children) } : {}),
    }))
  );
  return toTreeSelect(buildTreeFromFlat(flat));
})
const excerptEditorBlocks = computed<Block[]>(() => [{
  id: EXCERPT_EDITOR_BLOCK_ID,
  type: 'richtext',
  content: excerptForm.excerptText,
}])

const filteredItems = computed(() => {
  const q = keyword.value.trim().toLowerCase()
  const sourceItems = isMarkExcerptMode.value
    ? items.value.filter((item) => supportsResourceExcerpts(typeById.value.get(item.typeId)?.code))
    : items.value
  if (!q) return sourceItems
  return sourceItems.filter((item) => [
    item.title,
    item.typeName,
    item.workTitle,
    item.identityValue,
    item.sourceUrl,
  ].filter(Boolean).join(' ').toLowerCase().includes(q))
})

const resetExcerptForm = () => {
  excerptForm.title = props.initialExcerptTitle || ''
  excerptForm.chapterId = ''
  excerptForm.locator = ''
  excerptForm.excerptText = props.initialExcerptText || ''
  excerptForm.note = ''
}

const handleExcerptEditorUpdate = (blocks: Block[]) => {
  const richTextBlock = blocks.find((block) => block.type === 'richtext' || block.type === 'richText')
  excerptForm.excerptText = richTextBlock?.content ?? ''
}

const loadResources = async () => {
  loading.value = true
  error.value = ''
  try {
    const [nextTypes, nextItems] = await Promise.all([
      listResourceTypes({ page: 0, pageSize: MAX_PAGE_SIZE }),
      listResourceItems({ page: 0, pageSize: MAX_PAGE_SIZE }),
    ])
    types.value = nextTypes.items
    items.value = nextItems.items
    const nextTypeById = new Map(nextTypes.items.map((type) => [type.id, type]))
    const firstAvailableItem = isMarkExcerptMode.value
      ? nextItems.items.find((item) => supportsResourceExcerpts(nextTypeById.get(item.typeId)?.code))
      : nextItems.items[0]
    const selectedStillUsable = nextItems.items.some((item) => (
      item.id === selectedItemId.value
      && (!isMarkExcerptMode.value || supportsResourceExcerpts(nextTypeById.get(item.typeId)?.code))
    ))
    if (!selectedItemId.value || !selectedStillUsable) {
      selectedItemId.value = firstAvailableItem?.id || ''
    }
  } catch (err) {
    error.value = err instanceof Error ? err.message : '加载外部资源失败'
  } finally {
    loading.value = false
  }
}

const loadExcerpts = async () => {
  excerpts.value = []
  chapters.value = []
  resetExcerptForm()
  if (!selectedItem.value || !selectedSupportsExcerpts.value) return
  excerptLoading.value = true
  error.value = ''
  try {
    const [result, chapterList] = await Promise.all([
      listResourceExcerpts(selectedItem.value.id, { page: 0, pageSize: MAX_PAGE_SIZE }),
      selectedSupportsBookChapters.value
        ? listResourceChapters(selectedItem.value.id)
        : Promise.resolve([]),
    ])
    excerpts.value = result.items
    chapters.value = chapterList
  } catch (err) {
    error.value = err instanceof Error ? err.message : '加载节选失败'
  } finally {
    excerptLoading.value = false
  }
}

const snapshotFor = (item: ResourceItem, excerpt?: ResourceExcerpt) => ({
  resourceTitle: item.title,
  resourceTypeName: item.typeName,
  workTitle: item.workTitle || undefined,
  identityFieldLabel: item.identityFieldLabel,
  identityValue: item.identityValue || undefined,
  sourceUrl: item.sourceUrl,
  edition: item.edition,
  note: item.note,
  excerptTitle: excerpt?.title,
  chapterTitle: excerpt?.chapterTitle || undefined,
  excerptLocator: excerpt?.locator,
  excerptText: excerpt?.excerptText,
  excerptNote: excerpt?.note,
})

const selectResource = (item: ResourceItem) => {
  emit('select', {
    title: item.title,
    externalResource: {
      resourceItemId: item.id,
      resourceExcerptId: null,
      mode: 'resource',
      snapshot: snapshotFor(item),
    },
  })
  emit('update:visible', false)
}

const selectExcerpt = (excerpt: ResourceExcerpt) => {
  const item = selectedItem.value
  if (!item) return
  emit('select', {
    title: excerpt.title || item.title,
    externalResource: {
      resourceItemId: item.id,
      resourceExcerptId: excerpt.id,
      mode: 'excerpt',
      snapshot: snapshotFor(item, excerpt),
    },
  })
  emit('update:visible', false)
}

const createAndInsertExcerpt = async () => {
  const item = selectedItem.value
  if (!item || !selectedSupportsExcerpts.value || !excerptForm.title.trim()) return
  error.value = ''
  try {
    const excerpt = await createResourceExcerpt(item.id, {
      title: excerptForm.title.trim(),
      chapterId: excerptForm.chapterId?.trim() || undefined,
      locator: excerptForm.locator.trim(),
      excerptText: excerptForm.excerptText.trim() || undefined,
      note: excerptForm.note.trim(),
      sortOrder: excerpts.value.length,
    })
    excerpts.value = [...excerpts.value, excerpt]
    if (isMarkExcerptMode.value) {
      emit('excerpt-created', { item, excerpt })
      emit('update:visible', false)
      return
    }
    selectExcerpt(excerpt)
  } catch (err) {
    error.value = err instanceof Error ? err.message : '创建节选失败'
  }
}

watch(() => props.visible, (visible) => {
  if (!visible) return
  keyword.value = ''
  resetExcerptForm()
  void loadResources()
})

watch(() => [props.initialExcerptText, props.initialExcerptTitle, props.mode], () => {
  if (props.visible) resetExcerptForm()
})

watch(selectedItemId, () => {
  void loadExcerpts()
})
</script>

<template>
  <el-dialog
    :model-value="visible"
    :title="isMarkExcerptMode ? '标记为外部资源节选' : '插入外部资源'"
    width="760px"
    @update:model-value="emit('update:visible', $event)"
  >
    <div class="resource-picker">
      <el-input v-model="keyword" placeholder="搜索资源标题、类型、归类或标识" clearable />
      <p v-if="error" class="resource-picker__error">{{ error }}</p>
      <div class="resource-picker__layout">
        <section class="resource-picker__list">
          <div class="resource-picker__section-title">{{ isMarkExcerptMode ? '可节选资源' : '资源实体' }}</div>
          <el-scrollbar height="360px">
            <button
              v-for="item in filteredItems"
              :key="item.id"
              type="button"
              class="resource-picker__item"
              :class="{ 'resource-picker__item--active': selectedItemId === item.id }"
              @click="selectedItemId = item.id"
            >
              <span>{{ item.title }}</span>
              <small>{{ item.typeName }} · {{ item.workTitle || '未归类' }} · {{ item.identityFieldLabel }}: {{ item.identityValue || '未填写' }}</small>
            </button>
            <el-empty
              v-if="!loading && filteredItems.length === 0"
              :description="isMarkExcerptMode ? '没有可标记节选的资源（图书/网络链接）' : '没有找到外部资源'"
              :image-size="64"
            />
          </el-scrollbar>
        </section>

        <section class="resource-picker__detail">
          <template v-if="selectedItem">
            <div class="resource-picker__section-title">插入</div>
            <h3>{{ selectedItem.title }}</h3>
            <p>{{ selectedItem.typeName }} · {{ selectedItem.workTitle || '未归类' }}</p>
            <p>{{ selectedItem.identityFieldLabel }}: {{ selectedItem.identityValue || '未填写' }}</p>
            <a v-if="selectedItem.sourceUrl" :href="selectedItem.sourceUrl" target="_blank" rel="noreferrer">{{ selectedItem.sourceUrl }}</a>
            <button
              v-if="!isMarkExcerptMode"
              type="button"
              class="resource-picker__primary"
              @click="selectResource(selectedItem)"
            >
              插入整个资源
            </button>

            <div v-if="selectedSupportsExcerpts" class="resource-picker__excerpts">
              <div class="resource-picker__section-title">资源节选</div>
              <button
                v-for="excerpt in excerpts"
                :key="excerpt.id"
                type="button"
                class="resource-picker__excerpt"
                @click="selectExcerpt(excerpt)"
              >
                <span>{{ excerpt.title }}</span>
                <small v-if="excerpt.chapterTitle">章节：{{ excerpt.chapterTitle }}</small>
                <small v-if="excerpt.locator">{{ excerpt.locator }}</small>
                <em>{{ excerpt.excerptText }}</em>
              </button>
              <p v-if="!excerptLoading && excerpts.length === 0" class="resource-picker__empty">暂无节选</p>

              <form class="resource-picker__form" @submit.prevent="createAndInsertExcerpt">
                <input v-model.trim="excerptForm.title" placeholder="节选标题" required maxlength="255" />
                <el-tree-select
                  v-if="selectedSupportsBookChapters && excerptChapterTreeOptions.length"
                  v-model="excerptForm.chapterId"
                  :data="excerptChapterTreeOptions"
                  check-strictly
                  clearable
                  filterable
                  placeholder="所属章节（可选）"
                  style="width: 100%"
                />
                <input v-model.trim="excerptForm.locator" :placeholder="excerptLocatorPlaceholder" maxlength="255" />
                <div
                  class="resource-picker__rich-editor"
                  @mousedown.stop
                  @click.stop
                  @keydown.stop
                >
                  <TuEditor
                    :blocks="excerptEditorBlocks"
                    :hover-handle="false"
                    class="resource-picker__tu-editor"
                    @update:blocks="handleExcerptEditorUpdate"
                  />
                </div>
                <textarea v-model.trim="excerptForm.note" placeholder="备注，可选" rows="2" maxlength="1024" />
                <button type="submit" :disabled="!excerptForm.title.trim()">
                  {{ isMarkExcerptMode ? '创建节选' : '创建并插入节选' }}
                </button>
              </form>
            </div>
          </template>
          <el-empty v-else description="请选择外部资源" :image-size="64" />
        </section>
      </div>
    </div>
  </el-dialog>
</template>

<style scoped>
.resource-picker {
  display: grid;
  gap: 12px;
}

.resource-picker__layout {
  display: grid;
  grid-template-columns: minmax(260px, 1fr) minmax(300px, 1.1fr);
  gap: 14px;
}

.resource-picker__list,
.resource-picker__detail {
  min-width: 0;
  border: 1px solid #e5e7eb;
  border-radius: 8px;
  padding: 12px;
}

.resource-picker__section-title {
  margin-bottom: 8px;
  color: #64748b;
  font-size: 12px;
  font-weight: 700;
}

.resource-picker__item,
.resource-picker__excerpt {
  display: grid;
  gap: 4px;
  width: 100%;
  border: 0;
  border-bottom: 1px solid #f1f5f9;
  padding: 10px;
  background: transparent;
  color: #1f2937;
  text-align: left;
  cursor: pointer;
}

.resource-picker__item:hover,
.resource-picker__item--active,
.resource-picker__excerpt:hover {
  background: #eff6ff;
}

.resource-picker__item small,
.resource-picker__excerpt small,
.resource-picker__detail p,
.resource-picker__empty {
  margin: 0;
  color: #64748b;
  font-size: 12px;
}

.resource-picker__detail h3 {
  margin: 0 0 8px;
}

.resource-picker__detail a {
  display: block;
  margin-top: 8px;
  color: #1677ff;
  overflow-wrap: anywhere;
}

.resource-picker__primary,
.resource-picker__form button {
  border: 1px solid #1677ff;
  border-radius: 6px;
  padding: 8px 12px;
  background: #1677ff;
  color: #fff;
  cursor: pointer;
}

.resource-picker__primary {
  margin-top: 12px;
}

.resource-picker__excerpts {
  display: grid;
  gap: 8px;
  margin-top: 16px;
}

.resource-picker__excerpt em {
  color: #334155;
  font-size: 12px;
  font-style: normal;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.resource-picker__form {
  display: grid;
  gap: 8px;
  margin-top: 8px;
}

.resource-picker__form input,
.resource-picker__form textarea {
  border: 1px solid #cbd5e1;
  border-radius: 6px;
  padding: 8px 10px;
  font: inherit;
}

.resource-picker__rich-editor {
  min-height: 140px;
  max-height: 260px;
  overflow-y: auto;
  border: 1px solid #cbd5e1;
  border-radius: 6px;
  background: #fff;
}

.resource-picker__tu-editor {
  min-height: 140px;
}

.resource-picker__tu-editor :deep(.tu-editor-wrapper) {
  min-height: 140px;
  --tiptap-handle-gutter: 0;
}

.resource-picker__tu-editor :deep(.tu-editor-content) {
  min-height: 140px;
  padding: 8px 10px;
  line-height: 1.55;
  font-size: 14px;
  overflow-wrap: anywhere;
}

.resource-picker__tu-editor :deep(.tu-editor-content p) {
  margin: 0;
}

.resource-picker__tu-editor :deep(.tu-editor-content p + p) {
  margin-top: 6px;
}

.resource-picker__tu-editor :deep(.tu-editor-content h1),
.resource-picker__tu-editor :deep(.tu-editor-content h2),
.resource-picker__tu-editor :deep(.tu-editor-content h3),
.resource-picker__tu-editor :deep(.tu-editor-content h4),
.resource-picker__tu-editor :deep(.tu-editor-content h5),
.resource-picker__tu-editor :deep(.tu-editor-content h6) {
  margin: 0 0 6px;
  font-size: 15px;
  line-height: 1.35;
}

.resource-picker__tu-editor :deep(.tu-editor-content ul),
.resource-picker__tu-editor :deep(.tu-editor-content ol) {
  margin: 0;
  padding-left: 18px;
}

.resource-picker__form button:disabled {
  cursor: not-allowed;
  opacity: 0.6;
}

.resource-picker__error {
  margin: 0;
  color: #b91c1c;
  font-size: 13px;
}

@media (max-width: 720px) {
  .resource-picker__layout {
    grid-template-columns: 1fr;
  }
}
</style>
