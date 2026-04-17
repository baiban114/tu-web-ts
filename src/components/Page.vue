<script setup lang="ts">
import { ref, onMounted, onBeforeUnmount, watch, computed, nextTick } from 'vue';
import RichTextEditor from './RichTextEditor.vue';
import HoverHandle from './HoverHandle.vue';
import BlockPicker from './BlockPicker.vue';
import Line from './line.vue';
import X6Component from './X6Component.vue';
import Toast from './Toast.vue';
import { VueDraggable } from 'vue-draggable-plus';
import { blockSyncManager } from '@/utils/blockSyncManager';
import { useBlockRegistryStore } from '@/stores/blockRegistry';

interface GraphData {
  cells?: Array<Record<string, any>>;
  nodes: Array<{
    id: string;
    x?: number;
    y?: number;
    width?: number;
    height?: number;
    label?: string;
    shape?: string;
    style?: {
      x?: number;
      y?: number;
      [key: string]: any;
    };
    attrs?: Record<string, any>;
    ports?: Record<string, any>;
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
    source: string | Record<string, any>;
    target: string | Record<string, any>;
    attrs?: Record<string, any>;
    router?: string | Record<string, any>;
    connector?: string | Record<string, any>;
    labels?: Array<Record<string, any>>;
    data?: {
      done?: boolean;
      [key: string]: any;
    };
    [key: string]: any;
  }>;
}

export interface Block {
  id: string;
  type: 'richtext' | 'richText' | 'line' | 'x6' | 'ref' | 'container' | 'spacer' | string;
  title?: string;
  content?: string;
  refId?: string; // type === 'ref' 时指向被引用块的 id
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
  spacerHeight?: number;
  layout?: 'horizontal' | 'vertical';
  children?: Block[];
  width?: string;
  [key: string]: any;
}

interface Props {
  contentList: Block[];
  editable?: boolean;
}

interface RichTextLineInsertPayload {
  beforeContent: string;
  afterContent: string;
  blockType: 'richtext' | 'line' | 'x6' | 'ref' | 'container';
  layout?: 'horizontal' | 'vertical';
}

const props = withDefaults(defineProps<Props>(), {
  editable: true
});

const emit = defineEmits<{
  (e: 'content-change', contentList: Block[]): void;
}>();

const registryStore = useBlockRegistryStore();
const blockDragHandle = '.handle-dot';

// 本地列表：VueDraggable 使用 v-model 操作此 ref，避免直接 mutate prop
const localBlocks = ref<Block[]>([]);

// 引用块弹窗状态
const showBlockPicker = ref(false);
const pendingRefInsertPosition = ref(-1);
const pendingRichTextSplitInsert = ref<{
  position: number;
  beforeContent: string;
  afterContent: string;
} | null>(null);

const blockRefs = ref<HTMLElement[]>([]);
/** 富文本编辑器实例（按块索引），用于提取时获取带格式的 Markdown */
const richTextEditorRefs = ref<Record<number, {
  getSelectionAsMarkdown?: () => string;
  focusEditor?: () => void;
}>>({});
const hasSelection = ref(false);
const selectedText = ref('');
const selectedBlockIndex = ref(-1);
const contentContainerRef = ref<HTMLElement | null>(null);
const blockHandleStyle = {
  '--hover-handle-left': 'calc(var(--block-handle-gutter, 36px) / 2)',
  '--hover-handle-top': 'calc(var(--block-shell-pad-y, 20px) + 6px)',
  '--hover-handle-transform': 'translateX(-50%)',
} as const;

const blockHandleItems = [
  { key: 'insert-richtext', icon: '📝', label: '插入文本块' },
  { key: 'insert-ref', icon: '🔖', label: '插入引用块' },
  { key: 'insert-line', icon: '🕒', label: '插入时间轴' },
  { key: 'insert-x6', icon: '🧩', label: '插入画板' },
  { key: 'insert-container-horizontal', icon: '📦', label: '插入水平容器' },
  { key: 'insert-container-vertical', icon: '📦', label: '插入垂直容器' },
  { key: 'divider-danger', divider: true },
  { key: 'delete', icon: '🗑️', label: '删除块', danger: true },
];

const childBlockHandleItems = [
  { key: 'insert-richtext', icon: '📝', label: '插入文本块' },
  { key: 'insert-ref', icon: '🔖', label: '插入引用块' },
  { key: 'insert-line', icon: '🕒', label: '插入时间轴' },
  { key: 'insert-x6', icon: '🧩', label: '插入画板' },
  { key: 'divider-danger', divider: true },
  { key: 'delete', icon: '🗑️', label: '删除块', danger: true },
];

