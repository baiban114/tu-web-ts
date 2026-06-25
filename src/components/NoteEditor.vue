<script setup lang="ts">
import { computed, nextTick, ref, watch } from 'vue';
import type { BlockTag, TextAnnotation } from '@/api/types';
import { createTagColor, normalizeBlockTag, normalizeTagLabel } from '@/utils/blockMetadata';
import { resolveTagEditorEnterAction } from '@/utils/tagEditorEnter';

interface Props {
  visible: boolean;
  annotation?: TextAnnotation | null;
  selectedTags?: BlockTag[];
  availableTags?: BlockTag[];
}

const props = withDefaults(defineProps<Props>(), {
  selectedTags: () => [],
  availableTags: () => [],
});

const emit = defineEmits<{
  (e: 'save', payload: { note: string; tags: BlockTag[] }): void;
  (e: 'cancel'): void;
}>();

const noteText = ref('');
const tags = ref<BlockTag[]>([]);
const tagQuery = ref('');
const textareaRef = ref<HTMLTextAreaElement | null>(null);
const tagInputRef = ref<HTMLInputElement | null>(null);

const normalizedQuery = computed(() => normalizeTagLabel(tagQuery.value).toLowerCase());
const selectedKeys = computed(() => new Set(tags.value.map((tag) => tag.label.toLowerCase())));

const filteredCandidates = computed(() => {
  const keyword = normalizedQuery.value;
  return props.availableTags.filter((tag) => {
    if (selectedKeys.value.has(tag.label.toLowerCase())) return false;
    if (!keyword) return true;
    return tag.label.toLowerCase().includes(keyword);
  });
});

const canCreateTag = computed(() => {
  const normalized = normalizeTagLabel(tagQuery.value);
  if (!normalized) return false;
  return !props.availableTags.some((tag) => tag.label.toLowerCase() === normalized.toLowerCase())
    && !selectedKeys.value.has(normalized.toLowerCase());
});

const canSave = computed(() => noteText.value.trim().length > 0 || tags.value.length > 0);

const editorTitle = computed(() => (props.annotation ? '编辑标注' : '添加标注'));

watch(
  () => props.visible,
  (visible) => {
    if (!visible) {
      noteText.value = '';
      tags.value = [];
      tagQuery.value = '';
      return;
    }
    noteText.value = props.annotation?.note ?? '';
    tags.value = [...props.selectedTags];
    void nextTick(() => {
      textareaRef.value?.focus();
    });
  },
);

const addTag = (tag: BlockTag) => {
  if (selectedKeys.value.has(tag.label.toLowerCase())) return;
  tags.value = [...tags.value, tag];
  tagQuery.value = '';
  void nextTick(() => tagInputRef.value?.focus());
};

const removeTag = (tagId: string) => {
  tags.value = tags.value.filter((tag) => tag.id !== tagId);
};

const createTagFromQuery = (): BlockTag | null => {
  const normalized = normalizeBlockTag({
    label: tagQuery.value,
    color: createTagColor(tagQuery.value),
  });
  return normalized;
};

const createAndAddTag = () => {
  const newTag = createTagFromQuery();
  if (newTag) addTag(newTag);
};

const handleTagEnter = () => {
  switch (resolveTagEditorEnterAction(canCreateTag.value, filteredCandidates.value.length)) {
    case 'create':
      createAndAddTag();
      break;
    case 'pick-first':
      addTag(filteredCandidates.value[0]);
      break;
    default:
      break;
  }
};

const handleTagKeydown = (event: KeyboardEvent) => {
  if (event.key === 'Enter') {
    event.preventDefault();
    handleTagEnter();
    return;
  }
  if (event.key === 'Backspace' && !tagQuery.value && tags.value.length > 0) {
    event.preventDefault();
    removeTag(tags.value[tags.value.length - 1].id);
    return;
  }
  if (event.key === 'Escape') {
    event.preventDefault();
    emit('cancel');
  }
};

