<script setup lang="ts">
import { nextTick, ref, watch } from 'vue';
import type { TextAnnotation } from '@/api/types';

interface Props {
  visible: boolean;
  annotation?: TextAnnotation | null;
}

const props = defineProps<Props>();

const emit = defineEmits<{
  (e: 'save', note: string): void;
  (e: 'cancel'): void;
}>();

const noteText = ref('');
const textareaRef = ref<HTMLTextAreaElement | null>(null);

watch(
  () => props.visible,
  (visible) => {
    if (!visible) {
      noteText.value = '';
      return;
    }
    noteText.value = props.annotation?.note ?? '';
    void nextTick(() => {
      textareaRef.value?.focus();
      textareaRef.value?.select();
    });
  },
);

const handleSave = () => {
  const text = noteText.value.trim();
  if (!text) return;
  emit('save', text);
};

const handleKeydown = (event: KeyboardEvent) => {
  if (event.key === 'Enter' && (event.ctrlKey || event.metaKey)) {
    event.preventDefault();
    handleSave();
    return;
  }
  if (event.key === 'Escape') {
    event.preventDefault();
    emit('cancel');
  }
};
</script>

<template>
  <Teleport to="body">
    <div v-if="visible" class="note-editor-mask" @mousedown.self="emit('cancel')">
      <div class="note-editor-popover" @mousedown.stop>
        <div class="note-editor-header">
          <span class="note-editor-title">{{ annotation ? '编辑笔记' : '添加笔记' }}</span>
          <button type="button" class="note-editor-close" @click="emit('cancel')">关闭</button>
        </div>

        <textarea
          ref="textareaRef"
          v-model="noteText"
          class="note-editor-textarea"
          placeholder="输入笔记内容..."
          @keydown="handleKeydown"
        />

        <div class="note-editor-footer">
          <button type="button" class="note-editor-cancel-btn" @click="emit('cancel')">取消</button>
          <button
            type="button"
            class="note-editor-save-btn"
            :disabled="!noteText.trim()"
            @click="handleSave"
          >
            保存
          </button>
        </div>
      </div>
    </div>
  </Teleport>
</template>

<style scoped>
.note-editor-mask {
  position: fixed;
  inset: 0;
  z-index: 1000002;
}

.note-editor-popover {
  position: fixed;
  top: 50%;
  left: 50%;
  transform: translate(-50%, -50%);
  width: min(400px, calc(100vw - 48px));
  background: #fff;
  border: 1px solid #e8e8e8;
  border-radius: 12px;
  box-shadow: 0 16px 48px rgba(0, 0, 0, 0.18);
  padding: 16px;
}

.note-editor-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  margin-bottom: 12px;
}

.note-editor-title {
  font-size: 15px;
  font-weight: 600;
  color: #1f1f1f;
}

.note-editor-close {
  border: none;
  background: transparent;
  color: #8c8c8c;
  cursor: pointer;
  font-size: 13px;
}

.note-editor-textarea {
  width: 100%;
  box-sizing: border-box;
  min-height: 120px;
  padding: 10px 12px;
  border: 1px solid #d9d9d9;
  border-radius: 8px;
  font-size: 14px;
  font-family: inherit;
  line-height: 1.6;
  resize: vertical;
  outline: none;
}

.note-editor-textarea:focus {
  border-color: #1677ff;
  box-shadow: 0 0 0 2px rgba(22, 119, 255, 0.12);
}

.note-editor-footer {
  display: flex;
  justify-content: flex-end;
  gap: 8px;
  margin-top: 12px;
}

.note-editor-cancel-btn {
  padding: 6px 14px;
  border: 1px solid #d9d9d9;
  border-radius: 6px;
  background: #fff;
  color: #595959;
  cursor: pointer;
  font-size: 13px;
}

.note-editor-save-btn {
  padding: 6px 14px;
  border: 1px solid #1677ff;
  border-radius: 6px;
  background: #1677ff;
  color: #fff;
  cursor: pointer;
  font-size: 13px;
  font-weight: 500;
}

.note-editor-save-btn:disabled {
  border-color: #d9d9d9;
  background: #f5f5f5;
  color: #bfbfbf;
  cursor: not-allowed;
}
</style>
