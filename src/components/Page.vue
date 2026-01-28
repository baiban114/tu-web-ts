<script setup lang="ts">
import { ref, onMounted, onBeforeUnmount, watch } from 'vue';
import RichTextEditor from './RichTextEditor.vue';
import BlockInsert from './BlockInsert.vue';
import DrawingBoard from './DrawingBoard.vue';
import Line from './line.vue';
import X6Component from './X6Component.vue';

interface GraphData {
  nodes: Array<{
    id: string;
    style?: {
      x?: number;
      y?: number;
      [key: string]: any;
    };
    data?: {
      label?: string;
      time?: string;
      done?: boolean;
      [key: string]: any;
    };
    [key: string]: any;
  }>;
  edges: Array<{
    id?: string;
    source: string;
    target: string;
    data?: {
      done?: boolean;
      [key: string]: any;
    };
    [key: string]: any;
  }>;
}

export interface Block {
  id: string;
  type: 'richtext' | 'graph' | 'line' | 'x6' | string;
  title?: string;
  content?: string;
  graphData?: GraphData;
  timelineData?: Array<{
    id: string;
    title: string;
    content: string;
    date: string;
    color: string;
    lightColor: string;
    type: 'normal' | 'milestone';
  }>;
  blockHeight?: number;
  [key: string]: any;
}

interface Props {
  contentList: Block[];
  editable?: boolean;
}

const props = withDefaults(defineProps<Props>(), {
  editable: true
});

const emit = defineEmits<{
  (e: 'content-change', contentList: Block[]): void;
}>();

const blockRefs = ref<HTMLElement[]>([]);
const hasSelection = ref(false);
const selectedText = ref('');
const selectedBlockIndex = ref(-1);

// 光标位置相关状态
const cursorBlockIndex = ref(-1);
const showBlockInsert = ref(false);
const blockInsertPosition = ref({ x: 0, y: 0 });
const cursorLineIndex = ref(-1);

