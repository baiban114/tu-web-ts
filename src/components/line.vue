<template>
  <div class="graph-wrapper">
    <div 
      ref="graphContainer" 
      class="graph-container"
      :class="{ 'graph-visible': isVisible }"
    ></div>
  </div>
</template>

<script setup lang="ts">
import { ref, onMounted, onBeforeUnmount, nextTick, watch } from 'vue';
import { Graph } from '@antv/x6';

interface Props {
  graphData?: {
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
  };
  timelineData?: Array<{
    id: string;
    title: string;
    content: string;
    date: string;
    color: string;
    lightColor: string;
    type: 'normal' | 'milestone';
  }>;
}

const props = withDefaults(defineProps<Props>(), {
  graphData: undefined,
  timelineData: undefined
});

const graphContainer = ref<HTMLElement | null>(null);
const isVisible = ref(false);
let graph: Graph | null = null;

// 默认时间线数据为空数组，强制使用传入的数据
const defaultTimelineData: Array<{
  id: string;
  title: string;
  content: string;
  date: string;
  color: string;
  lightColor: string;
  type: 'normal' | 'milestone';
}> = [];

const preWork = () => {
  // Vue 中不需要手动插入样式
  // 样式通过 style 标签或 CSS 文件管理
};

const initGraph = () => {
  if (!graphContainer.value) return;
  
  graph = new Graph({
    container: graphContainer.value,
    // 基本配置
    width: 800,
    height: 600,
    grid: {
      size: 10,
      visible: true
    },
    panning: {
      enabled: true,
      eventTypes: ['leftMouseDown', 'mouseWheel']
    },
    mousewheel: {
      enabled: true,
      modifiers: 'ctrl',
      factor: 1.1,
      maxScale: 3,
      minScale: 0.1
    }
  });
  
  setupGraph();
};

const setupGraph = () => {
  // 加载数据
  loadData();
};

const loadData = async () => {
  try {
    // 检查是否有传入的 graphData
    if (props.graphData && props.graphData.nodes.length > 0) {
      // 使用传入的 graphData
      if (graph) {
        // 直接使用传入的节点和边数据
        const cells: any[] = [];
        
        // 添加节点
        props.graphData.nodes.forEach(node => {
          cells.push(graph!.createNode({
            x: node.style?.x || 0,
            y: node.style?.y || 0,
            data: node.data,
            ...node
          }));
        });
        
        // 添加边
        props.graphData.edges.forEach(edge => {
          cells.push(graph!.createEdge({
            data: edge.data,
            ...edge
          }));
        });
        
        graph.resetCells(cells);
      }
    } else if (props.timelineData && props.timelineData.length > 0) {
      // 使用传入的 timelineData
      if (graph) {
        const cells: any[] = [];
        
        // 创建时间线节点
        props.timelineData.forEach((item, index) => {
          cells.push(graph!.createNode({
            id: item.id,
            x: 100 + index * 150,
            y: 100,
            width: 120,
            height: 60,
            data: {
              title: item.title,
              date: item.date,
              color: item.color
            },
            attrs: {
              body: {
                fill: item.lightColor,
                stroke: item.color,
                rx: 4,
                ry: 4
              },
              label: {
                text: item.title,
                fill: item.color,
                fontSize: 14,
                fontWeight: item.type === 'milestone' ? 'bold' : 'normal'
              }
            }
          }));
        });
        
        // 创建连接边
        for (let i = 0; i < props.timelineData.length - 1; i++) {
          cells.push(graph!.createEdge({
            source: props.timelineData[i].id,
            target: props.timelineData[i + 1].id,
            attrs: {
              line: {
                stroke: '#999',
                strokeWidth: 2,
                targetMarker: {
                  type: 'path',
                  d: 'M 10 -5 0 0 10 5 z',
                  fill: '#999'
                }
              }
            }
          }));
        }
        
        graph.resetCells(cells);
      }
    } else {
      // 使用默认的时间线数据
      if (graph) {
        // 创建时间线节点
        const cells: any[] = [];
        
        // 创建时间线节点
        defaultTimelineData.forEach((item, index) => {
          cells.push(graph!.createNode({
            id: item.id,
            x: 100 + index * 150,
            y: 100,
            width: 120,
            height: 60,
            data: {
              title: item.title,
              date: item.date,
              color: item.color
            },
            attrs: {
              body: {
                fill: item.lightColor,
                stroke: item.color,
                rx: 4,
                ry: 4
              },
              label: {
                text: item.title,
                fill: item.color,
                fontSize: 14,
                fontWeight: item.type === 'milestone' ? 'bold' : 'normal'
              }
            }
          }));
        });
        
        // 创建连接边
        for (let i = 0; i < defaultTimelineData.length - 1; i++) {
          cells.push(graph!.createEdge({
            source: defaultTimelineData[i].id,
            target: defaultTimelineData[i + 1].id,
            attrs: {
              line: {
                stroke: '#999',
                strokeWidth: 2,
                targetMarker: {
                  type: 'path',
                  d: 'M 10 -5 0 0 10 5 z',
                  fill: '#999'
                }
              }
            }
          }));
        }
        
        graph.resetCells(cells);
      }
    }
    
    // 显示图表
    nextTick(() => {
      isVisible.value = true;
      graph?.zoomToFit({ padding: 20, maxScale: 1 });
    });
  } catch (error) {
    console.error('数据加载失败', error);
  }
};

onMounted(() => {
  initGraph();
  preWork();
});

onBeforeUnmount(() => {
  if (graph) {
    graph.dispose();
    graph = null;
  }
});

// 监听 graphData 和 timelineData 变化
watch(
  [() => props.graphData, () => props.timelineData],
  () => {
    if (graph) {
      graph.dispose();
      graph = null;
    }
    initGraph();
  },
  { deep: true }
);
</script>

<style scoped>
.graph-wrapper {
  width: 100%;
  height: 600px;
  background: #FFF;
  margin: 0;
  padding: 0;
  overflow: hidden;
  position: relative;
}

.graph-container {
  width: 100%;
  height: 100%;
  opacity: 0;
  transition: opacity 0.3s ease-in-out;
}

.graph-container.graph-visible {
  opacity: 1;
}
</style>