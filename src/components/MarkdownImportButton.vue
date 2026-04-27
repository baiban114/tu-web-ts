<script setup lang="ts">
import { ref } from 'vue';
import { ElButton, ElMessage } from 'element-plus';
import { useWorkspaceStore } from '@/stores/workspace';

const store = useWorkspaceStore();
const inputRef = ref<HTMLInputElement | null>(null);
const importing = ref(false);

function openPicker() {
  inputRef.value?.click();
}

async function onFileChange(event: Event) {
  const target = event.target as HTMLInputElement | null;
  const file = target?.files?.[0];
  if (!file) return;

  importing.value = true;
  try {
    await store.importMarkdownFile(file);
    ElMessage.success(`已导入 ${file.name}`);
  } catch (error) {
    const message = error instanceof Error ? error.message : '导入 Markdown 失败';
    ElMessage.error(message);
  } finally {
    importing.value = false;
    if (target) {
      target.value = '';
    }
  }
}
</script>

<template>
  <div class="markdown-import">
    <input
      ref="inputRef"
      class="markdown-import__input"
      type="file"
      accept=".md,.markdown,text/markdown"
      @change="onFileChange"
    >
    <el-button
      link
      size="small"
      title="导入 Markdown"
      :disabled="!store.currentKbId || importing"
      @click.stop="openPicker"
    >
      导
    </el-button>
  </div>
</template>

<style scoped>
.markdown-import {
  display: inline-flex;
}

.markdown-import__input {
  display: none;
}
</style>