// 生成唯一ID
const generateId = (): string => {
  return `block-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;
};

// 创建新的富文本块
const createNewRichTextBlock = (position: number): Block => {
  return {
    id: generateId(),
    type: 'richtext',
    title: '新的富文本编辑器',
    content: '# 新内容\n\n在这里输入你的内容...'
  };
};

// 创建新的画板块
const createNewDrawingBlock = (position: number): Block => {
  return {
    id: generateId(),
    type: 'graph',
    title: '新的画板',
    graphData: {
      nodes: [
        { id: `node-${Date.now()}-1`, style: { x: 100, y: 100 }, label: '节点 1' },
        { id: `node-${Date.now()}-2`, style: { x: 300, y: 100 }, label: '节点 2' },
      ],
      edges: []
    }
  };
};

// 创建新的时间轴块
const createNewLineBlock = (position: number): Block => {
  return {
    id: generateId(),
    type: 'line',
    title: '新的时间轴',
    timelineData: []
  };
};

// 创建新的X6图块
const createNewX6Block = (position: number): Block => {
  return {
    id: generateId(),
    type: 'x6',
    title: '新的X6图',
    graphData: {
      nodes: [
        { id: `x6-node-${Date.now()}-1`, x: 100, y: 100, width: 80, height: 40, label: '节点 1' },
        { id: `x6-node-${Date.now()}-2`, x: 300, y: 100, width: 80, height: 40, label: '节点 2' },
      ],
      edges: [
        { id: `x6-edge-${Date.now()}-1`, source: `x6-node-${Date.now()}-1`, target: `x6-node-${Date.now()}-2` },
      ],
    }
  };
};

// 在指定位置插入新block
const insertBlock = (position: number, block: Block) => {
  props.contentList.splice(position, 0, block);
  emit('content-change', props.contentList);
};

// 删除指定位置的block
const removeBlock = (position: number) => {
  if (props.contentList.length > 0) {
    props.contentList.splice(position, 1);
    emit('content-change', props.contentList);
  }
};

// 处理回车键创建新block
const handleKeyDown = (event: KeyboardEvent, blockIndex: number) => {
  if (!props.editable) return;
  
  // 检查事件目标是否在富文本编辑器内部
  const isRichTextEditor = (event.target as HTMLElement).closest('.rich-text-editor-container, .vditor-container, .vditor-wysiwyg, .vditor-editor');
  
  // 检查是否是提取选中文本的快捷键 (Ctrl+Shift+E 或 Cmd+Shift+E)
  if ((event.ctrlKey || event.metaKey) && event.shiftKey && event.key === 'E') {
    if (isRichTextEditor) {
      event.preventDefault();
      
      // 获取选中文本
      const selectedText = window.getSelection()?.toString() || '';
      if (selectedText) {
        handleExtractSelection(selectedText, blockIndex);
      }
    }
    return;
  }
  
  // 检查是否是普通Enter键（不是Shift+Enter等组合键）
  if (event.key === 'Enter' && !event.ctrlKey && !event.metaKey && !event.shiftKey) {
    if (!isRichTextEditor) {
      event.preventDefault();
      
      // 计算插入位置
      const insertPosition = blockIndex + 1;
      const newBlock = createNewRichTextBlock(insertPosition);
      insertBlock(insertPosition, newBlock);
    }
  }
  // 检查是否是Delete或Backspace键
  else if ((event.key === 'Delete' || event.key === 'Backspace') && !isRichTextEditor) {
    event.preventDefault();
    removeBlock(blockIndex);
  }
};

// 为每个块添加点击事件，使其获得焦点
const handleBlockClick = (event: MouseEvent, blockIndex: number) => {
  if (!props.editable) return;
  
  const blockElement = blockRefs.value[blockIndex];
  const target = event.target as HTMLElement | null;
  if (blockElement && target) {
    // 如果点击的是富文本编辑器内部，不获取焦点
    const isRichTextEditor = target.closest('.rich-text-editor-container, .vditor-container, .vditor-wysiwyg, .vditor-editor');
    if (!isRichTextEditor) {
      blockElement.focus();
    }
  }
};

// 监听contentList变化，更新refs
watch(
  () => props.contentList.length,
  () => {
    // 重置refs数组
    blockRefs.value = [];
  }
);

// 生命周期钩子
onMounted(() => {
  // 添加选择事件监听器
  document.addEventListener('selectionchange', checkSelection);
  // 添加光标位置监听器
  document.addEventListener('selectionchange', handleCursorPosition);
});

onBeforeUnmount(() => {
  // 移除选择事件监听器
  document.removeEventListener('selectionchange', checkSelection);
  // 移除光标位置监听器
  document.removeEventListener('selectionchange', handleCursorPosition);
});

// 检查是否有选中文本
const checkSelection = () => {
  try {
    const selection = window.getSelection();
    if (selection && selection.toString().trim()) {
      selectedText.value = selection.toString().trim();
      hasSelection.value = true;
      
      // 找出当前选中的块索引
      for (let i = 0; i < props.contentList.length; i++) {
        const blockElement = blockRefs.value[i];
        if (blockElement && blockElement.contains(selection.anchorNode)) {
          selectedBlockIndex.value = i;
          break;
        }
      }
    } else {
      hasSelection.value = false;
      selectedText.value = '';
      selectedBlockIndex.value = -1;
    }
  } catch (error) {
    console.error('检查选中文本失败:', error);
    hasSelection.value = false;
  }
};

// 处理提取选中文本为新块
const handleExtractSelection = (text: string, blockIndex: number) => {
  if (!text || !props.editable) return;
  
  // 创建新的富文本块
  const newBlock: Block = {
    id: generateId(),
    type: 'vditor',
    content: text
  };
  
  // 在当前块之后插入新块
  const insertPosition = blockIndex + 1;
  insertBlock(insertPosition, newBlock);
  
  // TODO: 从原块中移除选中的文本
  // 注意：这需要更复杂的DOM操作，因为我们需要知道选中的具体位置
};

// 处理工具栏提取成块按钮点击
const handleExtractSelectionButtonClick = () => {
  if (hasSelection.value && selectedText.value && selectedBlockIndex.value >= 0) {
    handleExtractSelection(selectedText.value, selectedBlockIndex.value);
  }
};

// 监听光标位置，在富文本编辑器中显示BlockInsert组件
const handleCursorPosition = () => {
  if (!props.editable) return;
  
  try {
    const selection = window.getSelection();
    if (selection && selection.rangeCount > 0) {
      const range = selection.getRangeAt(0);
      
      // 检查选区是否在某个富文本编辑器内部
      let foundBlockIndex = -1;
      for (let i = 0; i < props.contentList.length; i++) {
        const blockElement = blockRefs.value[i];
        if (blockElement && blockElement.contains(range.commonAncestorContainer as Node)) {
          // 确保是富文本类型的块
          if (props.contentList[i].type === 'richtext') {
            foundBlockIndex = i;
            break;
          }
        }
      }
      
      if (foundBlockIndex >= 0) {
        const blockElement = blockRefs.value[foundBlockIndex];
        if (blockElement) {
          const rect = range.getBoundingClientRect();
          const blockRect = blockElement.getBoundingClientRect();
          
          // 计算相对位置
          const relativeTop = rect.top - blockRect.top;
          
          cursorBlockIndex.value = foundBlockIndex;
          showBlockInsert.value = true;
          blockInsertPosition.value = {
            x: -45, // 紧贴左边框外侧
            y: relativeTop - 12 // 向上偏移12px，使按钮垂直居中
          };
        }
      } else {
        showBlockInsert.value = false;
        cursorBlockIndex.value = -1;
      }
    } else {
      showBlockInsert.value = false;
      cursorBlockIndex.value = -1;
    }
  } catch (error) {
    console.error('获取光标位置失败:', error);
    showBlockInsert.value = false;
  }
};

// 处理在光标位置插入新块
const handleInsertBlockAtCursor = () => {
  if (cursorBlockIndex.value >= 0) {
    const insertPosition = cursorBlockIndex.value + 1;
    const newBlock = createNewRichTextBlock(insertPosition);
    insertBlock(insertPosition, newBlock);
    showBlockInsert.value = false;
  }
};

// 获取block的属性，排除id和type
const getBlockProperties = (block: Block) => {
  const properties: Record<string, any> = {};
  for (const [key, value] of Object.entries(block)) {
    if (key !== 'id' && key !== 'type') {
      properties[key] = typeof value === 'object' ? JSON.stringify(value) : value;
    }
  }
  return properties;
};
</script>

<template>
  <div class="page-container">
    <!-- 工具栏 -->
    <div class="page-toolbar" v-if="editable">
      <button 
        class="toolbar-button" 
        @click="handleExtractSelectionButtonClick"
        :disabled="!hasSelection"
        title="提取选中文本为新块"
      >
        提取成块
      </button>
    </div>
    
    <div class="content-container">
      <!-- 在第一个块之前添加可点击的插入区域 -->
      <BlockInsert 
        v-if="editable" 
        @click="insertBlock(0, createNewRichTextBlock(0))" 
      />
    
    <template v-for="(block, index) in contentList" :key="block.id">
      <div 
        class="content-wrapper"
        :ref="(el) => { if(el) blockRefs[index] = el as HTMLElement }"
        @keydown="handleKeyDown($event, index)"
        @click="handleBlockClick($event, index)"
        :tabindex="editable ? 0 : -1"
      >
        <!-- 只对非富文本块显示标题 -->
        <div class="block-header" v-if="block.type !== 'richtext'">
          <h3>{{ block.title || `${block.type === 'graph' ? '图表' : block.type} ${index + 1}` }}</h3>
          <div class="block-type-badge">{{ block.type }}</div>
        </div>
        
        <!-- 根据block类型动态渲染不同组件 -->
        <component 
          :is="block.type === 'richtext' ? RichTextEditor : 'div'"
          v-else-if="block.type === 'richtext'"
          :content="block.content || ''"
          :editable="editable"
          @content-change="(content: string) => block.content = content"
          @height-change="(height: number) => block.blockHeight = height"
          @extract-selection="(text: string) => handleExtractSelection(text, index)"
          @insert-block="() => insertBlock(index + 1, createNewRichTextBlock(index + 1))"
          class="block-content"
        />
        <!-- 在富文本编辑器中显示BlockInsert组件 -->
        <div 
          v-if="block.type === 'richtext' && showBlockInsert && cursorBlockIndex === index"
          class="block-insert-container"
          :style="{
            left: `${blockInsertPosition.x}px`,
            top: `${blockInsertPosition.y}px`
          }"
        >
          <BlockInsert @click="handleInsertBlockAtCursor" />
        </div>
        <DrawingBoard 
          v-else-if="block.type === 'graph' && block.graphData"
          v-model:graphData="block.graphData"
          class="block-content graph-content"
        />
        <Line 
          v-else-if="block.type === 'line'"
          :timelineData="block.timelineData"
          class="block-content graph-content"
        />
        <X6Component 
          v-else-if="block.type === 'x6'"
          class="block-content graph-content"
        />
        <div 
          v-else
          class="block-content unknown-block"
        >
          <h3>未知的 block 类型: {{ block.type }}</h3>
          <div class="block-info">
            <p><strong>ID:</strong> {{ block.id }}</p>
            <p><strong>Type:</strong> {{ block.type }}</p>
            <div class="block-properties">
              <p v-for="(value, key) in getBlockProperties(block)" :key="key">
                <strong>{{ key }}:</strong> {{ value }}
              </p>
            </div>
          </div>
        </div>
      </div>
      
      <!-- 在当前块之后添加可点击的插入区域 -->
      <BlockInsert 
        v-if="editable" 
        @click="insertBlock(index + 1, createNewRichTextBlock(index + 1))" 
      />
    </template>
    </div>
  </div>
</template>

<style scoped>
.page-container {
  position: relative;
}

.page-toolbar {
  display: flex;
  align-items: center;
  padding: 10px 20px;
  background-color: #f5f5f5;
  border-bottom: 1px solid #e0e0e0;
  margin-bottom: 20px;
  border-radius: 4px 4px 0 0;
}

.toolbar-button {
  padding: 6px 12px;
  background-color: #1890ff;
  color: white;
  border: none;
  border-radius: 4px;
  cursor: pointer;
  font-size: 14px;
  transition: background-color 0.3s;
}

.toolbar-button:hover:not(:disabled) {
  background-color: #40a9ff;
}

.toolbar-button:disabled {
  background-color: #d9d9d9;
  cursor: not-allowed;
  color: #999;
}

.content-container {
  position: relative;
}

.content-wrapper {
  margin-bottom: 0;
  padding: 20px;
  border: 1px solid #e0e0e0;
  border-radius: 8px;
  background: #fff;
  transition: all 0.2s ease;
  cursor: text;
  position: relative;
}

.content-wrapper:hover {
  border-color: #1890ff;
  box-shadow: 0 2px 8px rgba(24, 144, 255, 0.1);
}

.content-wrapper:focus {
  outline: 2px solid #1890ff;
  box-shadow: 0 0 0 2px rgba(24, 144, 255, 0.2);
  border-color: #1890ff;
}

.content-wrapper:focus::before {
  content: '按 Enter 键插入新块';
  position: absolute;
  top: -25px;
  left: 20px;
  padding: 3px 8px;
  background: #1890ff;
  color: white;
  font-size: 12px;
  border-radius: 4px;
  opacity: 0.8;
}

.block-header {
  display: flex;
  justify-content: space-between;
  align-items: center;
  margin-bottom: 15px;
}

.block-header h3 {
  margin: 0;
  color: #333;
  font-size: 16px;
}

.block-type-badge {
  padding: 2px 8px;
  font-size: 12px;
  background-color: #f0f0f0;
  color: #666;
  border-radius: 10px;
}

.block-content {
  border: none;
  border-radius: 0;
  overflow: hidden;
  width: 100%;
  height: auto;
  min-height: 100px;
  margin: 0;
  padding: 0;
}

/* 特殊处理富文本块，使其高度根据内容自动调整 */
.content-wrapper .block-content {
  height: auto !important;
  min-height: 100px;
}

/* 针对VDitor块的特殊处理 */
.content-wrapper .block-content :deep(.rich-text-editor-container) {
  height: auto !important;
  min-height: 100px;
  width: 100% !important;
  margin: 0;
  padding: 0;
}

.block-content.graph-content {
  min-height: 400px;
  background: #fafafa;
}

.unknown-block {
  min-height: 100px;
  display: flex;
  flex-direction: column;
  align-items: flex-start;
  padding: 15px;
  color: #666;
  background: #fff9f9; /* 浅红色背景表示未知类型 */
  border: 1px dashed #ffccc7;
}

.block-info {
  width: 100%;
  margin-top: 10px;
}

.block-info h3 {
  margin: 0 0 10px 0;
  color: #f5222d;
  font-size: 16px;
}

.block-info p {
  margin: 5px 0;
  font-family: monospace;
}

.block-properties {
  margin-top: 10px;
  padding: 10px;
  background-color: #f6f6f6;
  border-radius: 4px;
  max-height: 150px;
  overflow-y: auto;
}

.block-properties p {
  margin: 3px 0;
  padding: 2px 0;
  font-size: 12px;
  word-break: break-word;
}

/* BlockInsert组件的容器样式 */
.content-container :deep(.block-insert) {
  margin: 15px 0;
}

/* 第一个BlockInsert的特殊样式 */
.content-container > .block-insert:first-child {
  margin-bottom: 20px;
}

/* 最后一个BlockInsert的特殊样式 */
.content-container > .block-insert:last-child {
  margin-top: 20px;
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