const handleSave = () => {
  if (!canSave.value) return;
  emit('save', {
    note: noteText.value.trim(),
    tags: [...tags.value],
  });
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
          <span class="note-editor-title">{{ editorTitle }}</span>
          <button type="button" class="note-editor-close" @click="emit('cancel')">关闭</button>
        </div>

        <label class="note-editor-label">笔记（可选）</label>
        <textarea
          ref="textareaRef"
          v-model="noteText"
          class="note-editor-textarea"
          placeholder="输入笔记内容..."
          @keydown="handleKeydown"
        />

        <label class="note-editor-label">文字标签（可选）</label>
        <div v-if="tags.length > 0" class="note-editor-tags">
          <button
            v-for="tag in tags"
            :key="tag.id"
            type="button"
            class="tag-chip tag-chip--selected"
            :style="{ '--tag-chip-color': tag.color || '#1677ff' }"
            @click="removeTag(tag.id)"
          >
            <span>{{ tag.label }}</span>
            <span class="tag-chip-remove">×</span>
          </button>
        </div>

        <input
          ref="tagInputRef"
          v-model="tagQuery"
          class="note-editor-tag-input"
          type="text"
          placeholder="搜索或新建标签"
          @keydown="handleTagKeydown"
        />

        <div class="note-editor-tag-section">
          <button
            v-if="canCreateTag"
            type="button"
            class="note-editor-tag-option note-editor-tag-option--create"
            @click="createAndAddTag"
          >
            新建标签 “{{ normalizeTagLabel(tagQuery) }}”
          </button>
          <button
            v-for="tag in filteredCandidates"
            :key="tag.id"
            type="button"
            class="note-editor-tag-option"
            @click="addTag(tag)"
          >
            <span class="tag-chip tag-chip--preview" :style="{ '--tag-chip-color': tag.color || '#1677ff' }">
              {{ tag.label }}
            </span>
          </button>
        </div>

        <div class="note-editor-footer">
          <button type="button" class="note-editor-cancel-btn" @click="emit('cancel')">取消</button>
          <button
            type="button"
            class="note-editor-save-btn"
            :disabled="!canSave"
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
  width: min(420px, calc(100vw - 48px));
  max-height: min(560px, calc(100vh - 48px));
  overflow: auto;
  background: #fff;
  border: 1px solid #e8e8e8;
  border-radius: 12px;
  box-shadow: 0 16px 48px rgba(0, 0, 0, 0.18);
  padding: 16px;
  box-sizing: border-box;
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

.note-editor-label {
  display: block;
  margin-bottom: 6px;
  font-size: 13px;
  font-weight: 500;
  color: #595959;
}

.note-editor-textarea {
  width: 100%;
  box-sizing: border-box;
  min-height: 100px;
  padding: 10px 12px;
  border: 1px solid #d9d9d9;
  border-radius: 8px;
  font-size: 14px;
  font-family: inherit;
  line-height: 1.6;
  resize: vertical;
  outline: none;
  margin-bottom: 14px;
}

.note-editor-textarea:focus {
  border-color: #1677ff;
  box-shadow: 0 0 0 2px rgba(22, 119, 255, 0.12);
}

.note-editor-tags {
  display: flex;
  flex-wrap: wrap;
  gap: 8px;
  margin-bottom: 8px;
}

.note-editor-tag-input {
  width: 100%;
  box-sizing: border-box;
  border: 1px solid #d9d9d9;
  border-radius: 8px;
  padding: 9px 12px;
  font-size: 14px;
  outline: none;
}

.note-editor-tag-input:focus {
  border-color: #1677ff;
  box-shadow: 0 0 0 2px rgba(22, 119, 255, 0.12);
}

.note-editor-tag-section {
  display: flex;
  flex-direction: column;
  gap: 6px;
  margin-top: 10px;
  margin-bottom: 4px;
}

.note-editor-tag-option {
  display: flex;
  align-items: center;
  width: 100%;
  border: none;
  border-radius: 8px;
  background: #fff;
  padding: 8px;
  cursor: pointer;
  text-align: left;
}

.note-editor-tag-option:hover {
  background: #f5f7fa;
}

.note-editor-tag-option--create {
  color: #1677ff;
  font-weight: 500;
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

.tag-chip {
  --tag-chip-color: #1677ff;
  display: inline-flex;
  align-items: center;
  gap: 6px;
  border-radius: 999px;
  border: 1px solid color-mix(in srgb, var(--tag-chip-color) 30%, white);
  background: color-mix(in srgb, var(--tag-chip-color) 12%, white);
  color: color-mix(in srgb, var(--tag-chip-color) 85%, black);
  padding: 4px 10px;
  font-size: 12px;
  line-height: 1.4;
}

.tag-chip--selected {
  cursor: pointer;
  background: color-mix(in srgb, var(--tag-chip-color) 16%, white);
}

.tag-chip--preview {
  pointer-events: none;
}

.tag-chip-remove {
  font-size: 13px;
}
</style>
