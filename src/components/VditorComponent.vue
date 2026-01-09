<script setup lang="ts">
import Vditor from 'vditor';
import 'vditor/dist/index.css';
import { ref, onMounted, watch, onBeforeUnmount } from 'vue';
import { Graph } from '@antv/g6';

interface Props {
  content: string;
  height?: number;
  width?: string;
}

const props = withDefaults(defineProps<Props>(), {
  height: 300,
  width: '100%',
});

const emit = defineEmits<{
  (e: 'content-change', content: string): void;
}>();

const vditorRef = ref<HTMLDivElement | null>(null);
const vditorInstance = ref<Vditor | null>(null);
const graphInstances = ref<Graph[]>([]);

// 初始化G6图表
const initGraphs = () => {
  // 清除现有的图表实例
  graphInstances.value.forEach(graph => graph.destroy());
  graphInstances.value = [];
  
  if (!vditorRef.value) return;
  
  // 查找所有图表容器
  const graphContainers = vditorRef.value.querySelectorAll('.g6-graph-container');
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

onMounted(() => {
  if (vditorRef.value) {
    vditorInstance.value = new Vditor(vditorRef.value, {
      height: props.height,
      width: props.width,
      value: props.content,
      mode: 'wysiwyg',
      cache: { enable: false },
      customWysiwygToolbar: (toolbar: any) => toolbar,
      input: (value: string) => {
        emit('content-change', value);
      },
      // 使用after钩子在渲染完成后初始化图表
      after: () => {
        // 延迟一下，确保DOM已经渲染完成
        setTimeout(() => {
          initGraphs();
        }, 0);
      },
      // 添加自定义工具栏按钮
      toolbar: [
        'bold', 'italic', 'strike', '|',
        'h1', 'h2', 'h3', '|',
        'list', 'ordered-list', 'check', '|',
        'link', 'image', '|',
        {
          name: 'insert-graph',
          icon: '<svg width="16" height="16" viewBox="0 0 16 16"><path d="M1 2.5A1.5 1.5 0 0 1 2.5 1h10A1.5 1.5 0 0 1 14 2.5v10a1.5 1.5 0 0 1-1.5 1.5h-10A1.5 1.5 0 0 1 1 12.5v-10zM2.5 2a.5.5 0 0 0-.5.5v10a.5.5 0 0 0 .5.5h10a.5.5 0 0 0 .5-.5v-10a.5.5 0 0 0-.5-.5h-10zM3 3v8h2V7h3V5H5V3H3z" fill="currentColor"></path></svg>',
          tipPosition: 'n',
          tip: '插入图表',
          click: () => {
            // 插入图表容器
            const graphData = {
              nodes: [
                { id: 'node-1', style: { x: 100, y: 100 }, label: '节点1' },
                { id: 'node-2', style: { x: 300, y: 100 }, label: '节点2' },
              ],
              edges: [
                { id: 'edge-1', source: 'node-1', target: 'node-2' },
              ],
            };
            const graphDataStr = JSON.stringify(graphData).replace(/"/g, '&quot;');
            const graphHtml = `<div class="g6-graph-container" data-graph-data="${graphDataStr}" style="width: 100%; height: 400px; border: 1px solid #d9d9d9; border-radius: 4px; background: #fafafa;"></div>`;
            
            vditorInstance.value?.insertValue(graphHtml);
            // 重新初始化图表
            setTimeout(() => {
              initGraphs();
            }, 0);
          },
        },
      ],
    });
  }
});

onBeforeUnmount(() => {
  // 销毁所有图表实例
  graphInstances.value.forEach(graph => graph.destroy());
  // 销毁Vditor实例
  if (vditorInstance.value) {
    vditorInstance.value.destroy();
  }
});

watch(
  () => props.content,
  (newContent) => {
    if (vditorInstance.value && newContent !== vditorInstance.value.getValue()) {
      vditorInstance.value.setValue(newContent);
      // 重新初始化图表
      setTimeout(() => {
        initGraphs();
      }, 0);
    }
  }
);
</script>

<template>
  <div ref="vditorRef" class="vditor-container"></div>
</template>

<style scoped>
.vditor-container {
  border: 1px solid #d9d9d9;
  border-radius: 4px;
  min-height: 300px;
  overflow: hidden;
}
</style>