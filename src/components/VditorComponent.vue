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
    // 直接传递配置对象给Vditor构造函数
    vditorInstance.value = new Vditor(vditorRef.value, {
      height: props.height,
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
      },
      // 使用after钩子在渲染完成后初始化图表
      after: () => {
        // 延迟一下，确保DOM已经渲染完成
        setTimeout(() => {
          initGraphs();
        }, 0);
      },
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
/* 彻底隐藏工具栏 */
.vditor-container :deep(.vditor-toolbar) {
  display: none !important;
  height: 0 !important;
  min-height: 0 !important;
  overflow: hidden !important;
}

/* 确保悬停时也不显示工具栏 */
.vditor-container :deep(.vditor-toolbar:hover) {
  display: none !important;
  height: 0 !important;
  min-height: 0 !important;
  overflow: hidden !important;
}

/* 确保工具栏的任何变体都被隐藏 */
.vditor-container :deep(.vditor-toolbar--hide) {
  display: none !important;
  height: 0 !important;
  min-height: 0 !important;
  overflow: hidden !important;
}
</style>