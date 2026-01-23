<script setup lang="ts">
import { ref, onMounted, watch, onUnmounted, nextTick } from 'vue';
import { Graph } from '@antv/g6';

// 定义组件属性
const props = defineProps<{
  graphData: {
    nodes: Array<{
      id: string;
      style?: {
        x?: number;
        y?: number;
        [key: string]: any;
      };
      label?: string;
      [key: string]: any;
    }>;
    edges: Array<{
      id?: string;
      source: string;
      target: string;
      label?: string;
      [key: string]: any;
    }>;
  };
}>();

// 定义组件事件
const emit = defineEmits<{
  'update:graphData': [data: typeof props.graphData];
}>();

// 引用容器元素
const containerRef = ref<HTMLElement | null>(null);

// 图实例
let graph: Graph | null = null;

// 初始化图形 - 简化版本，只负责渲染
const initGraph = () => {
  if (!containerRef.value) return;

  try {
    // 创建G6实例
    graph = new Graph({
      container: containerRef.value,
      width: containerRef.value.offsetWidth || 800,
      height: containerRef.value.offsetHeight || 600,
      data: props.graphData,
    });

    // 渲染图形
    graph.render();
  } catch (error) {
    console.error('初始化图形失败:', error);
    if (graph) {
      graph.destroy();
      graph = null;
    }
  }
};

// 监听图形数据变化
watch(
  () => props.graphData,
  (newData) => {
    if (graph && containerRef.value) {
      // 重新创建图形实例
      graph.destroy();
      graph = null;
      
      try {
        graph = new Graph({
          container: containerRef.value,
          width: containerRef.value.offsetWidth || 800,
          height: containerRef.value.offsetHeight || 600,
          data: newData,
        });
        graph.render();
      } catch (error) {
        console.error('更新图形失败:', error);
        if (graph) {
          graph.destroy();
          graph = null;
        }
      }
    }
  },
  { deep: true }
);

// 组件挂载时初始化
onMounted(() => {
  // 使用nextTick确保DOM已完全渲染
  nextTick(() => {
    initGraph();
  });

  // 监听窗口大小变化
  window.addEventListener('resize', handleResize);
});

// 处理窗口大小变化
const handleResize = () => {
  if (graph && containerRef.value) {
    // 重新创建图形实例以调整大小
    graph.destroy();
    graph = null;
    
    try {
      graph = new Graph({
        container: containerRef.value,
        width: containerRef.value.offsetWidth || 800,
        height: containerRef.value.offsetHeight || 600,
        data: props.graphData,
      });
      graph.render();
    } catch (error) {
      console.error('调整图形大小失败:', error);
      if (graph) {
        graph.destroy();
        graph = null;
      }
    }
  }
};

// 组件卸载时清理
onUnmounted(() => {
  if (graph) {
    graph.destroy();
    graph = null;
  }
  window.removeEventListener('resize', handleResize);
});
</script>

<template>
  <div class="drawing-board-container" ref="containerRef">
    <div class="drawing-board-toolbar">
      <div class="toolbar-item">
        <span class="toolbar-text">画板功能</span>
      </div>
    </div>
  </div>
</template>

<style scoped>
.drawing-board-container {
  width: 100%;
  height: 100%;
  position: relative;
  background-color: #fafafa;
  border: 1px solid #e8e8e8;
  overflow: hidden;
}

.drawing-board-toolbar {
  position: absolute;
  top: 10px;
  left: 10px;
  background-color: white;
  border-radius: 4px;
  padding: 8px;
  box-shadow: 0 2px 8px rgba(0, 0, 0, 0.15);
  z-index: 10;
}

.toolbar-item {
  display: flex;
  align-items: center;
  margin-bottom: 4px;
  font-size: 12px;
  color: #666;
}

.toolbar-item:last-child {
  margin-bottom: 0;
}

.toolbar-icon {
  margin-right: 6px;
  font-size: 14px;
}

.toolbar-text {
  white-space: nowrap;
}
</style>
