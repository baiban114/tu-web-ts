<script setup lang="ts">
import { computed } from 'vue'
import type { TextAnnotation } from '@/api/types'

const BLOCK_TYPE_LABELS: Record<string, string> = {
  x6Block: 'X6 画板',
  timelineBlock: '时间轴',
  refBlock: '引用',
  spacerBlock: '分割空白',
}

interface Props {
  visible: boolean
  top: number
  left: number
  annotation: TextAnnotation | null
  annotations?: TextAnnotation[]
}

const props = withDefaults(defineProps<Props>(), {
  annotations: () => [],
})

const emit = defineEmits<{
  (e: 'edit', annotation?: TextAnnotation): void
  (e: 'delete', annotation?: TextAnnotation): void
  (e: 'close'): void
}>()

const displayedAnnotations = computed(() => {
  const source = props.annotations.length > 0
    ? props.annotations
    : props.annotation
      ? [props.annotation]
      : []
  return [...source].sort((a, b) => (b.updatedAt || b.createdAt || 0) - (a.updatedAt || a.createdAt || 0))
})

const title = computed(() => displayedAnnotations.value.length > 1
  ? `笔记 ${displayedAnnotations.value.length}`
  : '笔记')
</script>

<template>
  <Teleport to="body">
    <div
      v-if="visible && displayedAnnotations.length"
      class="note-popover-mask"
      @mousedown.self="emit('close')"
    >
      <div
        class="note-popover"
        :style="{ top: `${top}px`, left: `${left}px` }"
        @mousedown.stop
      >
        <div class="note-popover__header">
          <span class="note-popover__label">{{ title }}</span>
          <button type="button" class="note-popover__close" @click="emit('close')">关闭</button>
        </div>

        <div class="note-popover__list">
          <article
            v-for="item in displayedAnnotations"
            :key="item.id"
            class="note-popover__item"
          >
            <div v-if="item.scope !== 'block'" class="note-popover__quote">
              "{{ item.selectedText }}"
            </div>

            <div v-if="item.scope === 'compound' && item.spannedBlockMetadata?.length" class="note-popover__blocks">
              <div class="note-popover__blocks-label">涉及块：</div>
              <div
                v-for="meta in item.spannedBlockMetadata"
                :key="meta.blockId"
                class="note-popover__block-tag"
              >
                {{ BLOCK_TYPE_LABELS[meta.blockType] || meta.blockType }}
                <template v-if="meta.title"> — {{ meta.title }}</template>
              </div>
            </div>

            <div class="note-popover__body">
              {{ item.note }}
            </div>

            <div class="note-popover__actions">
              <button type="button" class="note-popover__edit-btn" @click="emit('edit', item)">
                编辑
              </button>
              <button type="button" class="note-popover__delete-btn" @click="emit('delete', item)">
                删除
              </button>
            </div>
          </article>
        </div>
      </div>
    </div>
  </Teleport>
</template>

<style scoped>
.note-popover-mask {
  position: fixed;
  inset: 0;
  z-index: 1000002;
}

.note-popover {
  position: fixed;
  width: min(360px, calc(100vw - 48px));
  max-height: min(520px, calc(100vh - 48px));
  overflow: auto;
  background: #fff;
  border: 1px solid #e8e8e8;
  border-radius: 10px;
  box-shadow: 0 12px 32px rgba(0, 0, 0, 0.15);
  padding: 12px;
}

.note-popover__header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  margin-bottom: 8px;
}

.note-popover__label {
  font-size: 13px;
  font-weight: 600;
  color: #1f1f1f;
}

.note-popover__close {
  border: none;
  background: transparent;
  color: #8c8c8c;
  cursor: pointer;
  font-size: 12px;
}

.note-popover__list {
  display: flex;
  flex-direction: column;
  gap: 12px;
}

.note-popover__item + .note-popover__item {
  padding-top: 12px;
  border-top: 1px solid #f0f0f0;
}

.note-popover__quote {
  padding: 6px 10px;
  margin-bottom: 8px;
  background: #fffbe6;
  border-left: 3px solid #ffd666;
  border-radius: 4px;
  font-size: 13px;
  color: #595959;
  line-height: 1.5;
  word-break: break-word;
}

.note-popover__body {
  font-size: 14px;
  color: #262626;
  line-height: 1.6;
  margin-bottom: 10px;
  white-space: pre-wrap;
  word-break: break-word;
}

.note-popover__actions {
  display: flex;
  gap: 8px;
}

.note-popover__edit-btn {
  padding: 5px 12px;
  border: 1px solid #d9d9d9;
  border-radius: 6px;
  background: #fff;
  color: #595959;
  cursor: pointer;
  font-size: 12px;
}

.note-popover__delete-btn {
  padding: 5px 12px;
  border: 1px solid #ffccc7;
  border-radius: 6px;
  background: #fff;
  color: #cf1322;
  cursor: pointer;
  font-size: 12px;
}

.note-popover__edit-btn:hover {
  border-color: #1677ff;
  color: #1677ff;
}

.note-popover__delete-btn:hover {
  background: #fff1f0;
}

.note-popover__blocks {
  margin-bottom: 8px;
  padding: 8px 10px;
  background: #f0fdf4;
  border-left: 3px solid #86efac;
  border-radius: 4px;
}

.note-popover__blocks-label {
  font-size: 12px;
  color: #6b7280;
  margin-bottom: 4px;
}

.note-popover__block-tag {
  display: inline-flex;
  align-items: center;
  gap: 2px;
  padding: 1px 6px;
  margin: 2px 2px 2px 0;
  border-radius: 3px;
  background: #dcfce7;
  color: #166534;
  font-size: 12px;
  font-weight: 500;
}
</style>
