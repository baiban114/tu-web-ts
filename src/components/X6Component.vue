<script setup lang="ts">
import { ref, onMounted, onBeforeUnmount } from 'vue';
import { Graph } from '@antv/x6';

interface Props {
  width?: number;
  height?: number;
}

const props = withDefaults(defineProps<Props>(), {
  width: 800,
  height: 400
});

const containerRef = ref<HTMLElement | null>(null);
let graph: Graph | null = null;

// 初始化X6图
const initGraph = () => {
  if (!containerRef.value) return;
  
  try {
    // 销毁旧图
    if (graph) {
      graph.dispose();
    }
    
    // 创建新图
    graph = new Graph({
      container: containerRef.value,
      width: props.width,
      height: props.height,
      grid: {
        size: 10,
        visible: true
      }
    });
    
    // 添加示例节点和边
    const node1 = graph.addNode({
      x: 100,
      y: 100,
      width: 80,
      height: 40,
      label: '节点 1'
    });
    
    const node2 = graph.addNode({
      x: 300,
      y: 100,
      width: 80,
      height: 40,
      label: '节点 2'
    });
    
    graph.addEdge({
      source: node1,
      target: node2
    });
    
  } catch (error) {
    console.error('初始化X6图失败:', error);
  }
};

onMounted(() => {
  initGraph();
});

onBeforeUnmount(() => {
  if (graph) {
    graph.dispose();
    graph = null;
  }
});
</script>

<template>
  <div ref="containerRef" class="x6-container"></div>
</template>

<style scoped>
.x6-container {
  width: 100%;
  height: 100%;
  min-height: 400px;
  background: #fafafa;
  border-radius: 4px;
  overflow: hidden;
}
</style>