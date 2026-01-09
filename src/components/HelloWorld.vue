<script setup lang="ts">
import { ref, onMounted } from 'vue';
import { Graph } from '@antv/g6';
import VditorComponent from './VditorComponent.vue';

interface GraphData {
  nodes: Array<{
    id: string;
    style?: {
      x?: number;
      y?: number;
      [key: string]: any;
    };
    [key: string]: any;
  }>;
  edges: Array<{
    id: string;
    source: string;
    target: string;
    [key: string]: any;
  }>;
}

interface Block {
  id: string;
  type: 'vditor' | 'graph' | string;
  title?: string;
  content?: string;
  graphData?: GraphData;
  [key: string]: any;
}

const contentList = ref<Block[]>([]);
const containerRefs = ref<HTMLDivElement[]>([]);
const blockRefs = ref<HTMLElement[]>([]);

// 生成唯一ID
const generateId = (): string => {
  return `block-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;
};

// 创建新的Vditor block
const createNewVditorBlock = (position: number): Block => {
  return {
    id: generateId(),
    type: 'vditor',
    title: '新的Markdown编辑器',
    content: '# 新内容\n\n在这里输入你的内容...'
  };
};

// 在指定位置插入新block
const insertBlock = (position: number, block: Block) => {
  contentList.value.splice(position, 0, block);
  // 等待DOM更新后重新初始化组件
  setTimeout(() => {
    initComponents();
  }, 0);
};

// 处理回车键创建新block
const handleKeyDown = (event: KeyboardEvent, blockIndex: number) => {
  // 检查是否是普通Enter键（不是Shift+Enter等组合键）
  if (event.key === 'Enter' && !event.ctrlKey && !event.metaKey && !event.shiftKey) {
    // 检查事件目标是否在Vditor编辑器内部
    const isVditor = (event.target as HTMLElement).closest('.vditor-container');
    if (!isVditor) {
      event.preventDefault();
      
      // 计算插入位置
      const insertPosition = event.shiftKey ? blockIndex : blockIndex + 1;
      const newBlock = createNewVditorBlock(insertPosition);
      insertBlock(insertPosition, newBlock);
    }
  }
};

// 为每个块添加点击事件，使其获得焦点
const handleBlockClick = (event: MouseEvent, blockIndex: number) => {
  const blockElement = blockRefs.value[blockIndex];
  const target = event.target as HTMLElement | null;
  if (blockElement && target && !target.closest('.vditor-container') && !target.closest('.block-content')) {
    blockElement.focus();
  }
};

// 模拟接口请求
const fetchContentData = async (): Promise<Block[]> => {
  await new Promise(resolve => setTimeout(resolve, 500));
  
  return [
    {
      id: '1',
      type: 'vditor',
      title: 'Markdown 编辑器 1',
      content: `# 欢迎使用 Vditor\n\n这是第一个 Markdown 编辑器，支持实时预览和多种编辑模式。\n\n## 功能特点\n- 🚀 轻量级\n- 🎨 主题定制\n- 📝 所见即所得`
    },
    {
      id: '2',
      type: 'graph',
      title: '网络拓扑图',
      graphData: {
        nodes: [
          { id: 'node-1', style: { x: 100, y: 100 }, label: '服务器' },
          { id: 'node-2', style: { x: 300, y: 100 }, label: '客户端' },
          { id: 'node-3', style: { x: 200, y: 250 }, label: '数据库' },
        ],
        edges: [
          { id: 'edge-1', source: 'node-1', target: 'node-2' },
          { id: 'edge-2', source: 'node-1', target: 'node-3' },
          { id: 'edge-3', source: 'node-2', target: 'node-3' },
        ],
      },
    },
    {
      id: '3',
      type: 'vditor',
      title: 'Markdown 编辑器 2',
      content: `# 代码示例\n\n下面是一个 JavaScript 代码示例：\n\n\`\`\`javascript\nfunction greet(name) {\n  return \`Hello, \${name}!\`;\n}\n\nconsole.log(greet('World'));\n\`\`\``
    },
    {
      id: '4',
      type: 'graph',
      title: '流程图',
      graphData: {
        nodes: [
          { id: 'start', style: { x: 200, y: 50 }, label: '开始' },
          { id: 'process', style: { x: 200, y: 150 }, label: '处理数据' },
          { id: 'decision', style: { x: 200, y: 250 }, label: '判断' },
          { id: 'end', style: { x: 200, y: 350 }, label: '结束' },
        ],
        edges: [
          { id: 'e1', source: 'start', target: 'process' },
          { id: 'e2', source: 'process', target: 'decision' },
          { id: 'e3', source: 'decision', target: 'end', label: '是' },
        ],
      },
    },
    {
      id: '5',
      type: 'vditor',
      title: 'Markdown 编辑器 3',
      content: `# 表格示例\n\n| 功能 | 状态 | 优先级 |\n|------|------|--------|\n| 编辑器 | ✅ 完成 | 高 |\n| 图表 | ✅ 完成 | 高 |\n| 导出 | 🔄 进行中 | 中 |\n| 导入 | 📅 计划中 | 低 |`
    },
  ];
};



