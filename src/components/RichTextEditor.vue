<script setup lang="ts">
import Vditor from 'vditor';
import 'vditor/dist/index.css';
import { ref, onMounted, watch, onBeforeUnmount, nextTick, onUnmounted } from 'vue';

interface Props {
  content: string;
  height?: number;
  width?: string;
  editable?: boolean;
  autoFocus?: boolean;
}

const props = withDefaults(defineProps<Props>(), {
  height: undefined,
  width: '100%',
  editable: true,
  autoFocus: false,
});

const emit = defineEmits<{
  (e: 'content-change', content: string): void;
  (e: 'height-change', height: number): void;
  (e: 'extract-selection', text: string): void;
  (e: 'insert-block', position: number): void;
  (e: 'click', event: MouseEvent): void;
  (e: 'lifecycle', method: string): void;
  (e: 'blur', content: string): void;
  (e: 'focused'): void;
}>();

const editorRef = ref<HTMLDivElement | null>(null);
const editorInstance = ref<Vditor | null>(null);
const isUnmounted = ref(false);
const isReady = ref(false);

// 计算并更新编辑器高度
const updateHeight = () => {
  emit('lifecycle', 'updateHeight');
  
  if (!editorRef.value) return;
  
  // 获取编辑器实际高度
  const editorHeight = editorRef.value.scrollHeight;
  emit('height-change', editorHeight);
};

// 获取选中文本（纯文本）
const getSelectedText = (): string => {
  if (!editorInstance.value) return '';
  
  try {
    // 获取编辑器范围
    const range = window.getSelection()?.getRangeAt(0);
    if (range) {
      return range.toString();
    }
  } catch (error) {
    console.error('获取选中文本失败:', error);
  }
  
  return '';
};

// 获取选中的HTML内容（保留格式）
const getSelectedHtml = (): string => {
  if (!editorInstance.value) return '';
  
  try {
    const selection = window.getSelection();
    if (selection && selection.rangeCount > 0) {
      const range = selection.getRangeAt(0);
      // 创建一个临时容器来提取HTML
      const tempDiv = document.createElement('div');
      tempDiv.appendChild(range.cloneContents());
      return tempDiv.innerHTML;
    }
  } catch (error) {
    console.error('获取选中HTML失败:', error);
  }
  
  return '';
};

// 获取选中的Vditor DOM内容（wysiwyg模式下的HTML）
const getSelectedVditorDOM = (): string => {
  if (!editorInstance.value || !editorRef.value) return '';
  
  try {
    const selection = window.getSelection();
    if (selection && selection.rangeCount > 0) {
      const range = selection.getRangeAt(0);
      
      // 检查选区是否在编辑器内部
      const editorElement = editorRef.value.querySelector('.vditor-wysiwyg');
      if (!editorElement) return '';
      
      const commonAncestor = range.commonAncestorContainer;
      const isInEditor = editorElement.contains(commonAncestor as Node);
      
      if (!isInEditor) return '';
      
      // 获取选区的最外层块级元素
      let startElement: Element | null = null;
      if (range.startContainer.nodeType === Node.ELEMENT_NODE) {
        startElement = range.startContainer as Element;
      } else {
        startElement = (range.startContainer.parentElement as Element);
      }
      
      // 找到最近的块级元素
      const blockElement = startElement?.closest('[data-block="0"], p, h1, h2, h3, h4, h5, h6, li, blockquote, pre, table, div.vditor-reset > div');
      
      // 如果选中了整个块，返回整个块的HTML
      if (blockElement && range.toString().trim() === blockElement.textContent?.trim()) {
        return blockElement.outerHTML;
      }
      
      // 否则只返回选中的内容（保留内联格式）
      const tempDiv = document.createElement('div');
      tempDiv.appendChild(range.cloneContents());
      return tempDiv.innerHTML;
    }
  } catch (error) {
    console.error('获取选中Vditor DOM失败:', error);
  }
  
  return '';
};