const setRichTextEditorRef = (el: unknown, index: number) => {
  if (el) {
    richTextEditorRefs.value[index] = el as {
      getSelectionAsMarkdown?: () => string;
      focusEditor?: () => void;
    };
  } else {
    delete richTextEditorRefs.value[index];
  }
};

const getBlockAtPosition = (position: number): Block | undefined => {
  if (position >= 100) {
    const containerIndex = Math.floor(position / 100);
    const childIndex = position % 100;
    const container = localBlocks.value[containerIndex];
    if (container?.type === 'container' && container.children) {
      return container.children[childIndex];
    }
    return undefined;
  }

  return localBlocks.value[position];
};

const replaceBlockAtPosition = (position: number, blocks: Block[]) => {
  const normalizedBlocks = blocks.map((block) => normalizeBlockType(block));

  if (position >= 100) {
    const containerIndex = Math.floor(position / 100);
    const childIndex = position % 100;
    const container = localBlocks.value[containerIndex];
    if (container?.type === 'container' && container.children) {
      container.children.splice(childIndex, 1, ...normalizedBlocks);
      emit('content-change', localBlocks.value);
    }
    return;
  }

  localBlocks.value.splice(position, 1, ...normalizedBlocks);
  commitTopLevelBlocks();
};

// Toast相关状态
const toastMessages = ref<Array<{ id: string; message: string }>>([]);
const toastEnabled = ref(true); // 启用消息提示

// 显示Toast消息
const showToast = (message: string) => {
  if (!toastEnabled.value) return; // 如果未启用，直接返回
  const id = `toast-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;
  toastMessages.value.push({ id, message });
};

// 移除Toast消息
const removeToast = (id: string) => {
  const index = toastMessages.value.findIndex(toast => toast.id === id);
  if (index >= 0) {
    toastMessages.value.splice(index, 1);
  }
};

// 生成唯一ID
const generateId = (): string => {
  return `block-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;
};

// 记录需要自动获得焦点的块 ID（新建块时使用）
const autoFocusBlockId = ref<string | null>(null);

// 创建新的富文本块
const createEmptyRichTextBlock = (): Block => ({
  id: generateId(),
  type: 'richtext',
  title: '',
  content: '',
});

const createNewRichTextBlock = (): Block => {
  const block: Block = createEmptyRichTextBlock();
  autoFocusBlockId.value = block.id;
  return block;
};

const createRichTextBlockWithContent = (content: string): Block => ({
  ...createEmptyRichTextBlock(),
  content,
});

const hasMeaningfulRichTextContent = (content?: string): boolean => {
  return Boolean(content && content.trim());
};

