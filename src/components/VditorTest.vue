<script setup lang="ts">
import Vditor from 'vditor';
import 'vditor/dist/index.css';
import { ref, onMounted, onBeforeUnmount } from 'vue';

const vditorRef = ref<HTMLDivElement | null>(null);
const vditorInstance = ref<Vditor | null>(null);

onMounted(() => {
  if (vditorRef.value) {
    // 初始化Vditor，测试toolbarConfig参数
    vditorInstance.value = new Vditor(vditorRef.value, {
      height: 300,
      width: '100%',
      value: '# 测试Vditor工具栏隐藏功能\n\n这是一个测试页面，用于验证toolbarConfig.hide参数是否正常工作。',
      mode: 'wysiwyg',
      cache: { enable: false },
      // 测试工具栏隐藏功能
      toolbarConfig: {
        hide: true, // 设置为true隐藏工具栏
      },
      toolbar: [
        'bold', 'italic', 'strike', '|',
        'h1', 'h2', 'h3', '|',
        'list', 'ordered-list', 'check', '|',
        'link', 'image',
      ],
    });
  }
});

onBeforeUnmount(() => {
  if (vditorInstance.value) {
    vditorInstance.value.destroy();
  }
});
</script>

<template>
  <div class="vditor-test-container">
    <h2>Vditor工具栏隐藏测试</h2>
    <div ref="vditorRef" class="vditor-test-editor"></div>
    <div class="test-info">
      <p>当前配置：toolbarConfig.hide = true</p>
      <p>预期结果：工具栏应该被隐藏</p>
    </div>
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
  margin-bottom: 20px;
}

.test-info {
  background-color: #f5f5f5;
  padding: 15px;
  border-radius: 4px;
  font-size: 14px;
  color: #555;
}
</style>