// 将当前选区转为 Markdown（保留格式），供父组件或快捷键使用
const getSelectionAsMarkdown = (): string => {
  if (!editorInstance.value) return '';
  try {
    const vditorDOM = getSelectedVditorDOM();
    if (!vditorDOM || !editorInstance.value) return '';
    const vditor = (editorInstance.value as any).vditor;
    if (vditor && vditor.lute) {
      const markdown = vditor.lute.VditorDOM2Md(vditorDOM);
      if (markdown && markdown.trim()) return markdown;
    }
    const markdown = editorInstance.value.html2md(vditorDOM);
    if (markdown && markdown.trim()) return markdown;
  } catch (_) {
    // ignore
  }
  try {
    const selection = editorInstance.value.getSelection();
    if (selection && selection.trim()) return selection;
  } catch (_) {
    // ignore
  }
  return '';
};

// 提取选中文本为新块（内部触发时用，会 emit 带格式的 markdown）
const extractSelection = () => {
  const markdown = getSelectionAsMarkdown();
  if (markdown) emit('extract-selection', markdown);
};

defineExpose({
  getSelectionAsMarkdown
});

onMounted(() => {
  emit('lifecycle', 'onMounted');
  
  if (editorRef.value) {
    // 直接传递配置对象给Vditor构造函数
    editorInstance.value = new Vditor(editorRef.value, {
      width: props.width,
      value: props.content,
      mode: 'wysiwyg' as const,
      cache: { enable: false },
      // 设置toolbarConfig为正确的对象格式，hide为true表示隐藏工具栏
      toolbarConfig: {
        hide: true
      },
      // 确保不使用任何自定义工具栏
      toolbar: [],
      // 提供空的customWysiwygToolbar函数以避免Vditor内部错误
      customWysiwygToolbar: () => {},
      // 避免自定义工具栏函数问题
      after: () => {
        if (isUnmounted.value) return;
        isReady.value = true;
        updateHeight();
        if (props.autoFocus && editorInstance.value) {
          nextTick(() => {
            if (isUnmounted.value) return;
            editorInstance.value?.focus();
            emit('focused');
          });
        }
      },
      input: (value: string) => {
        emit('content-change', value);
        // 内容变化时更新高度
        setTimeout(() => {
          updateHeight();
        }, 0);
      },
    });
    
    // 添加点击事件监听
    editorRef.value.addEventListener('click', (event: MouseEvent) => {
      emit('click', event);
    });

    // 失焦时通知父组件（用于无内容时删除块）
    const handleFocusOut = () => {
      setTimeout(() => {
        if (!editorRef.value?.contains(document.activeElement)) {
          const value = (editorInstance.value as any)?.getValue?.() ?? '';
          emit('blur', value);
        }
      }, 0);
    };
    editorRef.value.addEventListener('focusout', handleFocusOut);
    (editorRef.value as any)._blurHandler = handleFocusOut;
  }
});

onBeforeUnmount(() => {
  isUnmounted.value = true;
  emit('lifecycle', 'onBeforeUnmount');
  if (editorRef.value && (editorRef.value as any)._blurHandler) {
    editorRef.value.removeEventListener('focusout', (editorRef.value as any)._blurHandler);
  }
  
  // 销毁编辑器实例
  if (editorInstance.value) {
    editorInstance.value.destroy();
  }
});

watch(
  () => props.content,
  (newContent) => {
    emit('lifecycle', 'watch:content');
    
    if (editorInstance.value && newContent !== editorInstance.value.getValue()) {
      editorInstance.value.setValue(newContent);
    }
  }
);
</script>

<template>
  <div class="rich-text-editor-wrapper">
    <!-- 编辑器正常渲染（Vditor 需要在正常布局流中初始化以获取正确尺寸） -->
    <div ref="editorRef" class="rich-text-editor-container">
    </div>

    <!-- 骨架屏覆盖层：绝对定位覆盖在编辑器上方，ready 后消失 -->
    <Transition name="skeleton-fade">
      <div v-if="!isReady" class="editor-skeleton">
        <div class="editor-skeleton__line" style="width: 60%" />
        <div class="editor-skeleton__line" style="width: 85%" />
        <div class="editor-skeleton__line" style="width: 40%" />
      </div>
    </Transition>
  </div>
