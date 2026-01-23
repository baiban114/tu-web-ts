<script setup lang="ts">
import { ref, onMounted } from 'vue';
import Page from './Page.vue';
import type { Block } from './Page.vue';

const contentList = ref<Block[]>([]);

// 模拟接口请求
const fetchContentData = async (): Promise<Block[]> => {
  await new Promise(resolve => setTimeout(resolve, 500));
  
  return [
    {
      id: '0',
      type: 'x6',
      title: '时间轴图',
      graphData: {
        nodes: [
          { id: 'timeline-node1', x: 100, y: 100, width: 120, height: 40, label: '开始' },
          { id: 'timeline-node2', x: 300, y: 100, width: 120, height: 40, label: '进行中' },
          { id: 'timeline-node3', x: 500, y: 100, width: 120, height: 40, label: '完成' },
          { id: 'timeline-node4', x: 700, y: 100, width: 120, height: 40, label: '回顾' },
        ],
        edges: [
          { id: 'timeline-edge1', source: 'timeline-node1', target: 'timeline-node2' },
          { id: 'timeline-edge2', source: 'timeline-node2', target: 'timeline-node3' },
          { id: 'timeline-edge3', source: 'timeline-node3', target: 'timeline-node4' },
        ],
      }
    },
    {
      id: '1',
      type: 'richtext',
      title: '富文本编辑器 1',
      content: `# 欢迎使用富文本编辑器\n\n这是第一个富文本编辑器，\n\n## 功能特点\n- `
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
      id: '6',
      type: 'line',
      title: '时间轴示例',
      timelineData: [
        {
          id: 'event-1',
          title: 'Design',
          content: 'UI/UX design',
          date: '2024-02',
          color: '#4169E1',
          lightColor: 'rgba(65, 105, 225, 0.1)',
          type: 'normal'
        },
        {
          id: 'event-2',
          title: 'Build',
          content: 'Development',
          date: '2024-03',
          color: '#FF8C00',
          lightColor: 'rgba(255, 140, 0, 0.1)',
          type: 'normal'
        },
        {
          id: 'milestone-1',
          title: 'V1.0',
          content: 'First release',
          date: '2024-04',
          color: '#4169E1',
          lightColor: 'rgba(65, 105, 225, 0.1)',
          type: 'milestone'
        },
        {
          id: 'event-3',
          title: 'Test',
          content: 'QA testing',
          date: '2024-05',
          color: '#FF1493',
          lightColor: 'rgba(255, 20, 147, 0.1)',
          type: 'normal'
        },
        {
          id: 'event-4',
          title: 'Launch',
          content: 'Go live',
          date: '2024-06',
          color: '#2E8B57',
          lightColor: 'rgba(46, 139, 87, 0.1)',
          type: 'normal'
        }
      ]
    },

  ];
};

const initComponents = async () => {
  try {
    // 如果contentList为空，则从接口获取数据
    if (contentList.value.length === 0) {
      const data = await fetchContentData();
      contentList.value = data;
    }
    
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
    <Page 
      v-if="contentList.length > 0" 
      :contentList="contentList" 
      @content-change="(list: Block[]) => contentList = list" 
    />
    <div v-else class="loading">
      <p>加载中...</p>
    </div>
  </div>
</template>

<style scoped>
.loading {
  display: flex;
  align-items: center;
  justify-content: center;
  height: 200px;
  color: #999;
  background: #fafafa;
  border-radius: 8px;
  margin-top: 20px;
}
</style>
