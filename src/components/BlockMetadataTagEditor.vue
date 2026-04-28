<script setup lang="ts">
import { computed, nextTick, ref, watch } from 'vue';
import type { BlockTag } from '@/api/types';
import { createTagColor, normalizeBlockTag, normalizeTagLabel } from '@/utils/blockMetadata';

interface Props {
  visible: boolean;
  selectedTags: BlockTag[];
  availableTags: BlockTag[];
  top?: number;
  left?: number;
}

const props = withDefaults(defineProps<Props>(), {
  top: 0,
  left: 0,
});

const emit = defineEmits<{
  (e: 'close'): void;
  (e: 'update:selectedTags', tags: BlockTag[]): void;
}>();

const inputRef = ref<HTMLInputElement | null>(null);
const query = ref('');

const normalizedQuery = computed(() => normalizeTagLabel(query.value).toLowerCase());
const selectedKeys = computed(() => new Set(props.selectedTags.map((tag) => tag.label.toLowerCase())));

const filteredCandidates = computed(() => {
  const keyword = normalizedQuery.value;
  return props.availableTags.filter((tag) => {
    if (selectedKeys.value.has(tag.label.toLowerCase())) return false;
    if (!keyword) return true;
    return tag.label.toLowerCase().includes(keyword);
  });
});

const canCreateTag = computed(() => {
  const normalized = normalizeTagLabel(query.value);
  if (!normalized) return false;
  return !props.availableTags.some((tag) => tag.label.toLowerCase() === normalized.toLowerCase())
    && !selectedKeys.value.has(normalized.toLowerCase());
});

const createTagFromQuery = (): BlockTag | null => {
  const normalized = normalizeBlockTag({
    label: query.value,
    color: createTagColor(query.value),
  });
  if (!normalized) return null;
  return normalized;
};

const applyTags = (tags: BlockTag[]) => {
  emit('update:selectedTags', tags);
};

const addTag = (tag: BlockTag) => {
  if (selectedKeys.value.has(tag.label.toLowerCase())) return;
  applyTags([...props.selectedTags, tag]);
  query.value = '';
  void nextTick(() => inputRef.value?.focus());
};

const removeTag = (tagId: string) => {
  applyTags(props.selectedTags.filter((tag) => tag.id !== tagId));
};

const handleEnter = () => {
  if (filteredCandidates.value.length > 0 && normalizedQuery.value) {
    addTag(filteredCandidates.value[0]);
    return;
  }

  const newTag = createTagFromQuery();
  if (newTag) {
    addTag(newTag);
  }
};

const handleInputKeyDown = (event: KeyboardEvent) => {
  if (event.key === 'Enter') {
    event.preventDefault();
    handleEnter();
    return;
  }

  if (event.key === 'Backspace' && !query.value && props.selectedTags.length > 0) {
    event.preventDefault();
    removeTag(props.selectedTags[props.selectedTags.length - 1].id);
    return;
  }

  if (event.key === 'Escape') {
    event.preventDefault();
    emit('close');
  }
};

watch(
  () => props.visible,
  (visible) => {
    if (!visible) {
      query.value = '';
      return;
    }

    void nextTick(() => inputRef.value?.focus());
  },
);
</script>

<template>
  <Teleport to="body">
    <div v-if="visible" class="tag-editor-mask" @mousedown.self="emit('close')">
      <div
        class="tag-editor-popover"
        :style="{
          top: `${top}px`,
          left: `${left}px`,
        }"
        @mousedown.stop
      >
        <div class="tag-editor-header">
          <span class="tag-editor-title">编辑标签</span>
          <button class="tag-editor-close" type="button" @click="emit('close')">关闭</button>
        </div>

        <div class="tag-editor-selected" v-if="selectedTags.length > 0">
          <button
            v-for="tag in selectedTags"
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
          ref="inputRef"
          v-model="query"
          class="tag-editor-input"
          type="text"
          placeholder="搜索或新建标签"
          @keydown="handleInputKeyDown"
        />

        <div class="tag-editor-section">
          <button
            v-if="canCreateTag"
            type="button"
            class="tag-editor-option tag-editor-option--create"
            @click="handleEnter"
          >
            新建标签 “{{ normalizeTagLabel(query) }}”
          </button>

          <template v-if="filteredCandidates.length > 0">
            <button
              v-for="tag in filteredCandidates"
              :key="tag.id"
              type="button"
              class="tag-editor-option"
              @click="addTag(tag)"
            >
              <span class="tag-chip tag-chip--preview" :style="{ '--tag-chip-color': tag.color || '#1677ff' }">
                {{ tag.label }}
              </span>
            </button>
          </template>

          <div v-else-if="!canCreateTag" class="tag-editor-empty">
            没有更多可选标签
          </div>
        </div>
      </div>
    </div>
  </Teleport>
</template>

<style scoped>
.tag-editor-mask {
  position: fixed;
  inset: 0;
  z-index: 1400;
}

.tag-editor-popover {
  position: fixed;
  width: min(320px, calc(100vw - 24px));
  max-height: min(420px, calc(100vh - 24px));
  overflow: auto;
  background: #fff;
  border: 1px solid #e8e8e8;
  border-radius: 10px;
  box-shadow: 0 12px 32px rgba(0, 0, 0, 0.15);
  padding: 12px;
}

.tag-editor-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  margin-bottom: 10px;
}

.tag-editor-title {
  font-size: 14px;
  font-weight: 600;
  color: #1f1f1f;
}

.tag-editor-close {
  border: none;
  background: transparent;
  color: #8c8c8c;
  cursor: pointer;
  font-size: 12px;
}

.tag-editor-selected {
  display: flex;
  flex-wrap: wrap;
  gap: 8px;
  margin-bottom: 10px;
}

.tag-editor-input {
  width: 100%;
  box-sizing: border-box;
  border: 1px solid #d9d9d9;
  border-radius: 8px;
  padding: 9px 12px;
  font-size: 14px;
  outline: none;
}

.tag-editor-input:focus {
  border-color: #1677ff;
  box-shadow: 0 0 0 2px rgba(22, 119, 255, 0.12);
}

.tag-editor-section {
  display: flex;
  flex-direction: column;
  gap: 6px;
  margin-top: 10px;
}

.tag-editor-option {
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

.tag-editor-option:hover {
  background: #f5f7fa;
}

.tag-editor-option--create {
  color: #1677ff;
  font-weight: 500;
}

.tag-editor-empty {
  color: #8c8c8c;
  font-size: 13px;
  padding: 8px 4px;
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
