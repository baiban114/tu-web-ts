<script setup lang="ts">
import type { TextAnnotation } from '@/api/types';

interface Props {
  visible: boolean;
  top: number;
  left: number;
  annotation: TextAnnotation | null;
}

defineProps<Props>();

const emit = defineEmits<{
  (e: 'edit'): void;
  (e: 'delete'): void;
  (e: 'close'): void;
}>();
</script>

<template>
  <Teleport to="body">
    <div v-if="visible && annotation" class="note-popover-mask" @mousedown.self="emit('close')">
      <div
        class="note-popover"
        :style="{ top: `${top}px`, left: `${left}px` }"
        @mousedown.stop
      >
        <div class="note-popover__header">
          <span class="note-popover__label">笔记</span>
          <button type="button" class="note-popover__close" @click="emit('close')">关闭</button>
        </div>

        <div class="note-popover__quote">
          “{{ annotation.selectedText }}”
        </div>

        <div class="note-popover__body">
          {{ annotation.note }}
        </div>

        <div class="note-popover__actions">
          <button type="button" class="note-popover__edit-btn" @click="emit('edit')">编辑</button>
          <button type="button" class="note-popover__delete-btn" @click="emit('delete')">删除</button>
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
  width: min(320px, calc(100vw - 48px));
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
</style>
