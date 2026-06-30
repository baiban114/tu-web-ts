<script setup lang="ts">
import { computed, ref, watch } from 'vue'
import { ElButton, ElDialog, ElInputNumber, ElMessage } from 'element-plus'
import { buildFileUrl, uploadPdfFile } from '@/api/fileStorage'
import {
  PDF_EXCERPT_DEFAULT_HEIGHT,
  normalizePdfPageRange,
} from '@/utils/pdfExcerpt'
import { loadPdfPageCount } from '@/utils/pdfDocumentCache'

export interface PdfExcerptSelection {
  fileId: string
  fileName: string
  startPage: number
  endPage: number
  height: number
}

const props = defineProps<{
  visible: boolean
}>()

const emit = defineEmits<{
  'update:visible': [visible: boolean]
  confirm: [selection: PdfExcerptSelection]
}>()

const inputRef = ref<HTMLInputElement | null>(null)
const uploading = ref(false)
const inspecting = ref(false)
const fileId = ref('')
const fileName = ref('')
const totalPages = ref(1)
const startPage = ref(1)
const endPage = ref(1)
const height = ref(PDF_EXCERPT_DEFAULT_HEIGHT)

const dialogVisible = computed({
  get: () => props.visible,
  set: (value: boolean) => emit('update:visible', value),
})

const canConfirm = computed(() => Boolean(fileId.value) && startPage.value <= endPage.value)

function resetState() {
  uploading.value = false
  inspecting.value = false
  fileId.value = ''
  fileName.value = ''
  totalPages.value = 1
  startPage.value = 1
  endPage.value = 1
  height.value = PDF_EXCERPT_DEFAULT_HEIGHT
}

watch(() => props.visible, (visible) => {
  if (!visible) resetState()
})

function openFilePicker() {
  inputRef.value?.click()
}

async function handleFileChange(event: Event) {
  const target = event.target as HTMLInputElement | null
  const file = target?.files?.[0]
  if (target) target.value = ''
  if (!file) return

  uploading.value = true
  inspecting.value = true
  try {
    const uploaded = await uploadPdfFile(file)
    fileId.value = uploaded.id
    fileName.value = file.name
    const url = uploaded.url || buildFileUrl(uploaded.id)
    const pages = await loadPdfPageCount(url)
    totalPages.value = pages
    startPage.value = 1
    endPage.value = Math.min(1, pages)
    if (pages >= 1) endPage.value = 1
  } catch (error) {
    const message = error instanceof Error ? error.message : 'PDF 上传失败'
    ElMessage.error(message)
    resetState()
  } finally {
    uploading.value = false
    inspecting.value = false
  }
}

function clampRange() {
  const normalized = normalizePdfPageRange(startPage.value, endPage.value, totalPages.value)
  startPage.value = normalized.startPage
  endPage.value = normalized.endPage
}

function onConfirm() {
  if (!canConfirm.value || !fileId.value) return
  clampRange()
  emit('confirm', {
    fileId: fileId.value,
    fileName: fileName.value,
    startPage: startPage.value,
    endPage: endPage.value,
    height: height.value,
  })
  dialogVisible.value = false
}
</script>

<template>
  <el-dialog
    v-model="dialogVisible"
    class="tu-dialog-viewport"
    title="插入 PDF 摘页"
    width="520px"
    @click.stop
  >
    <input
      ref="inputRef"
      class="pdf-excerpt-picker__input"
      type="file"
      accept="application/pdf,.pdf"
      @change="handleFileChange"
    >

    <div class="pdf-excerpt-picker">
      <p class="pdf-excerpt-picker__hint">
        上传 PDF 正本后，仅嵌入所选页码范围；阅读时通过 Range 按需加载，不会切割原文件。
      </p>

      <div class="pdf-excerpt-picker__file-row">
        <el-button :loading="uploading" @click="openFilePicker">
          {{ fileId ? '重新选择 PDF' : '选择 PDF 文件' }}
        </el-button>
        <span v-if="fileName" class="pdf-excerpt-picker__file-name" :title="fileName">
          {{ fileName }}
        </span>
      </div>

      <div v-if="fileId" class="pdf-excerpt-picker__range">
        <div class="pdf-excerpt-picker__field">
          <span>总页数</span>
          <strong>{{ inspecting ? '…' : totalPages }}</strong>
        </div>
        <div class="pdf-excerpt-picker__field">
          <span>起始页</span>
          <el-input-number
            v-model="startPage"
            :min="1"
            :max="totalPages"
            :disabled="inspecting"
            @change="clampRange"
          />
        </div>
        <div class="pdf-excerpt-picker__field">
          <span>结束页</span>
          <el-input-number
            v-model="endPage"
            :min="startPage"
            :max="totalPages"
            :disabled="inspecting"
            @change="clampRange"
          />
        </div>
        <div class="pdf-excerpt-picker__field">
          <span>块高度</span>
          <el-input-number v-model="height" :min="160" :max="2000" :step="40" />
        </div>
      </div>
    </div>

    <template #footer>
      <el-button @click="dialogVisible = false">取消</el-button>
      <el-button type="primary" :disabled="!canConfirm || uploading || inspecting" @click="onConfirm">
        插入摘页
      </el-button>
    </template>
  </el-dialog>
</template>

<style scoped>
.pdf-excerpt-picker__input {
  display: none;
}

.pdf-excerpt-picker {
  display: flex;
  flex-direction: column;
  gap: 16px;
}

.pdf-excerpt-picker__hint {
  margin: 0;
  font-size: 13px;
  color: #64748b;
  line-height: 1.5;
}

.pdf-excerpt-picker__file-row {
  display: flex;
  align-items: center;
  gap: 12px;
}

.pdf-excerpt-picker__file-name {
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  font-size: 13px;
  color: #334155;
}

.pdf-excerpt-picker__range {
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: 12px;
}

.pdf-excerpt-picker__field {
  display: flex;
  flex-direction: column;
  gap: 6px;
  font-size: 12px;
  color: #64748b;
}
</style>