</template>

<style scoped>
.rich-text-editor-wrapper {
  position: relative;
  width: 100%;
}

/* 骨架屏：绝对覆盖在编辑器上方，不影响 Vditor 尺寸计算 */
.editor-skeleton {
  position: absolute;
  inset: 0;
  background: #fff;
  z-index: 2;
  padding: 10px 15px;
  display: flex;
  flex-direction: column;
  gap: 10px;
  pointer-events: none;
}

.editor-skeleton__line {
  height: 14px;
  border-radius: 4px;
  background: linear-gradient(90deg, #f0f0f0 25%, #e0e0e0 50%, #f0f0f0 75%);
  background-size: 200% 100%;
  animation: skeleton-shimmer 1.2s infinite;
}

@keyframes skeleton-shimmer {
  0%   { background-position: 200% 0; }
  100% { background-position: -200% 0; }
}

.skeleton-fade-leave-active {
  transition: opacity 0.15s ease;
}
.skeleton-fade-leave-to {
  opacity: 0;
}

.rich-text-editor-container {
  border: none;
  border-radius: 0;
  overflow: visible;
  width: 100%;
  min-height: 44px;
  margin: 0;
  padding: 0;
  display: block;
  position: relative;
}

/* 穿透样式，去除vditor的多余边框和区域 */
.rich-text-editor-container :deep(.vditor) {
  border: none;
  border-radius: 0;
  height: auto !important;
  width: 100% !important;
  margin: 0;
  padding: 0;
  overflow: visible;
}

.rich-text-editor-container :deep(.vditor-wysiwyg) {
  border: none;
  padding: 0;
  margin: 0;
  min-height: 44px;
  height: auto !important;
  width: 100% !important;
}

.rich-text-editor-container :deep(.vditor-toolbar) {
  border: none;
  border-bottom: 1px solid #f0f0f0;
  margin: 0;
  padding: 0;
  width: 100% !important;
  min-height: 40px;
}

.rich-text-editor-container :deep(.vditor-wysiwyg__toolbar) {
  display: none;
}

.rich-text-editor-container :deep(.vditor-preview) {
  border: none;
  margin: 0;
  padding: 0;
  height: auto !important;
}

.rich-text-editor-container :deep(.vditor-reset) {
  padding: 10px 15px !important;
  margin: 0;
  height: auto !important;
  /* 最小高度 = 上边距(10) + 一行文字(~24px) + 下边距(10)，防止光标被裁剪 */
  min-height: 44px;
}

/* 确保编辑器内容占满整个区域 */
.rich-text-editor-container :deep(.vditor-content) {
  height: auto !important;
  min-height: 44px;
  overflow-y: visible !important;
  margin: 0;
  padding: 0;
  width: 100% !important;
}

/* 确保编辑器的body元素占满高度 */
.rich-text-editor-container :deep(.vditor-wysiwyg .vditor-reset) {
  min-height: 44px;
  height: auto;
}

/* 确保工具栏不占用额外空间 */
.rich-text-editor-container :deep(.vditor-toolbar__items) {
  margin: 0;
  padding: 8px 12px;
}

/* 彻底隐藏工具栏 */
.rich-text-editor-container :deep(.vditor-toolbar) {
  display: none !important;
  height: 0 !important;
  min-height: 0 !important;
  overflow: hidden !important;
}

/* 确保悬停时也不显示工具栏 */
.rich-text-editor-container :deep(.vditor-toolbar:hover) {
  display: none !important;
  height: 0 !important;
  min-height: 0 !important;
  overflow: hidden !important;
}

/* 确保工具栏的任何变体都被隐藏 */
.rich-text-editor-container :deep(.vditor-toolbar--hide) {
  display: none !important;
  height: 0 !important;
  min-height: 0 !important;
  overflow: hidden !important;
}

/* 隐藏 vditor-panel */
.rich-text-editor-container :deep(.vditor-panel) {
  display: none !important;
}


</style>