const buildSplitReplacementBlocks = (
  beforeContent: string,
  insertedBlock: Block,
  afterContent: string,
): Block[] => {
  const blocks: Block[] = [];

  if (hasMeaningfulRichTextContent(beforeContent)) {
    blocks.push(createRichTextBlockWithContent(beforeContent));
  }

  blocks.push(insertedBlock);

  if (hasMeaningfulRichTextContent(afterContent)) {
    blocks.push(createRichTextBlockWithContent(afterContent));
  }

  return blocks;
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
    title: '新的画板',
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

// 创建新的容器块
const createNewContainerBlock = (position: number, layout: 'horizontal' | 'vertical' = 'horizontal'): Block => {
  return {
    id: generateId(),
    type: 'container',
    title: `新的${layout === 'horizontal' ? '水平' : '垂直'}容器`,
    layout,
    children: [
      createNewRichTextBlock(),
      createNewRichTextBlock()
    ]
  };
};

// 创建引用块
const createRefBlock = (refId: string): Block => ({
  id: generateId(),
  type: 'ref',
  refId,
});

// 打开引用块选择弹窗（记录插入位置）
const openBlockPicker = (position: number) => {
  pendingRefInsertPosition.value = position;
  pendingRichTextSplitInsert.value = null;
  showBlockPicker.value = true;
};

// 选中引用源后插入 ref 块
const onRefBlockSelected = (refId: string) => {
  const position = pendingRefInsertPosition.value;
  if (position >= 0) {
    if (pendingRichTextSplitInsert.value) {
      const { beforeContent, afterContent } = pendingRichTextSplitInsert.value;
      const blocksToInsert = buildSplitReplacementBlocks(beforeContent, createRefBlock(refId), afterContent);

      // Auto-focus trailing richtext block when cursor was at the end
      if (!hasMeaningfulRichTextContent(afterContent)) {
        const trailing = blocksToInsert[blocksToInsert.length - 1];
        if (isRichTextBlock(trailing)) {
          autoFocusBlockId.value = trailing.id;
        }
      }

      replaceBlockAtPosition(position, blocksToInsert);
    } else {
      insertBlock(position, createRefBlock(refId));
    }
  }
  pendingRefInsertPosition.value = -1;
  pendingRichTextSplitInsert.value = null;
};

// 统一富文本类型为 'richtext'，避免 'richText' 导致未知类型显示
const normalizeBlockType = (block: Block): Block => {
  if (block.type === 'richText') {
    return { ...block, type: 'richtext' };
  }
  if (block.type === 'graph') {
    return {
      ...block,
      type: 'x6',
      title: block.title || '画板',
    };
  }
  return block;
};

// 判断是否为富文本块（统一用此方法，避免大小写/驼峰混用导致误判）
const isRichTextBlock = (block: Block): boolean => {
  return block != null && (block.type === 'richtext' || block.type === 'richText');
};

// 在指定位置插入新block
const isSpacerBlock = (block: Block): boolean => {
  return block?.type === 'spacer';
};

const normalizeTopLevelBlocks = (blocks: Block[]): Block[] => {
  let changed = false;
  const filteredBlocks: Block[] = [];

  for (const sourceBlock of blocks) {
    const normalizedBlock = normalizeBlockType(sourceBlock);
    if (normalizedBlock !== sourceBlock) changed = true;
    if (isSpacerBlock(normalizedBlock)) {
      changed = true;
      continue;
    }
    filteredBlocks.push(normalizedBlock);
  }

  if (filteredBlocks.length === 0) {
    return [createEmptyRichTextBlock()];
  }

  const result: Block[] = [];

  if (!isRichTextBlock(filteredBlocks[0])) {
    result.push(createEmptyRichTextBlock());
    changed = true;
  }

  for (const block of filteredBlocks) {
    const previousBlock = result[result.length - 1];
    if (previousBlock && !isRichTextBlock(previousBlock) && !isRichTextBlock(block)) {
      result.push(createEmptyRichTextBlock());
      changed = true;
    }
    result.push(block);
  }

  if (!isRichTextBlock(result[result.length - 1])) {
    result.push(createEmptyRichTextBlock());
    changed = true;
  }

  return changed ? result : blocks;
};

const syncLocalBlocksFromSource = (blocks: Block[]) => {
  isNormalizing.value = true;
  localBlocks.value = normalizeTopLevelBlocks(blocks);
  void nextTick(() => {
    isNormalizing.value = false;
  });
};

const commitTopLevelBlocks = () => {
  const normalizedBlocks = normalizeTopLevelBlocks(localBlocks.value);
  if (normalizedBlocks !== localBlocks.value) {
    syncLocalBlocksFromSource(normalizedBlocks);
  }
  emit('content-change', localBlocks.value);
};

const insertBlocks = (position: number, blocks: Block[]) => {
  const normalizedBlocks = blocks.map((block) => normalizeBlockType(block));
  if (normalizedBlocks.length === 0) return;

  if (position >= 100) {
    const containerIndex = Math.floor(position / 100);
    const childIndex = position % 100;
    const container = localBlocks.value[containerIndex];
    if (container?.type === 'container' && container.children) {
      container.children.splice(childIndex, 0, ...normalizedBlocks);
      emit('content-change', localBlocks.value);
      return;
    }
  }

  localBlocks.value.splice(position, 0, ...normalizedBlocks);
  commitTopLevelBlocks();
};

const insertBlock = (position: number, block: Block) => {
  const normalized = normalizeBlockType(block);
  console.log(`insertBlock函数被调用，位置: ${position}, 类型: ${normalized.type}`);
  
  // 处理容器块内的插入
  if (position >= 100) {
    const containerIndex = Math.floor(position / 100);
    const childIndex = position % 100;
    const container = localBlocks.value[containerIndex];
    if (container && container.type === 'container' && container.children) {
      container.children.splice(childIndex, 0, normalized);
      emit('content-change', localBlocks.value);
      return;
    }
  }

  // 普通块的插入
  localBlocks.value.splice(position, 0, normalized);
  commitTopLevelBlocks();
};

// 删除指定位置的block
const removeBlock = (position: number) => {
  // 处理容器块内的删除
  if (position >= 100) {
    const containerIndex = Math.floor(position / 100);
    const childIndex = position % 100;
    const container = localBlocks.value[containerIndex];
    if (container && container.type === 'container' && container.children) {
      if (container.children.length > 0) {
        container.children.splice(childIndex, 1);
        emit('content-change', localBlocks.value);
      }
      return;
    }
  }

  // 普通块的删除
  if (localBlocks.value.length > 0) {
    localBlocks.value.splice(position, 1);
    commitTopLevelBlocks();
  }
};

// 处理悬浮手柄菜单操作
const handleBlockHandleSelect = (action: string, position: number) => {
  const insertPosition = position + 1;

  switch (action) {
    case 'insert-richtext':
      insertBlock(insertPosition, createNewRichTextBlock());
      return;
    case 'insert-ref':
      openBlockPicker(insertPosition);
      return;
    case 'insert-line':
      insertBlock(insertPosition, createNewLineBlock(insertPosition));
      return;
    case 'insert-x6':
      insertBlock(insertPosition, createNewX6Block(insertPosition));
      return;
    case 'insert-container-horizontal':
      insertBlock(insertPosition, createNewContainerBlock(insertPosition, 'horizontal'));
      return;
    case 'insert-container-vertical':
      insertBlock(insertPosition, createNewContainerBlock(insertPosition, 'vertical'));
      return;
    case 'delete':
      removeBlock(position);
      return;
    default:
      return;
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
      // 优先从富文本编辑器取带格式的 Markdown，否则用纯文本
      const editor = richTextEditorRefs.value[blockIndex];
      const content = editor?.getSelectionAsMarkdown?.() || window.getSelection()?.toString()?.trim() || '';
      if (content) {
        handleExtractSelection(content, blockIndex);
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
      const newBlock = createNewRichTextBlock();
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
  const block = getBlockAtPosition(blockIndex);
  const target = event.target as HTMLElement | null;
  if (blockElement && target) {
    // 如果点击的是富文本编辑器内部，不获取焦点
    const isRichTextEditor = target.closest('.rich-text-editor-container, .vditor-container, .vditor-wysiwyg, .vditor-editor');
    const isGraphEditor = target.closest('.x6-editor, .x6-stage, .x6-canvas');
    if (block && isRichTextBlock(block) && !isRichTextEditor) {
      richTextEditorRefs.value[blockIndex]?.focusEditor?.();
      return;
    }
    if (!isRichTextEditor && !isGraphEditor) {
      blockElement.focus();
    }
  }
};

// 处理富文本编辑器的点击事件
const handleRichTextEditorClick = (event: MouseEvent, blockIndex: number) => {
  // 点击事件处理
};

// 处理富文本编辑器的生命周期事件
const handleRichTextEditorLifecycle = (method: string, blockIndex: number) => {
  // 生命周期事件，暂时不显示消息
};

// 标记：是否正在规范化contentList，避免循环触发
const handleRichTextLineInsert = (payload: RichTextLineInsertPayload, blockIndex: number) => {
  if (!props.editable) return;

  const { beforeContent, afterContent, blockType, layout } = payload;

  if (blockType === 'ref') {
    pendingRefInsertPosition.value = blockIndex;
    pendingRichTextSplitInsert.value = {
      position: blockIndex,
      beforeContent,
      afterContent,
    };
    showBlockPicker.value = true;
    return;
  }

  let insertedBlock: Block;
  switch (blockType) {
    case 'richtext':
      insertedBlock = createNewRichTextBlock();
      break;
    case 'line':
      insertedBlock = createNewLineBlock(blockIndex + 1);
      break;
    case 'x6':
      insertedBlock = createNewX6Block(blockIndex + 1);
      break;
    case 'container':
      insertedBlock = createNewContainerBlock(blockIndex + 1, layout === 'vertical' ? 'vertical' : 'horizontal');
      break;
    default:
      return;
  }

  const replacementBlocks = buildSplitReplacementBlocks(beforeContent, insertedBlock, afterContent);
  replaceBlockAtPosition(blockIndex, replacementBlocks);
};

const isNormalizing = ref(false);

watch(showBlockPicker, (visible) => {
  if (visible) return;
  pendingRichTextSplitInsert.value = null;
});

watch(
  () => props.contentList,
  (newList) => {
    syncLocalBlocksFromSource(newList);
  },
  { immediate: true }
);

// 监听本地列表长度变化，重置 block DOM refs
watch(
  () => localBlocks.value.length,
  () => {
    blockRefs.value = [];
  }
);

// 监听本地列表内容变化：规范化类型、同步到后端
watch(
  localBlocks,
  (newList) => {
    if (isNormalizing.value) return;

    // 若存在 richText 类型，统一规范为 richtext
    const normalizedBlocks = normalizeTopLevelBlocks(newList);
    if (normalizedBlocks !== newList) {
      syncLocalBlocksFromSource(normalizedBlocks);
      emit('content-change', normalizedBlocks);
      return;
    }

    blockSyncManager.updateBlocks(normalizedBlocks);

    const unknownBlocks = normalizedBlocks.filter(block =>
      !isRichTextBlock(block) &&
      !isSpacerBlock(block) &&
      block.type !== 'line' &&
      block.type !== 'x6' &&
      block.type !== 'ref' &&
      block.type !== 'container'
    );
    if (unknownBlocks.length > 0) {
      unknownBlocks.forEach(block => console.log('发现未知类型的block:', block));
    }
  },
  { deep: true }
);

// 生命周期钩子
onMounted(() => {
  // 注册同步状态回调，显示 toast 提示
  blockSyncManager.onStatusChange((status, error) => {
    if (status === 'syncing') {
      showToast('正在同步内容...');
    } else if (status === 'synced') {
      showToast('内容已同步到服务器');
    } else if (status === 'error') {
      showToast(`同步失败：${error || '网络错误'}`);
    }
  });

  // 添加选择事件监听器
  document.addEventListener('selectionchange', checkSelection);
});

onBeforeUnmount(() => {
  // 移除选择事件监听器
  document.removeEventListener('selectionchange', checkSelection);
  // 销毁同步管理器，清理定时器
  blockSyncManager.destroy();
});

// 检查是否有选中文本
const checkSelection = () => {
  try {
    const selection = window.getSelection();
    if (selection && selection.toString().trim()) {
      selectedText.value = selection.toString().trim();
      hasSelection.value = true;
      
      // 找出当前选中的块索引
      for (let i = 0; i < localBlocks.value.length; i++) {
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
  console.log('handleExtractSelection 接收到的文本:', text);
  
  if (!text || !props.editable) return;

  // 复用统一的创建方法，再覆盖 content（提取块有内容，无需 autoFocus）
  const insertPosition = blockIndex + 1;
  const newBlock = createNewRichTextBlock();
  newBlock.content = text;
  autoFocusBlockId.value = null; // 提取块不需要自动聚焦
  insertBlock(insertPosition, newBlock);
  
  // TODO: 从原块中移除选中的文本
  // 注意：这需要更复杂的DOM操作，因为我们需要知道选中的具体位置
};

// 处理工具栏提取成块按钮点击
const handleExtractSelectionButtonClick = () => {
  if (!hasSelection.value || selectedBlockIndex.value < 0) return;
  const index = selectedBlockIndex.value;
  // 若选中在富文本块内，优先用编辑器返回的 Markdown（保留格式）
  const editor = richTextEditorRefs.value[index];
  const content = editor?.getSelectionAsMarkdown?.() || selectedText.value;
  if (content) {
    handleExtractSelection(content, index);
  }
};

// 处理拖拽结束事件
const handleDragEnd = () => {
  commitTopLevelBlocks();
  showToast('块已成功移动');
};

const handleContentContainerClick = (event: MouseEvent) => {
  if (!props.editable) return;

  const target = event.target as HTMLElement | null;
  if (!target) return;
  if (target.closest('.content-wrapper, .block-handle, .handle-menu')) return;

  const blocks = localBlocks.value;
  if (blocks.length === 0) {
    insertBlock(0, createNewRichTextBlock());
    return;
  }

  const lastBlock = blocks[blocks.length - 1];
  if (isRichTextBlock(lastBlock)) {
    richTextEditorRefs.value[blocks.length - 1]?.focusEditor?.();
  } else {
    insertBlock(blocks.length, createNewRichTextBlock());
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
    
    <div
      ref="contentContainerRef"
      class="content-container"
      @click="handleContentContainerClick"
    >
      <VueDraggable
        class="blocks-list"
        v-model="localBlocks"
        :handle="blockDragHandle"
        :animation="200"
        ghost-class="dragging-ghost"
        chosen-class="dragging-chosen"
        drag-class="dragging-drag"
        @end="handleDragEnd"
        :scroll="true"
        :scroll-sensitivity="30"
        :scroll-speed="10"
      >
        <div
          v-for="(block, index) in localBlocks"
          :key="block.id"
          class="content-wrapper"
          :class="{
            'content-wrapper--richtext': isRichTextBlock(block),
          }"
          :data-block-index="index"
          :data-block-id="block.id"
          :ref="(el) => { if(el) blockRefs[index] = el as HTMLElement }"
          @keydown="handleKeyDown($event, index)"
          @click="handleBlockClick($event, index)"
          :tabindex="editable ? 0 : -1"
        >
          <!-- 左侧悬浮手柄 -->
          <HoverHandle
            v-if="editable && !isRichTextBlock(block)"
            class="block-handle"
            :style="blockHandleStyle"
            :items="blockHandleItems"
            :drag-cursor="true"
            @select="(action) => handleBlockHandleSelect(action, index)"
          />
          <div class="block-header" v-if="!isRichTextBlock(block)">
            <h3>{{ block.title || `${block.type === 'x6' ? '画板' : block.type} ${index + 1}` }}</h3>
            <div class="block-type-badge">{{ block.type }}</div>
          </div>

          <!-- 容器块 -->
          <template v-if="block.type === 'container' && block.children">
            <div class="container-block" :class="`container-${block.layout || 'vertical'}`">
              <VueDraggable
                v-model="block.children"
                :handle="blockDragHandle"
                :animation="200"
                ghost-class="dragging-ghost"
                chosen-class="dragging-chosen"
                drag-class="dragging-drag"
                @end="handleDragEnd"
                :direction="block.layout === 'horizontal' ? 'horizontal' : 'vertical'"
                :scroll="true"
                :scroll-sensitivity="30"
                :scroll-speed="10"
              >
                <div
                  v-for="(childBlock, childIndex) in block.children"
                  :key="childBlock.id"
                  class="container-item"
                  :style="{ width: childBlock.width || 'auto' }"
                >
                  <div
                    class="content-wrapper"
                    :class="{ 'content-wrapper--richtext': isRichTextBlock(childBlock) }"
                    :data-block-index="index * 100 + childIndex"
                    :data-block-id="childBlock.id"
                    :ref="(el) => { if(el) blockRefs[index * 100 + childIndex] = el as HTMLElement }"
                    @keydown="handleKeyDown($event, index * 100 + childIndex)"
                    @click="handleBlockClick($event, index * 100 + childIndex)"
                    :tabindex="editable ? 0 : -1"
                  >
                    <!-- 左侧悬浮手柄 -->
                    <HoverHandle
                      v-if="editable && !isRichTextBlock(childBlock)"
                      class="block-handle"
                      :style="blockHandleStyle"
                      :items="childBlockHandleItems"
                      :drag-cursor="true"
                      @select="(action) => handleBlockHandleSelect(action, index * 100 + childIndex)"
                    />
                    <div class="block-header" v-if="!isRichTextBlock(childBlock)">
                      <h3>{{ childBlock.title || `${childBlock.type === 'x6' ? '画板' : childBlock.type} ${childIndex + 1}` }}</h3>
                      <div class="block-type-badge">{{ childBlock.type }}</div>
                    </div>

                    <!-- 根据block类型动态渲染不同组件 -->
                    <template v-if="isRichTextBlock(childBlock)">
                      <RichTextEditor
                        :ref="(el: any) => setRichTextEditorRef(el, index * 100 + childIndex)"
                        :key="`richtext-${childBlock.id}`"
                        :content="childBlock.content || ''"
                        :editable="editable"
                        :auto-focus="childBlock.id === autoFocusBlockId"
                        @focused="autoFocusBlockId = null"
                        @content-change="(content: string) => { childBlock.content = content; emit('content-change', localBlocks); }"
                        @height-change="(height: number) => childBlock.blockHeight = height"
                        @extract-selection="(text: string) => handleExtractSelection(text, index * 100 + childIndex)"
                        @insert-block="() => insertBlock(index * 100 + childIndex + 1, createNewRichTextBlock())"
                        @line-insert="(payload: RichTextLineInsertPayload) => handleRichTextLineInsert(payload, index * 100 + childIndex)"
                        @delete-block="removeBlock(index * 100 + childIndex)"
                        @click="(event: MouseEvent) => handleRichTextEditorClick(event, index * 100 + childIndex)"
                        @lifecycle="(method: string) => handleRichTextEditorLifecycle(method, index * 100 + childIndex)"
                        class="block-content"
                      />
                    </template>
                    <Line
                      v-else-if="childBlock.type === 'line'"
                      :timelineData="childBlock.timelineData"
                      class="block-content board-content"
                    />
                    <X6Component
                      v-else-if="childBlock.type === 'x6'"
                      :graphData="childBlock.graphData"
                      :editable="editable"
                      @graph-data-change="(graphData: any) => { childBlock.graphData = graphData as GraphData; emit('content-change', localBlocks); }"
                      class="block-content board-content"
                    />
                    <template v-else-if="childBlock.type === 'ref' && childBlock.refId">
                      <div class="ref-block-wrap">
                        <div class="ref-block-badge">
                          🔗 引用自：{{ registryStore.getMeta(childBlock.refId)?.pageTitle ?? '未知页面' }}
                        </div>
                        <template v-if="registryStore.getBlock(childBlock.refId)?.type === 'x6'">
                          <X6Component
                            :key="`ref-x6-${childBlock.id}`"
                            :graphData="registryStore.getBlock(childBlock.refId)?.graphData"
                            :editable="editable"
                            @graph-data-change="(graphData: any) => registryStore.updateGraphData(childBlock.refId!, graphData as GraphData)"
                            class="block-content board-content"
                          />
                        </template>
                        <template v-else>
                          <RichTextEditor
                            :key="`ref-${childBlock.id}`"
                            :content="registryStore.getBlock(childBlock.refId)?.content ?? ''"
                            :editable="editable"
                            :line-handle-enabled="false"
                            @content-change="(c: string) => registryStore.updateContent(childBlock.refId!, c)"
                            class="block-content"
                          />
                        </template>
                      </div>
                    </template>
                    <div v-else class="block-content unknown-block">
                      <h3>未知的 block 类型: {{ childBlock.type }}</h3>
                      <div class="block-info">
                        <p><strong>ID:</strong> {{ childBlock.id }}</p>
                        <p><strong>Type:</strong> {{ childBlock.type }}</p>
                        <div class="block-properties">
                          <p v-for="(value, key) in getBlockProperties(childBlock)" :key="key">
                            <strong>{{ key }}:</strong> {{ value }}
                          </p>
                        </div>
                      </div>
                    </div>
                  </div>
                </div>
              </VueDraggable>
            </div>
          </template>
          <!-- 富文本块 -->
          <template v-else-if="isRichTextBlock(block)">
            <RichTextEditor
              :ref="(el: any) => setRichTextEditorRef(el, index)"
              :key="`richtext-${block.id}`"
              :content="block.content || ''"
              :editable="editable"
              :auto-focus="block.id === autoFocusBlockId"
              @focused="autoFocusBlockId = null"
              @content-change="(content: string) => { block.content = content; emit('content-change', localBlocks); }"
              @height-change="(height: number) => block.blockHeight = height"
              @extract-selection="(text: string) => handleExtractSelection(text, index)"
              @insert-block="() => insertBlock(index + 1, createNewRichTextBlock())"
              @line-insert="(payload: RichTextLineInsertPayload) => handleRichTextLineInsert(payload, index)"
              @delete-block="removeBlock(index)"
              @click="(event: MouseEvent) => handleRichTextEditorClick(event, index)"
              @lifecycle="(method: string) => handleRichTextEditorLifecycle(method, index)"
              class="block-content"
            />
          </template>
          <!-- 时间轴块 -->
          <Line
            v-else-if="block.type === 'line'"
            :timelineData="block.timelineData"
            class="block-content board-content"
          />
          <!-- X6图块 -->
          <X6Component
            v-else-if="block.type === 'x6'"
            :graphData="block.graphData"
            :editable="editable"
            @graph-data-change="(graphData: any) => { block.graphData = graphData as GraphData; emit('content-change', localBlocks); }"
            class="block-content board-content"
          />
          <!-- 引用块 -->
          <template v-else-if="block.type === 'ref' && block.refId">
            <div class="ref-block-wrap">
              <div class="ref-block-badge">
                🔗 引用自：{{ registryStore.getMeta(block.refId)?.pageTitle ?? '未知页面' }}
              </div>
              <template v-if="registryStore.getBlock(block.refId)?.type === 'x6'">
                <X6Component
                  :key="`ref-x6-${block.id}`"
                  :graphData="registryStore.getBlock(block.refId)?.graphData"
                  :editable="editable"
                  @graph-data-change="(graphData: any) => registryStore.updateGraphData(block.refId!, graphData as GraphData)"
                  class="block-content board-content"
                />
              </template>
              <template v-else>
                <RichTextEditor
                  :key="`ref-${block.id}`"
                  :content="registryStore.getBlock(block.refId)?.content ?? ''"
                  :editable="editable"
                  :line-handle-enabled="false"
                  @content-change="(c: string) => registryStore.updateContent(block.refId!, c)"
                  class="block-content"
                />
              </template>
            </div>
          </template>
          <!-- 未知类型块 -->
          <div v-else class="block-content unknown-block">
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
      </VueDraggable>
    </div>

    <!-- 引用块选择弹窗 -->
    <BlockPicker
      v-model:visible="showBlockPicker"
      @select="onRefBlockSelected"
    />

    <!-- Toast消息容器 -->
    <div class="toast-container">
      <Toast 
        v-for="toast in toastMessages" 
        :key="toast.id" 
        :message="toast.message"
        @close="removeToast(toast.id)"
      />
    </div>
  </div>
</template>

<style scoped>
.page-container {
  position: relative;
  min-height: 100%;
  display: flex;
  flex-direction: column;
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
  min-height: 100%;
  display: flex;
  flex-direction: column;
  flex: 1;
}

.blocks-list {
  display: flex;
  flex-direction: column;
  flex: 1;
  min-height: 100%;
}


.content-wrapper {
  --block-handle-gutter: 36px;
  --block-shell-pad-x: 20px;
  --block-shell-pad-y: 20px;
  margin-bottom: 8px;
  padding: var(--block-shell-pad-y) var(--block-shell-pad-x) var(--block-shell-pad-y) calc(var(--block-shell-pad-x) + var(--block-handle-gutter));
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

/* 富文本块不显示外边框 */
.content-wrapper--richtext {
  border: none;
  box-shadow: none;
  --block-content-pad-y: 10px;
  --block-content-pad-x: 15px;
  padding: 0;
}
.content-wrapper--richtext:hover {
  border: none;
  box-shadow: none;
}
.content-wrapper--richtext:focus {
  outline: none;
  box-shadow: none;
  border: none;
}
.content-wrapper--richtext:focus::before {
  display: none;
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
  overflow: visible;
  width: 100%;
  height: auto;
  min-height: 44px;
  margin: 0;
  padding: 0;
}

/* 特殊处理富文本块，使其高度根据内容自动调整 */
.content-wrapper .block-content {
  height: auto !important;
  min-height: 44px;
}

.block-content.board-content {
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



/* Toast容器样式 */
.toast-container {
  position: fixed;
  bottom: 20px;
  right: 20px;
  z-index: 10000;
  display: flex;
  flex-direction: column;
  gap: 10px;
  pointer-events: none;
}

.toast-container :deep(.toast-container) {
  position: relative;
  bottom: auto;
  right: auto;
  z-index: auto;
  display: block;
  pointer-events: auto;
}

/* 引用块样式 */
.ref-block-wrap {
  position: relative;
  border-left: 3px solid #1677ff;
  border-radius: 0 6px 6px 0;
  background: #f5f9ff;
  padding: 4px 0 4px 12px;
}

.ref-block-badge {
  font-size: 11px;
  color: #1677ff;
  margin-bottom: 4px;
  opacity: 0.75;
  user-select: none;
}

/* 左侧悬浮手柄样式 */
.block-handle {
  opacity: 0;
}

.block-handle--always {
  opacity: 1;
}

.content-wrapper:hover .block-handle {
  opacity: 1;
}

/* 富文本块的特殊处理 */

/* 拖拽相关样式 */
.dragging-ghost {
  opacity: 0.5;
  background: #f0f7ff;
  border: 2px dashed #1890ff;
}

.dragging-chosen {
  background: #e6f7ff;
}

.dragging-drag {
  opacity: 0.8;
  transform: rotate(2deg);
}

/* 拖拽占位符样式 */
.sortable-ghost {
  background: #f0f7ff !important;
  border: 2px dashed #1890ff !important;
  opacity: 0.6 !important;
  margin: 8px 0 !important;
  border-radius: 8px !important;
}

/* 容器块样式 */
.container-block {
  border: 2px solid #e0e0e0;
  border-radius: 8px;
  padding: 16px;
  margin: 8px 0;
  background: #fafafa;
}

.container-horizontal {
  display: flex;
  gap: 16px;
  flex-wrap: wrap;
}

.container-vertical {
  display: flex;
  flex-direction: column;
  gap: 16px;
}

.container-item {
  flex: 1;
  min-width: 200px;
}

/* 水平布局时的拖拽样式 */
.container-horizontal .sortable-ghost {
  margin: 0 8px !important;
  flex: 1;
  min-width: 200px;
}
</style>
