<script setup lang="ts">
import Vditor from 'vditor';
import 'vditor/dist/index.css';
import { ref, onMounted, watch, onBeforeUnmount } from 'vue';
import { Graph } from '@antv/g6';
import BlockInsert from './BlockInsert.vue';

interface Props {
  content: string;
  height?: number;
  width?: string;
  editable?: boolean;
}

const props = withDefaults(defineProps<Props>(), {
  height: undefined,
  width: '100%',
  editable: true,
});

const emit = defineEmits<{
  (e: 'content-change', content: string): void;
  (e: 'height-change', height: number): void;
  (e: 'extract-selection', text: string): void;
  (e: 'insert-block', position: number): void;
}>();

const editorRef = ref<HTMLDivElement | null>(null);
const editorInstance = ref<Vditor | null>(null);
const graphInstances = ref<Graph[]>([]);

// 光标位置相关状态
const showBlockInsert = ref(false);
const blockInsertPosition = ref({ x: 0, y: 0 });

// 初始化G6图表
const initGraphs = () => {
  // 清除现有的图表实例
  graphInstances.value.forEach(graph => graph.destroy());
  graphInstances.value = [];
  
  if (!editorRef.value) return;
  
  // 查找所有图表容器
  const graphContainers = editorRef.value.querySelectorAll('.g6-graph-container');
  graphContainers.forEach((container) => {
    const htmlContainer = container as HTMLElement;
    const graphDataStr = htmlContainer.getAttribute('data-graph-data');
    if (graphDataStr) {
      try {
        const graphData = JSON.parse(graphDataStr);
        const graph = new Graph({
          container: htmlContainer,
          width: htmlContainer.clientWidth,
          height: 400,
          data: graphData,
        });
        graph.render();
        graphInstances.value.push(graph);
      } catch (error) {
        console.error('解析图表数据失败:', error);
      }
    }
  });
};

// 计算并更新编辑器高度
const updateHeight = () => {
  if (!editorRef.value) return;
  
  // 获取编辑器实际高度
  const editorHeight = editorRef.value.scrollHeight;
  emit('height-change', editorHeight);
};

// 获取选中文本
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

// 提取选中文本为新块
const extractSelection = () => {
  const selectedText = getSelectedText();
  if (selectedText) {
    emit('extract-selection', selectedText);
  }
};

// 监听光标位置
const handleCursorPosition = () => {
  if (!editorInstance.value || !props.editable) return;
  
  try {
    const selection = window.getSelection();
    if (selection && selection.rangeCount > 0) {
      const range = selection.getRangeAt(0);
      
      // 检查选区是否在编辑器内部
      const editorElement = editorRef.value;
      if (!editorElement) return;
      
      const commonAncestor = range.commonAncestorContainer;
      const isInEditor = editorElement.contains(commonAncestor as Node);
      
      if (isInEditor) {
        // 显示BlockInsert组件的条件：
        // 1. 有选区（range.collapsed为false）
        // 2. 或者光标在编辑器的边界位置
        if (!range.collapsed) {
          const rect = range.getBoundingClientRect();
          const editorRect = editorElement.getBoundingClientRect();
          
          // 计算准确的位置
          const relativeTop = rect.top - editorRect.top;
          
          showBlockInsert.value = true;
          blockInsertPosition.value = {
            x: -45, // 紧贴左边框外侧，向左偏移45px以确保在边框外
            y: relativeTop - 12 // 向上偏移12px，使按钮垂直居中于选中行
          };
        } else {
          // 光标在编辑器边界位置时也显示BlockInsert组件
          // 检查光标是否在编辑器的第一行或最后一行
          const editorContent = editorElement.querySelector('.vditor-content');
          if (editorContent) {
            const isAtStart = range.startOffset === 0 && range.startContainer === editorContent.firstChild;
            const isAtEnd = range.endOffset === (range.endContainer.textContent?.length || 0) && range.endContainer === editorContent.lastChild;
            
            if (isAtStart || isAtEnd) {
              const rect = range.getBoundingClientRect();
              const editorRect = editorElement.getBoundingClientRect();
              
              // 计算准确的位置
              const relativeTop = rect.top - editorRect.top;
              
              showBlockInsert.value = true;
              blockInsertPosition.value = {
                x: -45, // 紧贴左边框外侧，向左偏移45px以确保在边框外
                y: relativeTop - 12 // 向上偏移12px，使按钮垂直居中于选中行
              };
            } else {
              showBlockInsert.value = false;
            }
          } else {
            showBlockInsert.value = false;
          }
        }
      } else {
        showBlockInsert.value = false;
      }
    } else {
      showBlockInsert.value = false;
    }
  } catch (error) {
    console.error('获取光标位置失败:', error);
    showBlockInsert.value = false;
  }
};

// 处理插入块事件
const handleInsertBlock = () => {
  emit('insert-block', 0);
  showBlockInsert.value = false;
};

onMounted(() => {
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
      input: (value: string) => {
        emit('content-change', value);
        // 内容变化时更新高度
        setTimeout(() => {
          updateHeight();
        }, 0);
      },
      // 使用after钩子在渲染完成后初始化图表
      after: () => {
        // 延迟一下，确保DOM已经渲染完成
        setTimeout(() => {
          initGraphs();
          // 初始化完成后更新高度
          updateHeight();
        }, 0);
      },
    });
    
    // 添加光标位置监听
    document.addEventListener('selectionchange', handleCursorPosition);
  }
});

onBeforeUnmount(() => {
  // 移除光标位置监听
  document.removeEventListener('selectionchange', handleCursorPosition);
  
  // 销毁所有图表实例
  graphInstances.value.forEach(graph => graph.destroy());
  // 销毁编辑器实例
  if (editorInstance.value) {
    editorInstance.value.destroy();
  }
});

watch(
  () => props.content,
  (newContent) => {
    if (editorInstance.value && newContent !== editorInstance.value.getValue()) {
      editorInstance.value.setValue(newContent);
      // 重新初始化图表
      setTimeout(() => {
        initGraphs();
      }, 0);
    }
  }
);
</script>

<template>
  <div ref="editorRef" class="rich-text-editor-container">
    <!-- 在光标位置显示BlockInsert组件 -->
    <div 
      v-if="showBlockInsert && editable" 
      class="block-insert-container"
      :style="{
        left: `${blockInsertPosition.x}px`,
        top: `${blockInsertPosition.y}px`
      }"
    >
      <BlockInsert @click="handleInsertBlock" />
    </div>
  </div>
</template>

<style scoped>
.rich-text-editor-container {
  border: none;
  border-radius: 0;
  overflow: visible;
  width: 100%;
  min-height: 100px;
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
  min-height: 60px;
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
  min-height: 20px;
}

/* 确保编辑器内容占满整个区域 */
.rich-text-editor-container :deep(.vditor-content) {
  height: auto !important;
  min-height: 20px;
  overflow-y: visible !important;
  margin: 0;
  padding: 0;
  width: 100% !important;
}

/* 确保编辑器的body元素占满高度 */
.rich-text-editor-container :deep(.vditor-wysiwyg .vditor-reset) {
  min-height: 20px;
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

/* BlockInsert容器样式 */
.block-insert-container {
  position: absolute;
  z-index: 1000;
  pointer-events: auto;
}

/* 调整BlockInsert组件的样式 */
.block-insert-container :deep(.block-insert) {
  margin: 0;
  height: 24px;
}

.block-insert-container :deep(.insert-button) {
  opacity: 1;
  pointer-events: auto;
}
</style>