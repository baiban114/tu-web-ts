<script setup lang="ts">
import { computed, nextTick, ref, watch } from 'vue';
import VditorRichEditor from './VditorRichEditor.vue';

interface Props {
  nodeId: string;
  styleProps: Record<string, string>;
  textMode: 'plain' | 'rich';
  label: string;
  richContent: string;
  isEditing: boolean;
  isEditable: boolean;
}

const props = defineProps<Props>();

const emit = defineEmits<{
  (e: 'commit-plain', text: string): void;
  (e: 'cancel'): void;
  (e: 'rich-change', markdown: string): void;
}>();

const plainText = ref(props.label);
const textareaRef = ref<HTMLTextAreaElement | null>(null);

const richOverlayStyle = computed<Record<string, string>>(() => ({
  ...props.styleProps,
  zIndex: props.isEditing && props.textMode === 'rich'
    ? '1001'
    : (props.styleProps.zIndex ?? '1000'),
}));

watch(() => props.label, (value) => {
  plainText.value = value;
});

watch(
  () => props.isEditing,
  (editing) => {
    if (editing && props.textMode === 'plain') {
      plainText.value = props.label;
      nextTick(() => {
        textareaRef.value?.focus();
        textareaRef.value?.select();
      });
    }
  },
);

function handlePlainKeydown(event: KeyboardEvent) {
  event.stopPropagation();
  if (event.key === 'Escape') {
    event.preventDefault();
    emit('cancel');
  } else if (event.key === 'Enter' && !event.ctrlKey && !event.metaKey && !event.shiftKey) {
    event.preventDefault();
    emit('commit-plain', plainText.value);
  }
}

function handlePlainBlur() {
  if (props.isEditing && props.textMode === 'plain') {
    emit('commit-plain', plainText.value);
  }
}
</script>

<template>
  <div
    v-if="textMode === 'rich'"
    class="x6-node-overlay"
    :class="isEditing ? 'x6-node-overlay--rich-edit' : 'x6-node-overlay--rich-preview'"
    :style="richOverlayStyle"
  >
    <VditorRichEditor
      :model-value="richContent"
      :editing="isEditing"
      :editable="isEditable"
      preview-class="x6-node-rich-preview"
      editor-class="x6-node-rich-editor"
      @update:model-value="(value) => emit('rich-change', value)"
      @escape="emit('cancel')"
      @focusout-editor="emit('cancel')"
    />
  </div>

  <div
    v-else-if="isEditing && textMode === 'plain'"
    class="x6-node-overlay x6-node-overlay--plain-edit"
    :style="styleProps"
    @mousedown.stop
    @click.stop
    @dblclick.stop
    @keydown.stop
  >
    <textarea
      ref="textareaRef"
      v-model="plainText"
      class="x6-node-plain-input"
      @keydown="handlePlainKeydown"
      @blur="handlePlainBlur"
    />
  </div>
</template>

<style scoped>
.x6-node-overlay {
  pointer-events: none;
}

.x6-node-overlay--rich-preview {
  position: absolute;
  overflow: hidden;
  border-radius: 4px;
  pointer-events: none;
  z-index: 10;
}

.x6-node-overlay--rich-edit {
  position: absolute;
  pointer-events: auto;
  overflow: hidden;
  z-index: 1001;
}

.x6-node-rich-preview {
  overflow: hidden;
  padding: 8px 10px;
  font-size: 12px;
  box-sizing: border-box;
  line-height: 1.3;
  word-break: break-word;
}

.x6-node-rich-preview :deep(p) { margin: 0; }
.x6-node-rich-preview :deep(h1),
.x6-node-rich-preview :deep(h2),
.x6-node-rich-preview :deep(h3) { margin: 0 0 2px; font-size: 14px; }
.x6-node-rich-preview :deep(ul),
.x6-node-rich-preview :deep(ol) { margin: 0; padding-left: 16px; }

.x6-node-rich-editor {
  width: 100%;
  height: 100%;
}

.x6-node-overlay--plain-edit {
  position: absolute;
  display: flex;
  align-items: center;
  justify-content: center;
  pointer-events: auto;
}

.x6-node-plain-input {
  width: 100%;
  height: 100%;
  border: 2px solid #1677ff;
  border-radius: 4px;
  background: rgba(255, 255, 255, 0.96);
  font-weight: 600;
  text-align: center;
  resize: none;
  outline: none;
  padding: 4px 8px;
  box-sizing: border-box;
  font-family: inherit;
  font-size: inherit;
  line-height: 1.4;
}
</style>