const createGraph = (container: HTMLElement, graphData: GraphData): Graph => {
  return new Graph({
    container,
    width: 500,
    height: 500,
    data: graphData,
  });
};

const initComponents = async () => {
  try {
    // 如果contentList为空，则从接口获取数据
    if (contentList.value.length === 0) {
      const data = await fetchContentData();
      contentList.value = data;
    }
    
    await new Promise(resolve => setTimeout(resolve, 0));
    
    // 重新初始化所有graph组件
    containerRefs.value.forEach((container, index) => {
      if (container && contentList.value[index]) {
        const block = contentList.value[index];
        
        if (block.type === 'graph' && block.graphData) {
          createGraph(container, block.graphData);
        }
      }
    });
    
  } catch (error) {
    console.error('获取数据失败:', error);
  }
};

onMounted(() => {
  initComponents();
});

defineProps<{
  msg: string
}>()
</script>

<template>
  <div>
    <h1>{{ msg }}</h1>
    <div class="content-container">
      <!-- 在第一个块之前添加可点击的插入区域 -->
      <div 
        class="block-insert-area before-first"
        @click="insertBlock(0, createNewVditorBlock(0))"
      >
        <span>+ 在此处插入新块</span>
      </div>
      
      <div 
        v-for="(block, index) in contentList" 
        :key="block.id" 
        class="content-wrapper"
        :ref="(el) => { if(el) blockRefs[index] = el as HTMLElement }"
        @keydown="handleKeyDown($event, index)"
        @click="handleBlockClick($event, index)"
        tabindex="0"
      >
        <div class="block-header">
          <h3>{{ block.title || `${block.type === 'vditor' ? 'Markdown 编辑器' : block.type === 'graph' ? '图表' : block.type} ${index + 1}` }}</h3>
          <div class="block-type-badge">{{ block.type }}</div>
        </div>
        
        <!-- 根据block类型动态渲染不同组件 -->
        <component 
          :is="block.type === 'vditor' ? VditorComponent : 'div'"
          v-if="block.type === 'vditor' && block.content"
          :content="block.content"
          @content-change="(content: string) => block.content = content"
          class="block-content"
        />
        <div 
          v-else-if="block.type === 'graph'"
          :ref="(el) => { if(el) containerRefs[index] = el as HTMLDivElement }"
          class="block-content graph-content"
        ></div>
        <div 
          v-else
          class="block-content unknown-block"
        >
          <p>未知的 block 类型: {{ block.type }}</p>
        </div>
        
        <!-- 在当前块之后添加可点击的插入区域 -->
        <div 
          class="block-insert-area after-block"
          @click="insertBlock(index + 1, createNewVditorBlock(index + 1))"
        >
          <span>+ 在此处插入新块</span>
        </div>
      </div>
      
      <!-- 在最后一个块之后添加可点击的插入区域 -->
      <div 
        class="block-insert-area after-last"
        @click="insertBlock(contentList.length, createNewVditorBlock(contentList.length))"
      >
        <span>+ 在此处插入新块</span>
      </div>
    </div>
  </div>
</template>

<style scoped>
.content-container {
  margin-top: 20px;
  position: relative;
}

.content-wrapper {
  margin-bottom: 10px;
  padding: 20px;
  border: 1px solid #e0e0e0;
  border-radius: 8px;
  background: #fff;
  transition: all 0.2s ease;
  cursor: text;
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
  border: 1px solid #d9d9d9;
  border-radius: 4px;
  overflow: hidden;
}

.block-content.graph-content {
  min-height: 400px;
  background: #fafafa;
}

.unknown-block {
  min-height: 100px;
  display: flex;
  align-items: center;
  justify-content: center;
  color: #999;
  background: #fafafa;
}

/* 块插入区域样式 */
.block-insert-area {
  display: flex;
  align-items: center;
  justify-content: center;
  height: 30px;
  margin: 5px 0;
  border: 2px dashed #d9d9d9;
  border-radius: 8px;
  background-color: #fafafa;
  color: #999;
  font-size: 14px;
  cursor: pointer;
  transition: all 0.2s ease;
  opacity: 0.7;
}

.block-insert-area:hover {
  opacity: 1;
  border-color: #1890ff;
  color: #1890ff;
  background-color: #e6f7ff;
  transform: translateY(-1px);
  box-shadow: 0 2px 8px rgba(24, 144, 255, 0.15);
}

.block-insert-area span {
  padding: 5px 15px;
  border-radius: 15px;
  transition: all 0.2s ease;
}

.block-insert-area:hover span {
  background-color: rgba(24, 144, 255, 0.1);
}

/* 特殊位置的插入区域 */
.block-insert-area.before-first {
  margin-bottom: 15px;
}

.block-insert-area.after-last {
  margin-top: 15px;
}

.block-insert-area.after-block {
  margin-top: 10px;
  margin-bottom: 10px;
  opacity: 0.6;
}

.content-wrapper:hover .block-insert-area.after-block {
  opacity: 1;
}
</style>
