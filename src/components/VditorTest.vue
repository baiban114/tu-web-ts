<script setup lang="ts">
import Vditor from 'vditor';
import 'vditor/dist/index.css';
import { onBeforeUnmount, onMounted, ref } from 'vue';

const VDITOR_CDN = '/vditor';
const vditorRef = ref<HTMLDivElement | null>(null);
const vditorInstance = ref<Vditor | null>(null);

onMounted(() => {
  if (!vditorRef.value) return;

  vditorInstance.value = new Vditor(vditorRef.value, {
    cdn: VDITOR_CDN,
    height: 300,
    width: '100%',
    value: '# 测试 Vditor\n\n这是一个用于验证本地资源加载的测试页。',
    mode: 'wysiwyg',
    cache: { enable: false },
    toolbarConfig: {
      hide: true,
    },
    toolbar: [
      'bold', 'italic', 'strike', '|',
      'headings', '|',
      'list', 'ordered-list', 'check', '|',
      'link', 'image',
    ],
  });
});

onBeforeUnmount(() => {
  vditorInstance.value?.destroy();
});
</script>

<template>
  <div class="vditor-test-container">
    <h2>Vditor 测试页</h2>
    <div ref="vditorRef" class="vditor-test-editor"></div>
  </div>
</template>

<style scoped>
.vditor-test-container {
  max-width: 800px;
  margin: 0 auto;
  padding: 20px;
}

.vditor-test-editor {
  border: 1px solid #d9d9d9;
  border-radius: 4px;
}
</style>
