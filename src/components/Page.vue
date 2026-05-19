<script setup lang="ts">
import { ref, onMounted, onBeforeUnmount, watch, computed, nextTick } from 'vue';
import RichTextEditor from './RichTextEditor.vue';
import VditorRichEditor from './VditorRichEditor.vue';
import BlockActionHandle from './BlockActionHandle.vue';
import type { BlockActionHandleItem } from './BlockActionHandle.vue';
import BlockPicker from './BlockPicker.vue';
import BlockMetadataTagEditor from './BlockMetadataTagEditor.vue';
import Line from './line.vue';
import TableBlock from './TableBlock.vue';
import X6Component from './X6Component.vue';
import ReferencedBlockRenderer from './ReferencedBlockRenderer.vue';
import Toast from './Toast.vue';
import SelectionToolbar from './SelectionToolbar.vue';
import NoteEditor from './NoteEditor.vue';
import NotePopover from './NotePopover.vue';
import { ElMessageBox } from 'element-plus';
import { VueDraggable } from 'vue-draggable-plus';
import type { Block, BlockTag, GraphData, TextAnnotation } from '@/api/types';
import { getPageContent } from '@/api/page';
import { blockSyncManager } from '@/utils/blockSyncManager';
import { useBlockRegistryStore } from '@/stores/blockRegistry';
import { useWorkspaceStore } from '@/stores/workspace';
import { collectBlockTags, getBlockTags, setBlockTags } from '@/utils/blockMetadata';
import {
  canLoadGraphFromSource,
  canWriteGraphToSource,
  createGraphFromSource,
  createGraphSourceMetadata,
  readGraphSourceKind,
  type GraphSourceKind,
  type GraphSourceMetadata,
} from '@/utils/graphSources';
import { ensureExternalLinkResource } from '@/api/externalResource';

type LinkDisplayMode = 'link' | 'image';
type ReferenceTarget = { type: 'block' | 'page'; id: string };

interface Props {
  contentList: Block[];
  pageTitle?: string;
  editable?: boolean;
}

interface RichTextLineInsertPayload {
  beforeContent: string;
  afterContent: string;
  blockType: 'richtext' | 'line' | 'x6' | 'ref' | 'container' | 'table';
  layout?: 'horizontal' | 'vertical';
}

interface RichTextLineHandlePayload {
  visible: boolean;
  top: number | null;
  height: number | null;
  splitContent: {
    beforeContent: string;
    afterContent: string;
  } | null;
}

interface RichTextLineHandleState extends RichTextLineHandlePayload {
  menuVisible: boolean;
}

interface TagEditorState {
  visible: boolean;
  position: number;
  top: number;
  left: number;
}

interface TagEditorOpenRequest {
  top?: number;
  left?: number;
}

interface X6ExtractSelectionPayload {
  graphData: {
    cells?: Array<Record<string, unknown>>;
    nodes: Array<Record<string, unknown>>;
    edges: Array<Record<string, unknown>>;
  };
  count: number;
}

interface X6InsertRefRequestPayload {
  x: number;
  y: number;
}

interface TocItem {
  id: string;
  blockId: string;
  level: number;
  text: string;
}

type BlockPickerTypeFilter = 'all' | 'text' | 'x6';

const props = withDefaults(defineProps<Props>(), {
  pageTitle: '',
  editable: true
});

const emit = defineEmits<{
  (e: 'content-change', contentList: Block[]): void;
  (e: 'page-title-change', title: string): void;
}>();

const registryStore = useBlockRegistryStore();
const workspaceStore = useWorkspaceStore();
const blockDragHandle = '.block-handle .handle-dot';

// 本地列表：VueDraggable 使用 v-model 操作此 ref，避免直接 mutate prop
const localBlocks = ref<Block[]>([]);
const pageTitleDraft = ref('');
const referencedPageBlocks = ref<Record<string, Block[]>>({});
const referencedPageLoading = ref<Record<string, boolean>>({});
const referencedPageErrors = ref<Record<string, string>>({});

// 引用块弹窗状态
const showBlockPicker = ref(false);
const blockPickerInitialTypeFilter = ref<BlockPickerTypeFilter>('all');
const pendingRefInsertPosition = ref(-1);
const pendingRichTextSplitInsert = ref<{
  position: number;
  beforeContent: string;
  afterContent: string;
} | null>(null);
const pendingX6RefInsert = ref<{
  position: number;
  x: number;
  y: number;
} | null>(null);

const blockRefs = ref<HTMLElement[]>([]);
const highlightedBlockId = ref<string | null>(null);
type BlockResizeEdge = 'right' | 'bottom' | 'corner';

interface BlockResizeState {
  position: number;
  edge: BlockResizeEdge;
  startX: number;
  startY: number;
  startWidth: number;
  startHeight: number;
  maxWidth: number;
  widthMode: 'percent' | 'px';
}

interface ContainerItemMoveState {
  containerIndex: number;
  childIndex: number;
  startX: number;
  startY: number;
  startLeft: number;
  startTop: number;
}

/** 富文本编辑器实例（按块索引），用于提取时获取带格式的 Markdown */
const richTextEditorRefs = ref<Record<number, {
  getSelectionAsMarkdown?: () => string;
  focusEditor?: () => void;
  getMarkdownLinkAnchor?: () => { top: number; left: number } | undefined;
  insertMarkdownLink?: (label: string, url: string, display?: LinkDisplayMode) => void;
  updateInsertedLinkDisplay?: (display: LinkDisplayMode) => boolean;
  updateInsertedImageWidth?: (widthPercent: number) => boolean;
  handleLineHandleSelect?: (action: string) => void;
}>>({});
const markdownLinkCapableRefs = ref<Record<number, {
  getMarkdownLinkAnchor?: () => { top: number; left: number } | undefined;
  insertMarkdownLink?: (label: string, url: string, display?: LinkDisplayMode) => boolean | void;
  updateInsertedLinkDisplay?: (display: LinkDisplayMode) => boolean;
  updateInsertedImageWidth?: (widthPercent: number) => boolean;
}>>({});
const hasSelection = ref(false);
const selectedText = ref('');
const selectedBlockIndex = ref(-1);
const activeBlockIndex = ref(-1);
const richTextLineHandleStates = ref<Record<number, RichTextLineHandleState>>({});
const resizingBlock = ref<BlockResizeState | null>(null);
const movingContainerItem = ref<ContainerItemMoveState | null>(null);
const contentContainerRef = ref<HTMLElement | null>(null);
const linkPopoverUrlInputRef = ref<HTMLInputElement | null>(null);
const linkPopoverState = ref({
  visible: false,
  targetIndex: -1,
  top: 0,
  left: 0,
  label: '',
  url: '',
});
const insertedLinkToolbarState = ref({
  visible: false,
  targetIndex: -1,
  top: 0,
  left: 0,
  url: '',
  label: '',
  display: 'link' as LinkDisplayMode,
  canShowAsImage: false,
});
const blockHandleStyle = {
  '--hover-handle-left': 'calc(var(--block-handle-gutter, 36px) / 2)',
  '--hover-handle-top': 'calc(var(--block-shell-pad-y, 20px) + 6px)',
  '--hover-handle-transform': 'translateX(-50%)',
} as const;

const blockHandleItems: BlockActionHandleItem[] = [
  { key: 'insert-richtext', icon: '📝', label: '插入文本块' },
  { key: 'insert-ref', icon: '🔖', label: '插入引用块' },
  { key: 'insert-line', icon: '🕒', label: '插入时间轴' },
  { key: 'insert-x6', icon: '🧩', label: '插入画板' },
  { key: 'insert-kb-roadmap', icon: '🗺️', label: '生成知识库路线图' },
  { key: 'insert-table', icon: '▦', label: '插入表格' },
  { key: 'insert-container', icon: '📦', label: '插入容器' },
  { key: 'insert-task-panel', icon: '✅', label: '插入任务面板' },
  { key: 'edit-tags', icon: '🏷️', label: '编辑标签' },
  { key: 'divider-danger', divider: true },
  { key: 'delete', icon: '🗑️', label: '删除块', danger: true },
];

const MIN_BLOCK_WIDTH = 260;
const MIN_BLOCK_HEIGHT = 80;

const childBlockHandleItems: BlockActionHandleItem[] = [
  { key: 'insert-richtext', icon: '📝', label: '插入文本块' },
  { key: 'insert-ref', icon: '🔖', label: '插入引用块' },
  { key: 'insert-line', icon: '🕒', label: '插入时间轴' },
  { key: 'insert-x6', icon: '🧩', label: '插入画板' },
  { key: 'insert-table', icon: '▦', label: '插入表格' },
  { key: 'edit-tags', icon: '🏷️', label: '编辑标签' },
  { key: 'divider-danger', divider: true },
  { key: 'delete', icon: '🗑️', label: '删除块', danger: true },
];

const getBlockHandleItems = (block: Block | undefined): BlockActionHandleItem[] => {
  if (!isAutoReferenceUnit(block)) return blockHandleItems;
  const insertIndex = blockHandleItems.findIndex((item) => item.key === 'edit-tags');
  const splitItem: BlockActionHandleItem = { key: 'ungroup-auto-reference-unit', icon: '↕', label: '取消组合' };
  if (insertIndex < 0) return [splitItem, ...blockHandleItems];
  return [
    ...blockHandleItems.slice(0, insertIndex),
    splitItem,
    ...blockHandleItems.slice(insertIndex),
  ];
};

const richTextLineActionItems: BlockActionHandleItem[] = [
  { key: 'line-scope', label: '当前行', divider: true },
  { key: 'line-insert-richtext', icon: '📝', label: '在当前行后插入文本块' },
  { key: 'line-insert-ref', icon: '🔖', label: '在当前行后插入引用块' },
  { key: 'line-insert-line', icon: '🕒', label: '在当前行后插入时间轴' },
  { key: 'line-insert-x6', icon: '🧩', label: '在当前行后插入画板' },
  { key: 'line-insert-kb-roadmap', icon: '🗺️', label: '在当前行后生成知识库路线图' },
  { key: 'line-insert-table', icon: '▦', label: '在当前行后插入表格' },
  { key: 'line-insert-container', icon: '📦', label: '在当前行后插入容器' },
  { key: 'block-scope', label: '整个块', divider: true },
  ...blockHandleItems.map((item) => item.divider ? item : ({
    ...item,
    label: item.key === 'delete' ? '删除整个块' : item.label,
  })),
];
const richTextChildLineActionItems: BlockActionHandleItem[] = [
  { key: 'line-scope', label: '当前行', divider: true },
  { key: 'line-insert-richtext', icon: '📝', label: '在当前行后插入文本块' },
  { key: 'line-insert-ref', icon: '🔖', label: '在当前行后插入引用块' },
  { key: 'line-insert-line', icon: '🕒', label: '在当前行后插入时间轴' },
  { key: 'line-insert-x6', icon: '🧩', label: '在当前行后插入画板' },
  { key: 'line-insert-table', icon: '▦', label: '在当前行后插入表格' },
  { key: 'block-scope', label: '整个块', divider: true },
  ...childBlockHandleItems.map((item) => item.divider ? item : ({
    ...item,
    label: item.key === 'delete' ? '删除整个块' : item.label,
  })),
];
const tagEditorState = ref<TagEditorState>({
  visible: false,
  position: -1,
  top: 0,
  left: 0,
});
const availableTags = computed(() => collectBlockTags(localBlocks.value));
const activeEditorTags = computed(() => {
  if (tagEditorState.value.position < 0) return [];
  const block = getBlockAtPosition(tagEditorState.value.position);
  return block ? getBlockTagsForRender(block) : [];
});

const setRichTextEditorRef = (el: unknown, index: number) => {
  if (el) {
    richTextEditorRefs.value[index] = el as {
      getSelectionAsMarkdown?: () => string;
      focusEditor?: () => void;
      getMarkdownLinkAnchor?: () => { top: number; left: number } | undefined;
      insertMarkdownLink?: (label: string, url: string, display?: LinkDisplayMode) => void;
      updateInsertedLinkDisplay?: (display: LinkDisplayMode) => boolean;
      updateInsertedImageWidth?: (widthPercent: number) => boolean;
      handleLineHandleSelect?: (action: string) => void;
    };
  } else {
    delete richTextEditorRefs.value[index];
    delete richTextLineHandleStates.value[index];
  }
};

const setMarkdownLinkCapableRef = (el: unknown, index: number) => {
  if (el) {
    markdownLinkCapableRefs.value[index] = el as {
      getMarkdownLinkAnchor?: () => { top: number; left: number } | undefined;
      insertMarkdownLink?: (label: string, url: string, display?: LinkDisplayMode) => boolean | void;
      updateInsertedLinkDisplay?: (display: LinkDisplayMode) => boolean;
      updateInsertedImageWidth?: (widthPercent: number) => boolean;
    };
  } else {
    delete markdownLinkCapableRefs.value[index];
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

const findBlockIndexById = (blockId: string): number => {
  for (let index = 0; index < localBlocks.value.length; index += 1) {
    const block = localBlocks.value[index];
    if (block?.id === blockId) return index;
    if (block?.type === 'container' && block.children) {
      const childIndex = block.children.findIndex((child) => child.id === blockId);
      if (childIndex >= 0) {
        return index * 100 + childIndex;
      }
    }
  }
  return -1;
};

const scrollToBlockId = async (blockId: string) => {
  const index = findBlockIndexById(blockId);
  if (index < 0) return;
  await nextTick();
  const element = blockRefs.value[index];
  if (!element) return;
  highlightedBlockId.value = blockId;
  element.scrollIntoView({ behavior: 'smooth', block: 'center' });
  window.setTimeout(() => {
    if (highlightedBlockId.value === blockId) {
      highlightedBlockId.value = null;
    }
  }, 2200);
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

const updateBlockAtPosition = (position: number, updater: (block: Block) => Block) => {
  const targetBlock = getBlockAtPosition(position);
  if (!targetBlock) return;

  replaceBlockAtPosition(position, [updater(targetBlock)]);
};

const closeTagEditor = () => {
  tagEditorState.value = {
    visible: false,
    position: -1,
    top: 0,
    left: 0,
  };
};

const clampTagEditorPosition = (top: number, left: number) => {
  const panelWidth = 320;
  const panelHeight = 320;
  const viewportPadding = 12;

  return {
    top: Math.max(12, Math.min(top, window.innerHeight - panelHeight - viewportPadding)),
    left: Math.max(12, Math.min(left, window.innerWidth - panelWidth - viewportPadding)),
  };
};

const getTagEditorPosition = (position: number, request?: TagEditorOpenRequest) => {
  if (typeof request?.top === 'number' && typeof request?.left === 'number') {
    return clampTagEditorPosition(request.top, request.left);
  }

  const blockElement = blockRefs.value[position];
  if (!blockElement) {
    return clampTagEditorPosition(window.innerHeight / 2 - 140, window.innerWidth / 2 - 160);
  }

  const rect = blockElement.getBoundingClientRect();
  const desiredTop = rect.top + 12;
  const desiredLeft = rect.right + 12;
  return clampTagEditorPosition(desiredTop, desiredLeft);
};

const openTagEditor = (position: number, request?: TagEditorOpenRequest) => {
  const targetBlock = getBlockAtPosition(position);
  if (!targetBlock) return;

  const coords = getTagEditorPosition(position, request);
  tagEditorState.value = {
    visible: true,
    position,
    top: coords.top,
    left: coords.left,
  };
};

const handleTagEditorRequest = (position: number, request?: TagEditorOpenRequest) => {
  openTagEditor(position, request);
};

const updateBlockTags = (position: number, tags: BlockTag[]) => {
  updateBlockAtPosition(position, (block) => setBlockTags(block, tags));
};

const getBlockTagsForRender = (block: Block): BlockTag[] => getBlockTags(block);

const getRichTextLineHandleState = (position: number): RichTextLineHandleState | undefined => {
  const state = richTextLineHandleStates.value[position];
  if (!state?.visible || state.top == null) return undefined;
  return state;
};

const hasRichTextLineHandle = (position: number): boolean => Boolean(getRichTextLineHandleState(position));

const getActionHandleStyle = (position: number) => {
  const lineState = getRichTextLineHandleState(position);
  if (lineState) {
    return {
      '--hover-handle-left': 'calc(var(--block-handle-gutter, 36px) / 2)',
      '--hover-handle-top': `${lineState.top}px`,
      '--hover-handle-height': `${Math.max(1, lineState.height ?? 28)}px`,
      '--hover-handle-transform': 'translateX(-50%)',
    } as const;
  }

  return blockHandleStyle;
};

const getActionHandleItems = (position: number, isChild = false): BlockActionHandleItem[] => {
  if (hasRichTextLineHandle(position)) {
    return isChild ? richTextChildLineActionItems : richTextLineActionItems;
  }
  return isChild ? childBlockHandleItems : getBlockHandleItems(getBlockAtPosition(position));
};

const updateRichTextLineHandleState = (position: number, payload: RichTextLineHandlePayload) => {
  richTextLineHandleStates.value[position] = {
    ...payload,
    menuVisible: richTextLineHandleStates.value[position]?.menuVisible ?? false,
  };
};

const updateRichTextLineMenuVisibility = (position: number, visible: boolean) => {
  const current = richTextLineHandleStates.value[position] ?? {
    visible: false,
    top: null,
    height: null,
    splitContent: null,
    menuVisible: false,
  };
  richTextLineHandleStates.value[position] = {
    ...current,
    menuVisible: visible,
  };
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

const createX6BlockFromGraphData = (
  graphData: GraphData,
  title = '提取的蓝图片段（蓝图）',
  metadata?: GraphSourceMetadata,
): Block => {
  return {
    id: generateId(),
    type: 'x6',
    title,
    ...(metadata ? { metadata } : {}),
    graphData,
  };
};

const createKnowledgeRoadmapBlock = (): Block | null => {
  if (!workspaceStore.pageTree.length) {
    showToast('当前知识库没有页面，无法生成路线图');
    return null;
  }

  return {
    id: generateId(),
    type: 'x6',
    title: '知识库路线图',
    metadata: {
      ...createGraphSourceMetadata('knowledge-base-pages', {
        sourceId: workspaceStore.currentKbId,
        syncMode: 'bidirectional',
      }),
    },
    graphData: createGraphFromSource('knowledge-base-pages', workspaceStore.pageTree),
  };
};

const getGraphSourceKindForBlock = (block: Block): GraphSourceKind | null => {
  return block.type === 'x6' ? readGraphSourceKind(block.metadata) : null;
};

const getX6GraphDataForRender = (block: Block): GraphData | undefined => {
  if (getGraphSourceKindForBlock(block) === 'knowledge-base-pages') {
    return createGraphFromSource('knowledge-base-pages', workspaceStore.pageTree);
  }
  return block.graphData;
};

const updateX6GraphDataFromEditor = (block: Block, graphData: GraphData) => {
  if (canLoadGraphFromSource(block.metadata)) return;
  block.graphData = graphData;
  emit('content-change', localBlocks.value);
};

const syncGraphBlockFromSource = (block: Block) => {
  const sourceKind = getGraphSourceKindForBlock(block);
  if (sourceKind !== 'knowledge-base-pages' || !canLoadGraphFromSource(block.metadata)) return;
  block.graphData = createGraphFromSource(sourceKind, workspaceStore.pageTree);
  emit('content-change', localBlocks.value);
  showToast('已从知识库结构同步路线图');
};

const syncGraphBlockToSource = async (block: Block, graphData: GraphData) => {
  const sourceKind = getGraphSourceKindForBlock(block);
  if (sourceKind !== 'knowledge-base-pages' || !canWriteGraphToSource(block.metadata)) return;
  try {
    const result = await workspaceStore.syncKnowledgeRoadmapToSource(graphData);
    block.graphData = createGraphFromSource(sourceKind, workspaceStore.pageTree);
    emit('content-change', localBlocks.value);
    const warningText = result.warnings.length ? `，${result.warnings.join('；')}` : '';
    showToast(`已同步至知识库结构，影响 ${result.changedCount} 个节点${warningText}`);
  } catch (error) {
    showToast(error instanceof Error ? error.message : '同步至源失败');
  }
};

const createTaskFlowGraphData = (): GraphData => {
  const now = Date.now();
  const startId = `task-start-${now}`;
  const taskAId = `task-node-${now}-a`;
  const taskBId = `task-node-${now}-b`;
  const finishId = `task-finish-${now}`;

  return {
    nodes: [
      {
        id: startId,
        x: 120,
        y: 180,
        width: 140,
        height: 64,
        shape: 'ellipse',
        label: '开始',
        data: {
          preset: 'ellipse',
          taskRole: 'start',
          taskStatus: 'ready',
        },
      },
      {
        id: taskAId,
        x: 360,
        y: 168,
        width: 188,
        height: 78,
        shape: 'rect',
        label: '梳理需求',
        data: {
          preset: 'round',
          taskRole: 'task',
          taskStatus: 'todo',
          taskDescription: '确认目标、范围和依赖',
        },
      },
      {
        id: taskBId,
        x: 650,
        y: 168,
        width: 188,
        height: 78,
        shape: 'rect',
        label: '实现核心流程',
        data: {
          preset: 'round',
          taskRole: 'task',
          taskStatus: 'todo',
          taskDescription: '完成主要功能并自测',
        },
      },
      {
        id: finishId,
        x: 930,
        y: 180,
        width: 140,
        height: 64,
        shape: 'ellipse',
        label: '完成',
        data: {
          preset: 'ellipse',
          taskRole: 'finish',
          taskStatus: 'ready',
        },
      },
    ],
    edges: [
      { id: `task-edge-${now}-1`, source: startId, target: taskAId },
      { id: `task-edge-${now}-2`, source: taskAId, target: taskBId },
      { id: `task-edge-${now}-3`, source: taskBId, target: finishId },
    ],
    blueprintMeta: {
      anchor: { x: 560, y: 240 },
      kind: 'task-flow',
    },
  };
};

const createNewTableBlock = (): Block => ({
  id: generateId(),
  type: 'table',
  title: '新的表格',
  tableData: {
    textMode: 'plain',
    headers: ['列 1', '列 2', '列 3'],
    rows: [
      ['', '', ''],
      ['', '', ''],
    ],
  },
});

// 创建新的自由布局容器块
const createNewContainerBlock = (position: number): Block => {
  return {
    id: generateId(),
    type: 'container',
    title: '新的容器',
    layout: 'free',
    blockHeight: 360,
    children: [
      {
        ...createNewRichTextBlock(),
        containerPosition: { x: 24, y: 24, z: 1 },
        width: '320px',
      },
    ],
  };
};

const createContainerRichTextBlock = (
  content: string,
  x: number,
  y: number,
  width = '300px',
  z = 1,
): Block => ({
  ...createRichTextBlockWithContent(content),
  width,
  containerPosition: { x, y, z },
});

const createTaskPanelContainerBlock = (): Block => ({
  id: generateId(),
  type: 'x6',
  title: '任务面板',
  blockHeight: 620,
  graphData: createTaskFlowGraphData(),
});

// 创建引用块
const createRefBlock = (refId: string, refType: 'block' | 'page' = 'block'): Block => ({
  id: generateId(),
  type: 'ref',
  refId,
  refType,
});

const truncateText = (value: string, maxLength = 24): string => {
  const normalized = value.replace(/\s+/g, ' ').trim();
  if (!normalized) return '';
  return normalized.length > maxLength ? `${normalized.slice(0, maxLength)}…` : normalized;
};

const findPageInTree = (pageId: string) => {
  const walk = (nodes: typeof workspaceStore.pageTree): { id: string; title: string } | undefined => {
    for (const page of nodes) {
      if (page.id === pageId) return page;
      const found = walk(page.children ?? []);
      if (found) return found;
    }
    return undefined;
  };

  return walk(workspaceStore.pageTree);
};

const getPageRefTitle = (pageId: string): string => findPageInTree(pageId)?.title ?? '未知页面';

const openReferencedPage = async (pageId: string) => {
  await workspaceStore.selectPage(pageId);
};

const ensureReferencedPageLoaded = async (pageId: string) => {
  if (!pageId || referencedPageBlocks.value[pageId] || referencedPageLoading.value[pageId]) return;

  referencedPageLoading.value = {
    ...referencedPageLoading.value,
    [pageId]: true,
  };
  referencedPageErrors.value = {
    ...referencedPageErrors.value,
    [pageId]: '',
  };

  try {
    const blocks = await getPageContent(pageId);
    referencedPageBlocks.value = {
      ...referencedPageBlocks.value,
      [pageId]: blocks,
    };
    registryStore.registerBlocks(blocks, pageId, getPageRefTitle(pageId));
  } catch (error) {
    referencedPageErrors.value = {
      ...referencedPageErrors.value,
      [pageId]: error instanceof Error ? error.message : '页面内容加载失败',
    };
  } finally {
    referencedPageLoading.value = {
      ...referencedPageLoading.value,
      [pageId]: false,
    };
  }
};

const renderReferencedBlockText = (block: Block): string => {
  if (block.type === 'x6') return block.title?.trim() || '画板';
  if (block.type === 'table') return block.title?.trim() || '表格';
  if (block.type === 'line') return block.title?.trim() || '时间轴';
  if (block.type === 'container') return block.title?.trim() || '容器';
  return block.content ?? '';
};

const updateReferencedBlock = (blockId: string | undefined, block: Block) => {
  if (!blockId) return;
  void registryStore.updateBlock(blockId, block).catch((error) => {
    console.error('更新引用块失败:', error);
    showToast('引用块更新失败');
  });
};

const getRefPreviewText = (refId: string): string => {
  const sourceBlock = registryStore.getBlock(refId);
  const meta = registryStore.getMeta(refId);

  if (!sourceBlock) {
    return '🔗 引用块';
  }

  if (sourceBlock.type === 'x6') {
    return `🔗 引用画板\n${truncateText(meta?.pageTitle ?? '未命名页面', 18)}`;
  }

  const contentPreview = truncateText(sourceBlock.content ?? '', 28);
  return contentPreview
    ? `🔗 ${contentPreview}`
    : `🔗 ${truncateText(meta?.pageTitle ?? '引用块', 18)}`;
};

const cloneGraphPayload = <T>(value: T): T => JSON.parse(JSON.stringify(value)) as T;

const asGraphObject = (value: unknown): Record<string, unknown> | null => {
  return typeof value === 'object' && value ? value as Record<string, unknown> : null;
};

const getGraphNodePosition = (node: GraphData['nodes'][number]) => ({
  x: typeof asGraphObject(node.position)?.x === 'number'
    ? asGraphObject(node.position)!.x as number
    : typeof node.x === 'number'
      ? node.x
      : typeof node.style?.x === 'number'
        ? node.style.x
        : 0,
  y: typeof asGraphObject(node.position)?.y === 'number'
    ? asGraphObject(node.position)!.y as number
    : typeof node.y === 'number'
      ? node.y
      : typeof node.style?.y === 'number'
        ? node.style.y
        : 0,
});

const getGraphNodeSize = (node: GraphData['nodes'][number]) => ({
  width: typeof asGraphObject(node.size)?.width === 'number'
    ? asGraphObject(node.size)!.width as number
    : typeof node.width === 'number'
      ? node.width
      : 0,
  height: typeof asGraphObject(node.size)?.height === 'number'
    ? asGraphObject(node.size)!.height as number
    : typeof node.height === 'number'
      ? node.height
      : 0,
});

const getGraphDataBounds = (graphData: GraphData) => {
  const points: Array<{ x: number; y: number }> = [];

  const collectPoint = (x: unknown, y: unknown) => {
    if (typeof x === 'number' && typeof y === 'number') {
      points.push({ x, y });
    }
  };

  const sourceCells = Array.isArray(graphData.cells)
    ? graphData.cells
    : [...(graphData.nodes ?? []), ...(graphData.edges ?? [])];

  sourceCells.forEach((cell) => {
    if (typeof cell !== 'object' || !cell) return;
    const graphCell = cell as Record<string, unknown>;

    collectPoint(graphCell.x, graphCell.y);

    const position = asGraphObject(graphCell.position);
    if (position) {
      collectPoint(position.x, position.y);
    }

    const style = graphCell.style;
    if (typeof style === 'object' && style) {
      collectPoint((style as { x?: unknown }).x, (style as { y?: unknown }).y);
    }

    const size = asGraphObject(graphCell.size);
    const width = typeof size?.width === 'number' ? size.width : graphCell.width;
    const height = typeof size?.height === 'number' ? size.height : graphCell.height;
    const x = typeof position?.x === 'number' ? position.x : graphCell.x;
    const y = typeof position?.y === 'number' ? position.y : graphCell.y;
    if (typeof x === 'number' && typeof y === 'number' && typeof width === 'number' && typeof height === 'number') {
      collectPoint(x + width, y + height);
    }

    const vertices = graphCell.vertices;
    if (Array.isArray(vertices)) {
      vertices.forEach((vertex) => {
        if (typeof vertex !== 'object' || !vertex) return;
        collectPoint((vertex as { x?: unknown }).x, (vertex as { y?: unknown }).y);
      });
    }

    const source = graphCell.source;
    const target = graphCell.target;
    [source, target].forEach((terminal) => {
      if (typeof terminal !== 'object' || !terminal || typeof (terminal as { cell?: unknown }).cell === 'string') return;
      collectPoint((terminal as { x?: unknown }).x, (terminal as { y?: unknown }).y);
    });
  });

  if (!points.length) return null;

  return {
    minX: Math.min(...points.map((point) => point.x)),
    minY: Math.min(...points.map((point) => point.y)),
    maxX: Math.max(...points.map((point) => point.x)),
    maxY: Math.max(...points.map((point) => point.y)),
  };
};

const offsetGraphCellPosition = (cell: Record<string, unknown>, offsetX: number, offsetY: number) => {
  const nextCell = cloneGraphPayload(cell);
  const position = asGraphObject(nextCell.position);
  const style =
    typeof nextCell.style === 'object' && nextCell.style
      ? (nextCell.style as Record<string, unknown> & { x?: number; y?: number })
      : null;

  if (typeof nextCell.x === 'number') {
    nextCell.x += offsetX;
  }
  if (typeof position?.x === 'number' || typeof position?.y === 'number') {
    nextCell.position = {
      ...position,
      ...(typeof position.x === 'number' ? { x: position.x + offsetX } : {}),
      ...(typeof position.y === 'number' ? { y: position.y + offsetY } : {}),
    };
  }
  if (typeof style?.x === 'number') {
    nextCell.style = {
      ...style,
      x: style.x + offsetX,
    };
  }

  if (typeof nextCell.y === 'number') {
    nextCell.y += offsetY;
  }
  if (typeof style?.y === 'number') {
    nextCell.style = {
      ...style,
      y: style.y + offsetY,
    };
  }

  if (Array.isArray(nextCell.vertices)) {
    nextCell.vertices = nextCell.vertices.map((vertex) => {
      if (typeof vertex !== 'object' || !vertex) return vertex;
      return {
        ...vertex,
        ...(typeof vertex.x === 'number' ? { x: vertex.x + offsetX } : {}),
        ...(typeof vertex.y === 'number' ? { y: vertex.y + offsetY } : {}),
      };
    });
  }

  const translateTerminal = (terminal: unknown) => {
    if (typeof terminal !== 'object' || !terminal) return terminal;
    if (typeof (terminal as { cell?: unknown }).cell === 'string') return terminal;

    return {
      ...terminal,
      ...(typeof (terminal as { x?: unknown }).x === 'number' ? { x: (terminal as { x: number }).x + offsetX } : {}),
      ...(typeof (terminal as { y?: unknown }).y === 'number' ? { y: (terminal as { y: number }).y + offsetY } : {}),
    };
  };

  if ('source' in nextCell) {
    nextCell.source = translateTerminal(nextCell.source);
  }

  if ('target' in nextCell) {
    nextCell.target = translateTerminal(nextCell.target);
  }

  return nextCell;
};

const remapGraphTerminal = (
  terminal: string | Record<string, unknown>,
  nodeIdMap: Map<string, string>,
) => {
  if (typeof terminal === 'string') {
    return nodeIdMap.get(terminal) ?? terminal;
  }

  const nextTerminal = cloneGraphPayload(terminal);
  if (typeof nextTerminal.cell === 'string') {
    nextTerminal.cell = nodeIdMap.get(nextTerminal.cell) ?? nextTerminal.cell;
  }
  return nextTerminal;
};

const mergeReferencedGraphData = (
  targetGraphData: GraphData | undefined,
  sourceGraphData: GraphData,
  refId: string,
  x: number,
  y: number,
): GraphData => {
  const sourceNodes = Array.isArray(sourceGraphData.nodes) ? sourceGraphData.nodes : [];
  const sourceEdges = Array.isArray(sourceGraphData.edges) ? sourceGraphData.edges : [];

  if (sourceNodes.length === 0) {
    return appendNodeToGraphData(targetGraphData, createX6RefNode(refId, x, y));
  }

  const nodePositions = sourceNodes.map((node) => {
    const position = getGraphNodePosition(node);
    const size = getGraphNodeSize(node);
    return {
      x: position.x,
      y: position.y,
      width: size.width,
      height: size.height,
    };
  });

  const blueprintAnchor = sourceGraphData.blueprintMeta?.anchor;
  const graphBounds = getGraphDataBounds(sourceGraphData);
  const anchorX = blueprintAnchor?.x ?? graphBounds?.minX ?? Math.min(...nodePositions.map((item) => item.x));
  const anchorY = blueprintAnchor?.y ?? graphBounds?.minY ?? Math.min(...nodePositions.map((item) => item.y));
  const offsetX = x - anchorX;
  const offsetY = y - anchorY;

  const nodeIdMap = new Map<string, string>();
  const nextNodes = sourceNodes.map((node) => {
    const nextNode = offsetGraphCellPosition(node, offsetX, offsetY) as GraphData['nodes'][number];
    const nextId = generateId();
    nodeIdMap.set(node.id, nextId);
    nextNode.id = nextId;

    nextNode.data = {
      ...(nextNode.data ?? {}),
      refBlockId: refId,
      refSourceCellId: node.id,
      refKind: 'graph-selection',
    };

    return nextNode;
  });

  const nextEdges = sourceEdges.map((edge) => {
    const nextEdge = offsetGraphCellPosition(edge, offsetX, offsetY) as GraphData['edges'][number];
    nextEdge.id = generateId();
    nextEdge.source = remapGraphTerminal(nextEdge.source, nodeIdMap);
    nextEdge.target = remapGraphTerminal(nextEdge.target, nodeIdMap);
    nextEdge.data = {
      ...(nextEdge.data ?? {}),
      refBlockId: refId,
      refSourceCellId: edge.id,
      refKind: 'graph-selection',
    };
    return nextEdge;
  });

  return {
    ...(targetGraphData ?? {}),
    nodes: [...(targetGraphData?.nodes ?? []), ...nextNodes],
    edges: [...(targetGraphData?.edges ?? []), ...nextEdges],
    cells: [
      ...(targetGraphData?.cells ?? [
        ...(targetGraphData?.nodes ?? []),
        ...(targetGraphData?.edges ?? []),
      ]),
      ...nextNodes,
      ...nextEdges,
    ],
  };
};

const createX6RefNode = (refId: string, x: number, y: number): GraphData['nodes'][number] => ({
  id: generateId(),
  shape: 'rect',
  x,
  y,
  width: 220,
  height: 72,
  attrs: {
    body: {
      fill: '#f5f9ff',
      stroke: '#1677ff',
      strokeWidth: 1.6,
      rx: 14,
      ry: 14,
    },
    label: {
      text: getRefPreviewText(refId),
      fill: '#0958d9',
      fontSize: 13,
      fontWeight: 600,
    },
  },
  data: {
    preset: 'round',
    refBlockId: refId,
    refKind: 'block',
  },
});

const appendNodeToGraphData = (graphData: GraphData | undefined, node: GraphData['nodes'][number]): GraphData => {
  const nodes = Array.isArray(graphData?.nodes) ? [...graphData!.nodes] : [];
  const edges = Array.isArray(graphData?.edges) ? [...graphData!.edges] : [];
  const cells = Array.isArray(graphData?.cells) ? [...graphData!.cells] : [...nodes, ...edges];

  nodes.push(node);
  cells.push(node);

  return {
    ...(graphData ?? {}),
    nodes,
    edges,
    cells,
  };
};

// 打开引用块选择弹窗（记录插入位置）
const openBlockPicker = (position: number) => {
  blockPickerInitialTypeFilter.value = 'all';
  pendingRefInsertPosition.value = position;
  pendingRichTextSplitInsert.value = null;
  pendingX6RefInsert.value = null;
  showBlockPicker.value = true;
};

const requestX6RefInsert = (position: number, payload: X6InsertRefRequestPayload) => {
  blockPickerInitialTypeFilter.value = 'x6';
  pendingRefInsertPosition.value = -1;
  pendingRichTextSplitInsert.value = null;
  pendingX6RefInsert.value = {
    position,
    x: payload.x,
    y: payload.y,
  };
  showBlockPicker.value = true;
};

// 选中引用源后插入 ref 块
const onRefBlockSelected = (target: ReferenceTarget) => {
  const refId = target.id;
  if (pendingX6RefInsert.value) {
    if (target.type !== 'block') return;
    const { position, x, y } = pendingX6RefInsert.value;
    const sourceBlock = registryStore.getBlock(refId);
    updateBlockAtPosition(position, (block) => {
      if (block.type !== 'x6') return block;
      return {
        ...block,
        graphData: sourceBlock?.type === 'x6' && sourceBlock.graphData
          ? mergeReferencedGraphData(block.graphData, sourceBlock.graphData, refId, x, y)
          : appendNodeToGraphData(block.graphData, createX6RefNode(refId, x, y)),
      };
    });
    pendingX6RefInsert.value = null;
    pendingRefInsertPosition.value = -1;
    pendingRichTextSplitInsert.value = null;
    return;
  }

  const position = pendingRefInsertPosition.value;
  if (position >= 0) {
    const refBlock = createRefBlock(refId, target.type);
    if (pendingRichTextSplitInsert.value) {
      const { beforeContent, afterContent } = pendingRichTextSplitInsert.value;
      const blocksToInsert = buildSplitReplacementBlocks(beforeContent, refBlock, afterContent);

      // Auto-focus trailing richtext block when cursor was at the end
      if (!hasMeaningfulRichTextContent(afterContent)) {
        const trailing = blocksToInsert[blocksToInsert.length - 1];
        if (isRichTextBlock(trailing)) {
          autoFocusBlockId.value = trailing.id;
        }
      }

      replaceBlockAtPosition(position, blocksToInsert);
    } else {
      insertBlock(position, refBlock);
    }
  }
  pendingRefInsertPosition.value = -1;
  pendingRichTextSplitInsert.value = null;
  pendingX6RefInsert.value = null;
};

// 统一富文本类型为 'richtext'，避免 'richText' 导致未知类型显示
const normalizeBlockType = (block: Block): Block => {
  const normalizedChildren = block.children?.map((child) => normalizeBlockType(child));
  const childrenChanged = normalizedChildren?.some((child, index) => child !== block.children?.[index]) ?? false;
  const withNormalizedChildren = normalizedChildren && childrenChanged ? { ...block, children: normalizedChildren } : block;

  if (block.type === 'richText') {
    return { ...withNormalizedChildren, type: 'richtext' };
  }
  if (block.type === 'graph') {
    return {
      ...withNormalizedChildren,
      type: 'x6',
      title: block.title || '画板',
    };
  }
  return withNormalizedChildren;
};

// 判断是否为富文本块（统一用此方法，避免大小写/驼峰混用导致误判）
const isRichTextBlock = (block: Block): boolean => {
  return block != null && (block.type === 'richtext' || block.type === 'richText');
};

const shouldShowDocumentTailInsert = computed(() => {
  const lastBlock = localBlocks.value[localBlocks.value.length - 1];
  return !isRichTextBlock(lastBlock);
});

const extractMarkdownHeadings = (content: string, blockId: string): TocItem[] => {
  const items: TocItem[] = [];
  const lines = content.replace(/\r\n/g, '\n').split('\n');
  let inCodeFence = false;

  lines.forEach((line, index) => {
    if (/^\s*```/.test(line)) {
      inCodeFence = !inCodeFence;
      return;
    }
    if (inCodeFence) return;

    const match = line.match(/^\s*(#{1,6})\s+(.+?)\s*#*\s*$/);
    if (!match) return;

    const text = match[2]?.trim();
    if (!text) return;

    items.push({
      id: `${blockId}-${index}-${match[1].length}`,
      blockId,
      level: match[1].length,
      text,
    });
  });

  return items;
};

const collectTocItems = (blocks: Block[]): TocItem[] => {
  const items: TocItem[] = [];

  blocks.forEach((block) => {
    if (isRichTextBlock(block) && typeof block.content === 'string' && block.content.trim()) {
      items.push(...extractMarkdownHeadings(block.content, block.id));
    }
    if (block.type === 'container' && Array.isArray(block.children) && block.children.length > 0) {
      items.push(...collectTocItems(block.children));
    }
  });

  return items;
};

const isEmptyRichTextBlock = (block: Block | undefined): boolean => {
  if (!block || !isRichTextBlock(block)) return false;
  const hasTitle = Boolean(block.title?.trim());
  const hasContent = Boolean(block.content?.trim());
  const hasTags = getBlockTags(block).length > 0;
  return !hasTitle && !hasContent && !hasTags;
};

const tocItems = computed(() => collectTocItems(localBlocks.value));
const tocExpanded = ref(true);

const handleTocItemClick = (item: TocItem) => {
  void scrollToBlockId(item.blockId);
};

const isEditableTitleBlock = (block: Block): boolean => {
  return block.type === 'x6' || block.type === 'table';
};

const getBlockDisplayTitle = (block: Block, index: number): string => {
  if (block.title) return block.title;
  if (block.type === 'x6') return '画板';
  if (block.type === 'table') return '表格';
  return `${block.type} ${index + 1}`;
};

const updateBlockTitle = (block: Block, title: string) => {
  block.title = title;
  emit('content-change', localBlocks.value);
};

const commitPageTitle = () => {
  if (!props.editable) return;
  const nextTitle = pageTitleDraft.value.trim() || '未命名页面';
  pageTitleDraft.value = nextTitle;
  if (nextTitle !== props.pageTitle) {
    emit('page-title-change', nextTitle);
  }
};

const handlePageTitleKeydown = (event: KeyboardEvent) => {
  if (event.key !== 'Enter') return;
  event.preventDefault();
  commitPageTitle();
  insertBlock(0, createNewRichTextBlock());
  activeBlockIndex.value = 0;
  nextTick(() => {
    richTextEditorRefs.value[0]?.focusEditor?.();
  });
};

const normalizeBlockWidth = (value: unknown): string | undefined => {
  if (typeof value === 'number' && Number.isFinite(value)) {
    return `${Math.max(MIN_BLOCK_WIDTH, value)}px`;
  }
  if (typeof value !== 'string') return undefined;

  const trimmed = value.trim();
  if (!trimmed || trimmed === 'auto') return undefined;
  if (/^\d+(\.\d+)?%$/.test(trimmed)) {
    const percent = Math.max(20, Math.min(100, Number.parseFloat(trimmed)));
    return `${percent.toFixed(2).replace(/\.00$/, '')}%`;
  }
  if (/^\d+(\.\d+)?px$/.test(trimmed)) {
    const pixels = Math.max(MIN_BLOCK_WIDTH, Number.parseFloat(trimmed));
    return `${Math.round(pixels)}px`;
  }

  return undefined;
};

const getBlockLayoutStyle = (block: Block) => ({
  flexBasis: normalizeBlockWidth(block.width) || '100%',
  minHeight: typeof block.blockHeight === 'number' ? `${Math.max(MIN_BLOCK_HEIGHT, block.blockHeight)}px` : undefined,
});

const ensureContainerChildPosition = (block: Block, index: number): NonNullable<Block['containerPosition']> => {
  if (!block.containerPosition) {
    block.containerPosition = {
      x: 24 + (index % 3) * 36,
      y: 24 + Math.floor(index / 3) * 36,
      z: index + 1,
    };
  }

  return block.containerPosition;
};

const getContainerItemStyle = (block: Block, index = 0) => {
  const position = ensureContainerChildPosition(block, index);
  return {
    left: `${Math.max(0, position.x)}px`,
    top: `${Math.max(0, position.y)}px`,
    zIndex: position.z ?? index + 1,
    width: normalizeBlockWidth(block.width) || '320px',
    minHeight: typeof block.blockHeight === 'number' ? `${Math.max(MIN_BLOCK_HEIGHT, block.blockHeight)}px` : undefined,
  };
};

const isContainerChildPosition = (position: number): boolean => position >= 100;

const getResizeWidthContext = (position: number, blockElement: HTMLElement) => {
  if (isContainerChildPosition(position)) {
    const canvasElement = blockElement.closest('.container-canvas') as HTMLElement | null;
    const canvasWidth = canvasElement?.getBoundingClientRect().width ?? blockElement.getBoundingClientRect().width;
    return {
      maxWidth: Math.max(MIN_BLOCK_WIDTH, canvasWidth),
      widthMode: 'px' as const,
    };
  }

  const parentElement = blockElement.parentElement;
  const parentWidth = parentElement?.getBoundingClientRect().width ?? blockElement.getBoundingClientRect().width;
  return {
    maxWidth: Math.max(MIN_BLOCK_WIDTH, parentWidth),
    widthMode: 'percent' as const,
  };
};

const getContainerCanvasStyle = (block: Block) => {
  if (block.layout === 'vertical') {
    return {};
  }
  return { minHeight: `${Math.max(260, block.blockHeight ?? 360)}px` };
};

const normalizeContainerChildren = (container: Block) => {
  container.children = container.children ?? [];
  if (container.layout === 'vertical') {
    container.children.forEach((child) => {
      delete child.containerPosition;
      delete child.width;
    });
    return;
  }
  container.children.forEach((child, childIndex) => {
    ensureContainerChildPosition(child, childIndex);
    child.width = normalizeBlockWidth(child.width) || child.width || '320px';
  });
};

const commitBlockResize = (position: number, widthPx?: number, heightPx?: number) => {
  const block = getBlockAtPosition(position);
  if (!block || !resizingBlock.value) return;

  const updates: Partial<Block> = {};
  if (typeof widthPx === 'number') {
    const maxWidth = resizingBlock.value.maxWidth;
    const width = Math.max(MIN_BLOCK_WIDTH, Math.min(maxWidth, widthPx));
    if (resizingBlock.value.widthMode === 'px') {
      updates.width = `${Math.round(width)}px`;
    } else {
      const percent = Math.max(20, Math.min(100, (width / maxWidth) * 100));
      updates.width = `${percent.toFixed(2)}%`;
    }
  }
  if (typeof heightPx === 'number') {
    updates.blockHeight = Math.max(MIN_BLOCK_HEIGHT, Math.round(heightPx));
  }

  updateBlockAtPosition(position, (source) => ({ ...source, ...updates }));
};

const startBlockResize = (event: MouseEvent, position: number, edge: BlockResizeEdge) => {
  if (!props.editable) return;

  const blockElement = blockRefs.value[position];
  if (!blockElement) return;

  event.preventDefault();
  event.stopPropagation();
  activeBlockIndex.value = position;

  const rect = blockElement.getBoundingClientRect();
  const widthContext = getResizeWidthContext(position, blockElement);
  resizingBlock.value = {
    position,
    edge,
    startX: event.clientX,
    startY: event.clientY,
    startWidth: rect.width,
    startHeight: rect.height,
    maxWidth: widthContext.maxWidth,
    widthMode: widthContext.widthMode,
  };

  document.body.classList.add('tu-block-resizing');
  document.addEventListener('mousemove', handleBlockResizeMove);
  document.addEventListener('mouseup', stopBlockResize);
};

const handleBlockResizeMove = (event: MouseEvent) => {
  const state = resizingBlock.value;
  if (!state) return;

  const nextWidth = state.edge === 'right' || state.edge === 'corner'
    ? state.startWidth + event.clientX - state.startX
    : undefined;
  const nextHeight = state.edge === 'bottom' || state.edge === 'corner'
    ? state.startHeight + event.clientY - state.startY
    : undefined;

  commitBlockResize(state.position, nextWidth, nextHeight);
};

const stopBlockResize = () => {
  if (!resizingBlock.value) return;

  resizingBlock.value = null;
  document.body.classList.remove('tu-block-resizing');
  document.removeEventListener('mousemove', handleBlockResizeMove);
  document.removeEventListener('mouseup', stopBlockResize);
};

const startContainerItemMove = (event: MouseEvent, containerIndex: number, childIndex: number) => {
  if (!props.editable) return;
  const container = localBlocks.value[containerIndex];
  const child = container?.children?.[childIndex];
  if (!container || container.type !== 'container' || !child) return;

  event.preventDefault();
  event.stopPropagation();
  activeBlockIndex.value = containerIndex * 100 + childIndex;

  const position = ensureContainerChildPosition(child, childIndex);
  movingContainerItem.value = {
    containerIndex,
    childIndex,
    startX: event.clientX,
    startY: event.clientY,
    startLeft: position.x,
    startTop: position.y,
  };

  document.body.classList.add('tu-block-resizing');
  document.addEventListener('mousemove', handleContainerItemMove);
  document.addEventListener('mouseup', stopContainerItemMove);
};

const handleContainerItemMove = (event: MouseEvent) => {
  const state = movingContainerItem.value;
  if (!state) return;

  const container = localBlocks.value[state.containerIndex];
  const child = container?.children?.[state.childIndex];
  if (!container || container.type !== 'container' || !child) return;

  const position = ensureContainerChildPosition(child, state.childIndex);
  position.x = Math.max(0, Math.round(state.startLeft + event.clientX - state.startX));
  position.y = Math.max(0, Math.round(state.startTop + event.clientY - state.startY));
  emit('content-change', localBlocks.value);
};

const stopContainerItemMove = () => {
  if (!movingContainerItem.value) return;

  movingContainerItem.value = null;
  document.body.classList.remove('tu-block-resizing');
  document.removeEventListener('mousemove', handleContainerItemMove);
  document.removeEventListener('mouseup', stopContainerItemMove);
};

const setContainerItemZ = (
  containerIndex: number,
  childIndex: number,
  mode: 'front' | 'back' | 'forward' | 'backward',
) => {
  const container = localBlocks.value[containerIndex];
  const child = container?.children?.[childIndex];
  if (!container || container.type !== 'container' || !child) return;

  normalizeContainerChildren(container);
  const siblings = container.children ?? [];
  const ordered = siblings
    .map((item, index) => ({
      item,
      index,
      z: Math.max(1, ensureContainerChildPosition(item, index).z ?? index + 1),
    }))
    .sort((a, b) => a.z - b.z || a.index - b.index);

  const currentOrderIndex = ordered.findIndex((entry) => entry.item.id === child.id);
  if (currentOrderIndex < 0) return;

  const [entry] = ordered.splice(currentOrderIndex, 1);
  const targetOrderIndex = mode === 'front'
    ? ordered.length
    : mode === 'back'
      ? 0
      : mode === 'forward'
        ? Math.min(ordered.length, currentOrderIndex + 1)
        : Math.max(0, currentOrderIndex - 1);
  ordered.splice(targetOrderIndex, 0, entry);

  ordered.forEach((orderedEntry, index) => {
    ensureContainerChildPosition(orderedEntry.item, orderedEntry.index).z = index + 1;
  });
  emit('content-change', localBlocks.value);
};

// 在指定位置插入新block
const isSpacerBlock = (block: Block): boolean => {
  return block?.type === 'spacer';
};

const isAutoReferenceUnit = (block: Block | undefined): boolean => {
  return block?.type === 'container' && block.metadata?.autoReferenceUnit === true;
};

const isReferenceUnitMediaBlock = (block: Block | undefined): boolean => {
  return Boolean(block && (block.type === 'x6' || block.type === 'table' || block.type === 'line'));
};

const getSuppressedMediaIds = (block: Block): string[] => {
  const value = block.metadata?.autoGroupSuppressedMediaIds;
  return Array.isArray(value) ? value.filter((item): item is string => typeof item === 'string') : [];
};

const getAutoReferenceUnitId = (blocks: Block[]): string => {
  return `auto-ref-unit-${blocks.map((block) => block.id).join('__')}`;
};

const stripAutoReferenceUnitMetadata = (block: Block): Block => {
  const metadata = { ...(block.metadata ?? {}) };
  delete metadata.autoReferenceUnit;
  delete metadata.autoGroupSuppressedMediaIds;
  const nextBlock: Block = {
    ...block,
    metadata: Object.keys(metadata).length > 0 ? metadata : undefined,
  };
  delete nextBlock.containerPosition;
  delete nextBlock.width;
  return nextBlock;
};

const createAutoReferenceUnit = (children: Block[]): Block => {
  const [leadBlock, ...mediaBlocks] = children;
  return {
    id: getAutoReferenceUnitId(children),
    type: 'container',
    title: leadBlock.title?.trim() || '组合引用单元',
    layout: 'vertical',
    metadata: {
      autoReferenceUnit: true,
    },
    children: children.map(stripAutoReferenceUnitMetadata),
    blockHeight: undefined,
  };
};

const shouldSuppressAutoReferenceUnit = (leadBlock: Block, mediaBlocks: Block[]): boolean => {
  const suppressedIds = getSuppressedMediaIds(leadBlock);
  if (suppressedIds.length === 0) return false;
  const mediaIds = mediaBlocks.map((block) => block.id);
  return mediaIds.length === suppressedIds.length && mediaIds.every((id) => suppressedIds.includes(id));
};

const applyAutoReferenceUnits = (blocks: Block[]): { blocks: Block[]; changed: boolean } => {
  const result: Block[] = [];
  let changed = false;
  let index = 0;

  while (index < blocks.length) {
    const block = blocks[index];

    if (isAutoReferenceUnit(block)) {
      result.push({
        ...block,
        layout: 'vertical',
        children: block.children?.map(stripAutoReferenceUnitMetadata) ?? [],
      });
      index += 1;
      continue;
    }

    if (!isRichTextBlock(block) || !block.content?.trim()) {
      result.push(block);
      index += 1;
      continue;
    }

    const mediaBlocks: Block[] = [];
    let mediaIndex = index + 1;
    while (isReferenceUnitMediaBlock(blocks[mediaIndex])) {
      mediaBlocks.push(blocks[mediaIndex]);
      mediaIndex += 1;
    }

    if (mediaBlocks.length === 0 || shouldSuppressAutoReferenceUnit(block, mediaBlocks)) {
      result.push(block);
      index += 1;
      continue;
    }

    result.push(createAutoReferenceUnit([block, ...mediaBlocks]));
    changed = true;
    index = mediaIndex;
  }

  return { blocks: result, changed };
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

  const grouped = applyAutoReferenceUnits(filteredBlocks);
  return changed || grouped.changed ? grouped.blocks : blocks;
};

const syncAnnotationsFromBlocks = () => {
  const next: Record<number, TextAnnotation[]> = {};
  for (let i = 0; i < localBlocks.value.length; i++) {
    const block = localBlocks.value[i];
    if (block?.metadata?.annotations) {
      next[i] = block.metadata.annotations as TextAnnotation[];
    }
    if (block?.type === 'container' && block.children) {
      for (let j = 0; j < block.children.length; j++) {
        const child = block.children[j];
        if (child?.metadata?.annotations) {
          next[i * 100 + j] = child.metadata.annotations as TextAnnotation[];
        }
      }
    }
  }
  annotationStates.value = next;
};

const syncLocalBlocksFromSource = (blocks: Block[]) => {
  isNormalizing.value = true;
  localBlocks.value = normalizeTopLevelBlocks(blocks);
  void nextTick(() => {
    isNormalizing.value = false;
    syncAnnotationsFromBlocks();
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

const cleanupEmptyRichTextAroundDeletion = (blocks: Block[], position: number) => {
  if (isEmptyRichTextBlock(blocks[position])) {
    blocks.splice(position, 1);
  }

  const previousIndex = position - 1;
  if (isEmptyRichTextBlock(blocks[previousIndex])) {
    blocks.splice(previousIndex, 1);
  }
};

// 删除指定位置的block
const removeBlock = (position: number) => {
  if (tagEditorState.value.position === position) {
    closeTagEditor();
  }

  // 处理容器块内的删除
  if (position >= 100) {
    const containerIndex = Math.floor(position / 100);
    const childIndex = position % 100;
    const container = localBlocks.value[containerIndex];
    if (container && container.type === 'container' && container.children) {
      if (container.children.length > 0) {
        const removedBlock = container.children[childIndex];
        container.children.splice(childIndex, 1);
        if (removedBlock && !isRichTextBlock(removedBlock)) {
          cleanupEmptyRichTextAroundDeletion(container.children, childIndex);
        }
        emit('content-change', localBlocks.value);
      }
      return;
    }
  }

  // 普通块的删除
  if (localBlocks.value.length > 0) {
    const removedBlock = localBlocks.value[position];
    localBlocks.value.splice(position, 1);
    if (removedBlock && !isRichTextBlock(removedBlock)) {
      cleanupEmptyRichTextAroundDeletion(localBlocks.value, position);
    }
    commitTopLevelBlocks();
  }
};

const ungroupAutoReferenceUnit = (position: number) => {
  const block = localBlocks.value[position];
  if (!isAutoReferenceUnit(block) || !block.children?.length) return;

  const [leadBlock, ...mediaBlocks] = block.children.map(stripAutoReferenceUnitMetadata);
  if (!leadBlock) return;

  const suppressedLeadBlock: Block = {
    ...leadBlock,
    metadata: {
      ...(leadBlock.metadata ?? {}),
      autoGroupSuppressedMediaIds: mediaBlocks.map((mediaBlock) => mediaBlock.id),
    },
  };

  localBlocks.value.splice(position, 1, suppressedLeadBlock, ...mediaBlocks);
  commitTopLevelBlocks();
};

// 处理悬浮手柄菜单操作
const handleBlockHandleSelect = (action: string, position: number) => {
  const insertPosition = position + 1;

  switch (action) {
    case 'ungroup-auto-reference-unit':
      ungroupAutoReferenceUnit(position);
      return;
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
    case 'insert-kb-roadmap': {
      const block = createKnowledgeRoadmapBlock();
      if (block) {
        insertBlock(insertPosition, block);
      }
      return;
    }
    case 'insert-table':
      insertBlock(insertPosition, createNewTableBlock());
      return;
    case 'insert-container':
      insertBlock(insertPosition, createNewContainerBlock(insertPosition));
      return;
    case 'insert-task-panel':
      insertBlock(insertPosition, createTaskPanelContainerBlock());
      return;
    case 'edit-tags':
      handleTagEditorRequest(position);
      return;
    case 'delete':
      removeBlock(position);
      return;
    default:
      return;
  }
};

const handleUnifiedHandleSelect = (action: string, position: number) => {
  if (action.startsWith('line-')) {
    const lineAction = action.replace(/^line-/, '');
    richTextEditorRefs.value[position]?.handleLineHandleSelect?.(lineAction);
    return;
  }

  handleBlockHandleSelect(action, position);
};

// 处理回车键创建新block
const handleKeyDown = (event: KeyboardEvent, blockIndex: number) => {
  if (!props.editable) return;
  
  const target = event.target as HTMLElement;
  // 检查事件目标是否在富文本编辑器内部
  const isRichTextEditor = target.closest('.rich-text-editor-container, .vditor-container, .vditor-wysiwyg, .vditor-editor');
  const isInteractiveEditor = target.closest('.table-block, input, textarea, select, button, [contenteditable="true"]');
  
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
    if (!isRichTextEditor && !isInteractiveEditor) {
      event.preventDefault();
      
      // 计算插入位置
      const insertPosition = blockIndex + 1;
      const newBlock = createNewRichTextBlock();
      insertBlock(insertPosition, newBlock);
    }
  }
  // 检查是否是Delete或Backspace键
  else if ((event.key === 'Delete' || event.key === 'Backspace') && !isRichTextEditor && !isInteractiveEditor) {
    event.preventDefault();
    removeBlock(blockIndex);
  }
};

// 为每个块添加点击事件，使其获得焦点
const handleBlockClick = (event: MouseEvent, blockIndex: number) => {
  if (!props.editable) return;
  const target = event.target as HTMLElement | null;
  const currentTarget = event.currentTarget as HTMLElement | null;
  if (target?.closest('.content-wrapper') !== currentTarget) return;

  activeBlockIndex.value = blockIndex;

  const blockElement = blockRefs.value[blockIndex];
  const block = getBlockAtPosition(blockIndex);
  if (blockElement && target) {
    // 如果点击的是富文本编辑器内部，不获取焦点
    const isRichTextEditor = target.closest('.rich-text-editor-container, .vditor-container, .vditor-wysiwyg, .vditor-editor');
    const isGraphEditor = target.closest('.x6-editor, .x6-stage, .x6-canvas');
    const isInteractiveEditor = target.closest('.table-block, input, textarea, select, button, [contenteditable="true"]');
    if (block && isRichTextBlock(block) && !isRichTextEditor) {
      richTextEditorRefs.value[blockIndex]?.focusEditor?.();
      return;
    }
    if (!isRichTextEditor && !isGraphEditor && !isInteractiveEditor) {
      blockElement.focus();
    }
  }
};

// 处理富文本编辑器的点击事件
const handleRichTextEditorClick = (event: MouseEvent, blockIndex: number) => {
  activeBlockIndex.value = blockIndex;
};

// 处理 annotation 点击（显示笔记弹窗）
const handleAnnotationClick = (payload: { annotationId: string; event: MouseEvent }, blockIndex: number) => {
  const annotations = getBlockAnnotations(blockIndex);
  const annotation = annotations.find((a) => a.id === payload.annotationId);
  if (!annotation) return;

  notePopoverAnnotation.value = annotation;
  notePopoverPos.value = { top: payload.event.clientY - 10, left: payload.event.clientX + 12 };
  notePopoverVisible.value = true;
};

// 从选中文本创建 annotation
let pendingNoteBlockIndex = -1;
let pendingNoteSelectedText = '';
let pendingNoteContextBefore = '';
let pendingNoteContextAfter = '';

const getSelectionContextFromDom = (dir: 'before' | 'after'): string => {
  const sel = window.getSelection();
  if (!sel || !sel.rangeCount) return '';
  const range = sel.getRangeAt(0);
  const text = range.startContainer.textContent ?? '';
  const offset = range.startOffset;
  const selLen = range.toString().length;
  if (dir === 'before') {
    return text.slice(Math.max(0, offset - 50), offset);
  }
  return text.slice(offset + selLen, offset + selLen + 50);
};

const handleAddNoteFromSelection = () => {
  if (selectionBlockIndex.value < 0 || !selectedText.value) return;

  pendingNoteBlockIndex = selectionBlockIndex.value;
  pendingNoteSelectedText = selectedText.value;
  pendingNoteContextBefore = getSelectionContextFromDom('before');
  pendingNoteContextAfter = getSelectionContextFromDom('after');

  editingAnnotation.value = undefined;
  noteEditorVisible.value = true;
};

// 保存 annotation
const handleSaveAnnotation = (note: string) => {
  if (pendingNoteBlockIndex < 0) return;

  const now = Date.now();
  const existing = editingAnnotation.value;
  const annotations = [...getBlockAnnotations(pendingNoteBlockIndex)];

  if (existing) {
    const idx = annotations.findIndex((a) => a.id === existing.id);
    if (idx >= 0) {
      annotations[idx] = { ...existing, note, updatedAt: now };
    }
  } else {
    const annotation: TextAnnotation = {
      id: `annot-${now}-${Math.random().toString(36).substr(2, 6)}`,
      selectedText: pendingNoteSelectedText,
      contextBefore: pendingNoteContextBefore,
      contextAfter: pendingNoteContextAfter,
      note,
      color: '#FFEB3B',
      createdAt: now,
      updatedAt: now,
    };
    annotations.push(annotation);
  }

  setBlockAnnotations(pendingNoteBlockIndex, annotations);
  noteEditorVisible.value = false;
  editingAnnotation.value = undefined;

  // 关闭选中
  hasSelection.value = false;
  selectionBlockIndex.value = -1;
  selectionToolbarPos.value = { top: 0, left: 0 };
  pendingNoteBlockIndex = -1;
  pendingNoteSelectedText = '';
  pendingNoteContextBefore = '';
  pendingNoteContextAfter = '';
};

// 编辑 annotation
const handleEditAnnotation = () => {
  if (!notePopoverAnnotation.value) return;
  const target = notePopoverAnnotation.value;

  // 找到该 annotation 所属的 block index
  for (let i = 0; i < localBlocks.value.length; i++) {
    const annotations = getBlockAnnotations(i);
    if (annotations.some((a) => a.id === target.id)) {
      pendingNoteBlockIndex = i;
      break;
    }
  }
  if (pendingNoteBlockIndex < 0) return;

  pendingNoteSelectedText = target.selectedText;
  pendingNoteContextBefore = target.contextBefore;
  pendingNoteContextAfter = target.contextAfter;
  editingAnnotation.value = { ...target };
  noteEditorVisible.value = true;
  notePopoverVisible.value = false;
};

// 删除 annotation
const handleDeleteAnnotation = () => {
  if (!notePopoverAnnotation.value) return;
  const target = notePopoverAnnotation.value;

  for (let i = 0; i < localBlocks.value.length; i++) {
    const annotations = getBlockAnnotations(i);
    const idx = annotations.findIndex((a) => a.id === target.id);
    if (idx >= 0) {
      const next = [...annotations];
      next.splice(idx, 1);
      setBlockAnnotations(i, next);
      break;
    }
  }

  notePopoverAnnotation.value = null;
  notePopoverVisible.value = false;
};

const handleRichTextLineHandleChange = (position: number, payload: RichTextLineHandlePayload) => {
  updateRichTextLineHandleState(position, payload);
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
    case 'table':
      insertedBlock = createNewTableBlock();
      break;
    case 'container':
      insertedBlock = createNewContainerBlock(blockIndex + 1);
      break;
    default:
      return;
  }

  const replacementBlocks = buildSplitReplacementBlocks(beforeContent, insertedBlock, afterContent);
  replaceBlockAtPosition(blockIndex, replacementBlocks);
};

const isNormalizing = ref(false);

watch(
  localBlocks,
  (blocks) => {
    const pageRefIds = new Set<string>();
    const collect = (items: Block[]) => {
      for (const block of items) {
        if (block.type === 'ref' && block.refType === 'page' && block.refId) {
          pageRefIds.add(block.refId);
        }
        if (block.children?.length) collect(block.children);
      }
    };

    collect(blocks);
    pageRefIds.forEach((pageId) => {
      void ensureReferencedPageLoaded(pageId);
    });
  },
  { deep: true, immediate: true },
);

watch(showBlockPicker, (visible) => {
  if (visible) return;
  blockPickerInitialTypeFilter.value = 'all';
  pendingRichTextSplitInsert.value = null;
  pendingX6RefInsert.value = null;
});

watch(
  () => props.contentList,
  (newList) => {
    syncLocalBlocksFromSource(newList);
  },
  { immediate: true }
);

watch(
  () => [workspaceStore.currentPageId, props.pageTitle] as const,
  ([, title]) => {
    pageTitleDraft.value = title || '未命名页面';
  },
  { immediate: true },
);

watch(
  () => workspaceStore.focusedBlockId,
  async (blockId) => {
    if (!blockId) return;
    await scrollToBlockId(blockId);
    workspaceStore.consumeFocusedBlockId();
  },
  { immediate: true },
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
      block.type !== 'container' &&
      block.type !== 'table'
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
  document.addEventListener('paste', handleGlobalPaste, true);
});

onBeforeUnmount(() => {
  // 移除选择事件监听器
  document.removeEventListener('selectionchange', checkSelection);
  document.removeEventListener('paste', handleGlobalPaste, true);
  document.removeEventListener('mousemove', handleBlockResizeMove);
  document.removeEventListener('mouseup', stopBlockResize);
  document.body.classList.remove('tu-block-resizing');
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

      // 捕获选中位置
      if (selectedBlockIndex.value >= 0) {
        const editor = richTextEditorRefs.value[selectedBlockIndex.value] as any;
        const pos = editor?.getSelectionPosition?.();
        if (pos) {
          selectionToolbarPos.value = { top: pos.top + 4, left: pos.left };
          selectionBlockIndex.value = selectedBlockIndex.value;
        }
      }
    } else {
      hasSelection.value = false;
      selectedText.value = '';
      selectedBlockIndex.value = -1;
      selectionBlockIndex.value = -1;
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

const promptX6ExtractTitle = async (count: number) => {
  const defaultTitle = count > 1 ? `提取的蓝图片段（蓝图）(${count} 项)` : '提取的蓝图片段（蓝图）';

  try {
    const { value } = await ElMessageBox.prompt(
      '请输入新蓝图块名称（蓝图）',
      '提取为块（蓝图）',
      {
        confirmButtonText: '确认',
        cancelButtonText: '取消',
        inputValue: defaultTitle,
        inputPlaceholder: '蓝图块名称（蓝图）',
        inputValidator: (input) => {
          return input.trim() ? true : '名称不能为空';
        },
      },
    );

    return value.trim();
  } catch {
    return null;
  }
};

const handleExtractX6Selection = async (payload: X6ExtractSelectionPayload, blockIndex: number) => {
  if (!props.editable) return;
  if (!payload?.graphData || payload.count <= 0) return;

  const title = await promptX6ExtractTitle(payload.count);
  if (!title) return;

  const insertPosition = blockIndex + 1;
  const newBlock = createX6BlockFromGraphData(
    createGraphFromSource('selection-blueprint', payload.graphData as GraphData),
    title,
    createGraphSourceMetadata('selection-blueprint', { syncMode: 'detached' }),
  );
  autoFocusBlockId.value = null;
  insertBlock(insertPosition, newBlock);
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

const getMarkdownLinkTargetIndex = (): number => {
  if (selectedBlockIndex.value >= 0) return selectedBlockIndex.value;
  return activeBlockIndex.value;
};

const canInsertMarkdownLink = computed(() => {
  if (!props.editable) return false;
  const index = getMarkdownLinkTargetIndex();
  if (index < 0) return false;
  return Boolean(
    richTextEditorRefs.value[index]?.insertMarkdownLink
    || markdownLinkCapableRefs.value[index]?.insertMarkdownLink,
  );
});

const getBlockFallbackAnchor = (index: number): { top: number; left: number } => {
  const blockElement = blockRefs.value[index];
  const rect = blockElement?.getBoundingClientRect();
  if (rect) {
    return {
      top: rect.top + 44,
      left: rect.left + 44,
    };
  }
  return {
    top: 96,
    left: 280,
  };
};

const clampLinkPopoverPosition = (anchor: { top: number; left: number }) => {
  const popoverWidth = 320;
  const margin = 12;
  return {
    top: Math.max(margin, Math.min(anchor.top, window.innerHeight - 180)),
    left: Math.max(margin, Math.min(anchor.left, window.innerWidth - popoverWidth - margin)),
  };
};

const getMarkdownLinkAnchor = (index: number): { top: number; left: number } => {
  const anchor = richTextEditorRefs.value[index]?.getMarkdownLinkAnchor?.()
    || markdownLinkCapableRefs.value[index]?.getMarkdownLinkAnchor?.()
    || getBlockFallbackAnchor(index);
  return clampLinkPopoverPosition(anchor);
};

const closeLinkPopover = () => {
  linkPopoverState.value.visible = false;
};

const annotationStates = ref<Record<number, TextAnnotation[]>>({});

const getBlockAnnotations = (index: number): TextAnnotation[] => {
  return annotationStates.value[index] ?? [];
};

const setBlockAnnotations = (index: number, annotations: TextAnnotation[]) => {
  annotationStates.value = { ...annotationStates.value, [index]: annotations };
  const block = getBlockAtPosition(index);
  if (block) {
    block.metadata = { ...(block.metadata ?? {}), annotations };
    emit('content-change', localBlocks.value);
  }
};

const selectionToolbarPos = ref({ top: 0, left: 0 });
const selectionBlockIndex = ref(-1);

const noteEditorVisible = ref(false);
const editingAnnotation = ref<TextAnnotation | undefined>();

const notePopoverVisible = ref(false);
const notePopoverAnnotation = ref<TextAnnotation | null>(null);
const notePopoverPos = ref({ top: 0, left: 0 });

const closeInsertedLinkToolbar = () => {
  insertedLinkToolbarState.value.visible = false;
};

const isImageUrl = (url: string): boolean => {
  try {
    const parsed = new URL(url);
    return /\.(png|jpe?g|gif|webp|svg|avif|bmp)(\?.*)?$/i.test(parsed.pathname + parsed.search);
  } catch {
    return /\.(png|jpe?g|gif|webp|svg|avif|bmp)(\?.*)?$/i.test(url);
  }
};

const normalizePastedUrl = (text: string): string | null => {
  const value = text.trim();
  if (!value || /\s/.test(value)) return null;

  try {
    const url = new URL(value);
    return url.protocol === 'http:' || url.protocol === 'https:' ? url.href : null;
  } catch {
    return null;
  }
};

const registerExternalLinkResource = (url: string, label: string) => {
  void ensureExternalLinkResource(url, label).catch((error) => {
    console.warn('Failed to register external link resource:', error);
    showToast('链接已插入，但外部资源登记失败');
  });
};

const showInsertedLinkToolbar = (
  index: number,
  label: string,
  url: string,
  display: LinkDisplayMode,
) => {
  const anchor = getMarkdownLinkAnchor(index);
  insertedLinkToolbarState.value = {
    visible: true,
    targetIndex: index,
    top: anchor.top,
    left: anchor.left,
    url,
    label,
    display,
    canShowAsImage: isImageUrl(url),
  };
};

const applyMarkdownLink = (index: number, label: string, url: string, display?: LinkDisplayMode) => {
  const linkLabel = label || url.trim();
  const linkDisplay = display ?? (isImageUrl(url) ? 'image' : 'link');
  const richTextEditor = richTextEditorRefs.value[index];
  if (richTextEditor?.insertMarkdownLink) {
    richTextEditor.insertMarkdownLink(linkLabel, url, linkDisplay);
    activeBlockIndex.value = index;
    registerExternalLinkResource(url, linkLabel);
    showInsertedLinkToolbar(index, linkLabel, url, linkDisplay);
    return true;
  }

  const target = markdownLinkCapableRefs.value[index];
  const inserted = target?.insertMarkdownLink?.(linkLabel, url, linkDisplay);
  if (inserted) {
    activeBlockIndex.value = index;
    registerExternalLinkResource(url, linkLabel);
    showInsertedLinkToolbar(index, linkLabel, url, linkDisplay);
    return true;
  }
  return false;
};

const updateInsertedLinkDisplay = (display: LinkDisplayMode) => {
  const { targetIndex } = insertedLinkToolbarState.value;
  if (targetIndex < 0) return;
  const updated = richTextEditorRefs.value[targetIndex]?.updateInsertedLinkDisplay?.(display)
    || markdownLinkCapableRefs.value[targetIndex]?.updateInsertedLinkDisplay?.(display);
  if (!updated) return;
  insertedLinkToolbarState.value.display = display;
};

const handleInsertLinkButtonClick = () => {
  if (!props.editable) return;
  closeInsertedLinkToolbar();
  const index = getMarkdownLinkTargetIndex();
  if (index < 0) return;

  const anchor = getMarkdownLinkAnchor(index);
  linkPopoverState.value = {
    visible: true,
    targetIndex: index,
    top: anchor.top,
    left: anchor.left,
    label: selectedText.value,
    url: '',
  };

  nextTick(() => linkPopoverUrlInputRef.value?.focus());
};

const submitLinkPopover = () => {
  const { targetIndex, label, url } = linkPopoverState.value;
  if (targetIndex < 0 || !url.trim()) return;
  if (applyMarkdownLink(targetIndex, label, url)) closeLinkPopover();
};

const isPasteFromCurrentPage = (target: EventTarget | null): boolean => {
  if (!(target instanceof Node)) return false;
  return Boolean(contentContainerRef.value?.contains(target) || target.parentElement?.closest?.('.page-toolbar'));
};

const handleGlobalPaste = (event: ClipboardEvent) => {
  if (!props.editable || linkPopoverState.value.visible) return;
  if (!isPasteFromCurrentPage(event.target)) return;

  const clipboardText = event.clipboardData?.getData('text/plain') ?? '';
  const url = normalizePastedUrl(clipboardText);
  if (!url) return;

  const index = getMarkdownLinkTargetIndex();
  if (index < 0 || !canInsertMarkdownLink.value) return;

  const label = selectedText.value || url;
  if (!applyMarkdownLink(index, label, url)) return;

  event.preventDefault();
  event.stopPropagation();
  closeLinkPopover();
};

// 处理拖拽结束事件
const handleDragEnd = () => {
  commitTopLevelBlocks();
  showToast('块已成功移动');
};

const handleContainerDragAdd = (containerIndex: number) => {
  const container = localBlocks.value[containerIndex];
  if (!container || container.type !== 'container') return;
  normalizeContainerChildren(container);
  emit('content-change', localBlocks.value);
};

const getTopLevelBlockRects = () => localBlocks.value
  .map((_, index) => {
    const element = blockRefs.value[index];
    return element ? { index, rect: element.getBoundingClientRect() } : null;
  })
  .filter((item): item is { index: number; rect: DOMRect } => Boolean(item));

const createBlankAreaRichTextBlock = (widthPx?: number): Block => {
  const block = createNewRichTextBlock();
  if (typeof widthPx === 'number' && Number.isFinite(widthPx)) {
    block.width = `${Math.max(MIN_BLOCK_WIDTH, Math.round(widthPx))}px`;
  }
  return block;
};

const focusExistingRichTextBlock = async (position: number) => {
  autoFocusBlockId.value = localBlocks.value[position]?.id ?? null;
  await nextTick();
  richTextEditorRefs.value[position]?.focusEditor?.();
};

const appendRichTextBlockFromPageTail = () => {
  const lastIndex = localBlocks.value.length - 1;
  const lastBlock = localBlocks.value[lastIndex];
  if (isRichTextBlock(lastBlock)) {
    void focusExistingRichTextBlock(lastIndex);
    return;
  }

  insertBlock(localBlocks.value.length, createNewRichTextBlock());
};

const getBlankAreaInsertTarget = (event: MouseEvent): { position: number; widthPx?: number } | null => {
  const rects = getTopLevelBlockRects();
  if (rects.length === 0) return { position: 0 };

  const clickX = event.clientX;
  const clickY = event.clientY;
  const rowTolerance = 6;
  const bottom = Math.max(...rects.map(({ rect }) => rect.bottom));
  if (clickY > bottom + rowTolerance) return { position: localBlocks.value.length };

  const rowRects = rects
    .filter(({ rect }) => clickY >= rect.top - rowTolerance && clickY <= rect.bottom + rowTolerance)
    .sort((a, b) => a.rect.left - b.rect.left);
  if (rowRects.length === 0) return null;

  const lastBeforeClick = [...rowRects]
    .reverse()
    .find(({ rect }) => clickX >= rect.right + rowTolerance);
  if (!lastBeforeClick) return null;

  const nextInRow = rowRects.find(({ rect }) => rect.left > lastBeforeClick.rect.right);
  if (nextInRow && clickX >= nextInRow.rect.left - rowTolerance) return null;

  const contentRect = contentContainerRef.value?.getBoundingClientRect();
  const rowRight = nextInRow?.rect.left ?? contentRect?.right ?? event.clientX + MIN_BLOCK_WIDTH;
  const availableWidth = Math.max(MIN_BLOCK_WIDTH, rowRight - lastBeforeClick.rect.right - 12);

  return {
    position: lastBeforeClick.index + 1,
    widthPx: availableWidth,
  };
};

const handleContentContainerClick = (event: MouseEvent) => {
  if (!props.editable) return;

  closeTagEditor();

  const target = event.target as HTMLElement | null;
  if (!target) return;
  if (target.closest('.content-wrapper, .block-handle, .handle-menu')) return;

  const insertTarget = getBlankAreaInsertTarget(event);
  if (insertTarget) {
    if (insertTarget.position === localBlocks.value.length) {
      appendRichTextBlockFromPageTail();
      return;
    }

    insertBlock(insertTarget.position, createBlankAreaRichTextBlock(insertTarget.widthPx));
    return;
  }

  activeBlockIndex.value = -1;
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
        @mousedown.prevent
        @click="handleInsertLinkButtonClick"
        :disabled="!canInsertMarkdownLink"
        title="在当前富文本位置插入 Markdown 链接"
      >
        插入链接
      </button>
      <button 
        class="toolbar-button" 
        @mousedown.prevent
        @click="handleExtractSelectionButtonClick"
        :disabled="!hasSelection"
        title="提取选中文本为新块"
      >
        提取成块
      </button>
    </div>

    <section class="page-title-row" aria-label="页面标题" @wheel.prevent>
      <input
        v-if="editable"
        v-model="pageTitleDraft"
        class="page-title-input"
        type="text"
        aria-label="页面标题"
        placeholder="未命名页面"
        @blur="commitPageTitle"
        @keydown="handlePageTitleKeydown"
      />
      <h1 v-else class="page-title-heading">{{ pageTitleDraft || '未命名页面' }}</h1>
    </section>

    <form
      v-if="linkPopoverState.visible"
      class="link-popover"
      :style="{ top: `${linkPopoverState.top}px`, left: `${linkPopoverState.left}px` }"
      @submit.prevent="submitLinkPopover"
      @mousedown.stop
      @click.stop
      @keydown.esc.prevent.stop="closeLinkPopover"
    >
      <label>
        <span>链接</span>
        <input
          ref="linkPopoverUrlInputRef"
          v-model="linkPopoverState.url"
          type="url"
          placeholder="https://example.com"
          required
        />
      </label>
      <label>
        <span>文字</span>
        <input
          v-model="linkPopoverState.label"
          type="text"
          placeholder="显示文字"
        />
      </label>
      <div class="link-popover__actions">
        <button type="button" @click="closeLinkPopover">取消</button>
        <button type="submit" :disabled="!linkPopoverState.url.trim()">插入</button>
      </div>
    </form>

    <div
      v-if="insertedLinkToolbarState.visible"
      class="inserted-link-toolbar"
      :style="{ top: `${insertedLinkToolbarState.top}px`, left: `${insertedLinkToolbarState.left}px` }"
      @mousedown.stop
      @click.stop
    >
      <span class="inserted-link-toolbar__url">{{ insertedLinkToolbarState.url }}</span>
      <div class="inserted-link-toolbar__actions">
        <button
          type="button"
          :class="{ active: insertedLinkToolbarState.display === 'link' }"
          @click="updateInsertedLinkDisplay('link')"
        >
          显示为链接
        </button>
        <button
          type="button"
          :disabled="!insertedLinkToolbarState.canShowAsImage"
          :class="{ active: insertedLinkToolbarState.display === 'image' }"
          @click="updateInsertedLinkDisplay('image')"
        >
          显示为图片
        </button>
      </div>
    </div>
    
    <div class="content-shell">
      <div
        ref="contentContainerRef"
        class="content-container"
        @click="(event) => { closeLinkPopover(); closeInsertedLinkToolbar(); handleContentContainerClick(event); }"
      >
        <VueDraggable
          class="blocks-list"
          v-model="localBlocks"
          :handle="blockDragHandle"
          :animation="200"
          :group="{ name: 'page-blocks', pull: true, put: true }"
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
              'content-wrapper--highlighted': highlightedBlockId === block.id,
              'content-wrapper--richtext': isRichTextBlock(block),
              'content-wrapper--active': activeBlockIndex === index,
            }"
          :style="getBlockLayoutStyle(block)"
          :data-block-index="index"
          :data-block-id="block.id"
          :ref="(el) => { if(el) blockRefs[index] = el as HTMLElement }"
          @keydown="handleKeyDown($event, index)"
          @click="handleBlockClick($event, index)"
          :tabindex="editable ? 0 : -1"
        >
          <!-- 左侧悬浮手柄 -->
          <BlockActionHandle
            v-if="editable"
            :mode="hasRichTextLineHandle(index) ? 'richtext-line' : 'block'"
            :position-style="getActionHandleStyle(index)"
            :items="getActionHandleItems(index)"
            :drag-enabled="true"
            @select="(action) => handleUnifiedHandleSelect(action, index)"
            @menu-visibility-change="(visible: boolean) => updateRichTextLineMenuVisibility(index, visible)"
          />
          <div class="block-header" v-if="!isRichTextBlock(block)">
            <input
              v-if="editable && isEditableTitleBlock(block)"
              class="block-title-input"
              :value="getBlockDisplayTitle(block, index)"
              @input="updateBlockTitle(block, ($event.target as HTMLInputElement).value)"
              @click.stop
              @keydown.stop
            />
            <h3 v-else>{{ getBlockDisplayTitle(block, index) }}</h3>
            <div class="block-type-badge">{{ block.type }}</div>
          </div>
          <button
            v-if="getBlockTagsForRender(block).length > 0"
            type="button"
            class="block-tag-list"
            @click.stop="handleTagEditorRequest(index)"
          >
            <span
              v-for="tag in getBlockTagsForRender(block)"
              :key="tag.id"
              class="block-tag-chip"
              :style="{ '--block-tag-color': tag.color || '#1677ff' }"
            >
              {{ tag.label }}
            </span>
          </button>

          <template v-if="editable && activeBlockIndex === index">
            <button
              type="button"
              class="block-resize-handle block-resize-handle--right"
              aria-label="调整块宽度"
              @mousedown="startBlockResize($event, index, 'right')"
            />
            <button
              type="button"
              class="block-resize-handle block-resize-handle--bottom"
              aria-label="调整块高度"
              @mousedown="startBlockResize($event, index, 'bottom')"
            />
            <button
              type="button"
              class="block-resize-handle block-resize-handle--corner"
              aria-label="调整块尺寸"
              @mousedown="startBlockResize($event, index, 'corner')"
            />
          </template>

          <!-- 容器块 -->
          <template v-if="block.type === 'container' && block.children">
            <div class="container-block" :class="{ 'container-block--vertical': block.layout === 'vertical' }">
              <VueDraggable
                class="container-canvas"
                :class="{ 'container-canvas--vertical': block.layout === 'vertical' }"
                v-model="block.children"
                :handle="blockDragHandle"
                :animation="200"
                :group="{ name: 'page-blocks', pull: true, put: true }"
                ghost-class="dragging-ghost"
                chosen-class="dragging-chosen"
                drag-class="dragging-drag"
                @end="handleDragEnd"
                @add="() => handleContainerDragAdd(index)"
                :scroll="true"
                :scroll-sensitivity="30"
                :scroll-speed="10"
                :style="getContainerCanvasStyle(block)"
              >
                <div
                  v-for="(childBlock, childIndex) in block.children"
                  :key="childBlock.id"
                  class="container-item"
                  :class="{ 'container-item--vertical': block.layout === 'vertical' }"
                  :style="block.layout === 'vertical' ? undefined : getContainerItemStyle(childBlock, childIndex)"
                >
                  <button
                    v-if="editable && block.layout !== 'vertical'"
                    type="button"
                    class="container-item-move"
                    aria-label="移动容器内块"
                    @mousedown="startContainerItemMove($event, index, childIndex)"
                  >
                    ⋮⋮
                  </button>
                  <div
                    v-if="editable && block.layout !== 'vertical' && activeBlockIndex === index * 100 + childIndex"
                    class="container-z-toolbar"
                  >
                    <button type="button" @click.stop="setContainerItemZ(index, childIndex, 'forward')">上移</button>
                    <button type="button" @click.stop="setContainerItemZ(index, childIndex, 'front')">置顶</button>
                    <button type="button" @click.stop="setContainerItemZ(index, childIndex, 'backward')">下移</button>
                    <button type="button" @click.stop="setContainerItemZ(index, childIndex, 'back')">置底</button>
                  </div>
                  <div
                    class="content-wrapper"
                    :class="{
                      'content-wrapper--richtext': isRichTextBlock(childBlock),
                      'content-wrapper--active': activeBlockIndex === index * 100 + childIndex,
                    }"
                    :data-block-index="index * 100 + childIndex"
                    :data-block-id="childBlock.id"
                    :ref="(el) => { if(el) blockRefs[index * 100 + childIndex] = el as HTMLElement }"
                    @keydown="handleKeyDown($event, index * 100 + childIndex)"
                    @click="handleBlockClick($event, index * 100 + childIndex)"
                    :tabindex="editable ? 0 : -1"
                  >
                    <!-- 左侧悬浮手柄 -->
                    <BlockActionHandle
                      v-if="editable"
                      :mode="hasRichTextLineHandle(index * 100 + childIndex) ? 'richtext-line' : 'block'"
                      :position-style="getActionHandleStyle(index * 100 + childIndex)"
                      :items="getActionHandleItems(index * 100 + childIndex, true)"
                      :drag-enabled="true"
                      @select="(action) => handleUnifiedHandleSelect(action, index * 100 + childIndex)"
                      @menu-visibility-change="(visible: boolean) => updateRichTextLineMenuVisibility(index * 100 + childIndex, visible)"
                    />
                    <div class="block-header" v-if="!isRichTextBlock(childBlock)">
                      <input
                        v-if="editable && isEditableTitleBlock(childBlock)"
                        class="block-title-input"
                        :value="getBlockDisplayTitle(childBlock, childIndex)"
                        @input="updateBlockTitle(childBlock, ($event.target as HTMLInputElement).value)"
                        @click.stop
                        @keydown.stop
                      />
                      <h3 v-else>{{ getBlockDisplayTitle(childBlock, childIndex) }}</h3>
                      <div class="block-type-badge">{{ childBlock.type }}</div>
                    </div>
                    <button
                      v-if="getBlockTagsForRender(childBlock).length > 0"
                      type="button"
                      class="block-tag-list"
                      @click.stop="handleTagEditorRequest(index * 100 + childIndex)"
                    >
                      <span
                        v-for="tag in getBlockTagsForRender(childBlock)"
                        :key="tag.id"
                        class="block-tag-chip"
                        :style="{ '--block-tag-color': tag.color || '#1677ff' }"
                      >
                        {{ tag.label }}
                      </span>
                    </button>

                    <template v-if="editable && block.layout !== 'vertical' && activeBlockIndex === index * 100 + childIndex">
                      <button
                        type="button"
                        class="block-resize-handle block-resize-handle--right"
                        aria-label="调整块宽度"
                        @mousedown="startBlockResize($event, index * 100 + childIndex, 'right')"
                      />
                      <button
                        type="button"
                        class="block-resize-handle block-resize-handle--bottom"
                        aria-label="调整块高度"
                        @mousedown="startBlockResize($event, index * 100 + childIndex, 'bottom')"
                      />
                      <button
                        type="button"
                        class="block-resize-handle block-resize-handle--corner"
                        aria-label="调整块尺寸"
                        @mousedown="startBlockResize($event, index * 100 + childIndex, 'corner')"
                      />
                    </template>

                    <!-- 根据block类型动态渲染不同组件 -->
                    <template v-if="isRichTextBlock(childBlock)">
                      <RichTextEditor
                        :ref="(el: any) => setRichTextEditorRef(el, index * 100 + childIndex)"
                        :key="`richtext-${childBlock.id}`"
                        :content="childBlock.content || ''"
                        :editable="editable"
                        :auto-focus="childBlock.id === autoFocusBlockId"
                        :annotations="getBlockAnnotations(index * 100 + childIndex)"
                        @focused="autoFocusBlockId = null"
                        @content-change="(content: string) => { childBlock.content = content; emit('content-change', localBlocks); }"
                        @height-change="(height: number) => childBlock.blockHeight = height"
                        @extract-selection="(text: string) => handleExtractSelection(text, index * 100 + childIndex)"
                        @insert-block="() => insertBlock(index * 100 + childIndex + 1, createNewRichTextBlock())"
                        @line-insert="(payload: RichTextLineInsertPayload) => handleRichTextLineInsert(payload, index * 100 + childIndex)"
                        @open-tag-editor="(request?: TagEditorOpenRequest) => handleTagEditorRequest(index * 100 + childIndex, request)"
                        @delete-block="removeBlock(index * 100 + childIndex)"
                        @click="(event: MouseEvent) => handleRichTextEditorClick(event, index * 100 + childIndex)"
                        @annotation-click="(payload: { annotationId: string; event: MouseEvent }) => handleAnnotationClick(payload, index * 100 + childIndex)"
                        @line-handle-change="(payload: RichTextLineHandlePayload) => handleRichTextLineHandleChange(index * 100 + childIndex, payload)"
                        @line-handle-menu-visibility-change="(visible: boolean) => updateRichTextLineMenuVisibility(index * 100 + childIndex, visible)"
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
                      :ref="(el: any) => setMarkdownLinkCapableRef(el, index * 100 + childIndex)"
                      :graphData="getX6GraphDataForRender(childBlock)"
                      :graph-source-kind="getGraphSourceKindForBlock(childBlock)"
                      :editable="editable"
                      :source-load-enabled="canLoadGraphFromSource(childBlock.metadata)"
                      :source-write-back-enabled="canWriteGraphToSource(childBlock.metadata)"
                      @click="activeBlockIndex = index * 100 + childIndex"
                      @active="activeBlockIndex = index * 100 + childIndex"
                      @graph-data-change="(graphData: any) => updateX6GraphDataFromEditor(childBlock, graphData as GraphData)"
                      @sync-from-source="syncGraphBlockFromSource(childBlock)"
                      @sync-to-source="(graphData: GraphData) => syncGraphBlockToSource(childBlock, graphData)"
                      @extract-selection="(payload: X6ExtractSelectionPayload) => handleExtractX6Selection(payload, index * 100 + childIndex)"
                      @request-insert-ref="(payload: X6InsertRefRequestPayload) => requestX6RefInsert(index * 100 + childIndex, payload)"
                      class="block-content board-content"
                    />
                    <TableBlock
                      v-else-if="childBlock.type === 'table'"
                      :ref="(el: any) => setMarkdownLinkCapableRef(el, index * 100 + childIndex)"
                      :data="childBlock.tableData"
                      :editable="editable"
                      class="block-content"
                      @click="activeBlockIndex = index * 100 + childIndex"
                      @active="activeBlockIndex = index * 100 + childIndex"
                      @change="(tableData) => { childBlock.tableData = tableData; emit('content-change', localBlocks); }"
                    />
                    <template v-else-if="childBlock.type === 'ref' && childBlock.refId">
                      <div class="ref-block-wrap">
                        <div v-if="childBlock.refType === 'page'" class="page-ref-card">
                          <button type="button" class="page-ref-card__header" @click="openReferencedPage(childBlock.refId)">
                            <span class="page-ref-card__label">页面引用</span>
                            <span class="page-ref-card__title">{{ getPageRefTitle(childBlock.refId) }}</span>
                          </button>
                          <div v-if="referencedPageLoading[childBlock.refId]" class="page-ref-card__status">正在加载页面内容...</div>
                          <div v-else-if="referencedPageErrors[childBlock.refId]" class="page-ref-card__status page-ref-card__status--error">
                            {{ referencedPageErrors[childBlock.refId] }}
                          </div>
                          <div v-else class="page-ref-content">
                            <div v-if="(referencedPageBlocks[childBlock.refId] ?? []).length === 0" class="page-ref-card__status">空页面</div>
                            <template
                              v-for="refPageBlock in referencedPageBlocks[childBlock.refId] ?? []"
                              :key="refPageBlock.id"
                            >
                              <VditorRichEditor
                                v-if="isRichTextBlock(refPageBlock)"
                                :model-value="refPageBlock.content ?? ''"
                                :editable="false"
                                class="block-content page-ref-content__block"
                              />
                              <X6Component
                                v-else-if="refPageBlock.type === 'x6'"
                                :graphData="refPageBlock.graphData"
                                :editable="false"
                                :block-actions-enabled="false"
                                class="block-content board-content page-ref-content__block"
                              />
                              <TableBlock
                                v-else-if="refPageBlock.type === 'table'"
                                :data="refPageBlock.tableData"
                                :editable="false"
                                class="block-content page-ref-content__block"
                              />
                              <ReferencedBlockRenderer
                                v-else-if="refPageBlock.type === 'container'"
                                :block="refPageBlock"
                                :editable="false"
                                class="page-ref-content__block"
                              />
                              <div v-else-if="refPageBlock.type !== 'ref'" class="page-ref-content__fallback">
                                {{ renderReferencedBlockText(refPageBlock) }}
                              </div>
                            </template>
                          </div>
                        </div>
                        <template v-else>
                        <div class="ref-block-badge">
                          🔗 引用自：{{ registryStore.getMeta(childBlock.refId)?.pageTitle ?? '未知页面' }}
                        </div>
                        <ReferencedBlockRenderer
                          :key="`ref-${childBlock.id}`"
                          :block="registryStore.getBlock(childBlock.refId)"
                          :editable="editable"
                          @update-block="(updatedBlock: Block) => updateReferencedBlock(childBlock.refId, updatedBlock)"
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
              :annotations="getBlockAnnotations(index)"
              @focused="autoFocusBlockId = null"
              @content-change="(content: string) => { block.content = content; emit('content-change', localBlocks); }"
              @height-change="(height: number) => block.blockHeight = height"
              @extract-selection="(text: string) => handleExtractSelection(text, index)"
              @insert-block="() => insertBlock(index + 1, createNewRichTextBlock())"
              @line-insert="(payload: RichTextLineInsertPayload) => handleRichTextLineInsert(payload, index)"
              @open-tag-editor="(request?: TagEditorOpenRequest) => handleTagEditorRequest(index, request)"
              @delete-block="removeBlock(index)"
              @click="(event: MouseEvent) => handleRichTextEditorClick(event, index)"
              @annotation-click="(payload: { annotationId: string; event: MouseEvent }) => handleAnnotationClick(payload, index)"
              @line-handle-change="(payload: RichTextLineHandlePayload) => handleRichTextLineHandleChange(index, payload)"
              @line-handle-menu-visibility-change="(visible: boolean) => updateRichTextLineMenuVisibility(index, visible)"
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
            :ref="(el: any) => setMarkdownLinkCapableRef(el, index)"
            :graphData="getX6GraphDataForRender(block)"
            :graph-source-kind="getGraphSourceKindForBlock(block)"
            :editable="editable"
            :source-load-enabled="canLoadGraphFromSource(block.metadata)"
            :source-write-back-enabled="canWriteGraphToSource(block.metadata)"
            @click="activeBlockIndex = index"
            @active="activeBlockIndex = index"
            @graph-data-change="(graphData: any) => updateX6GraphDataFromEditor(block, graphData as GraphData)"
            @sync-from-source="syncGraphBlockFromSource(block)"
            @sync-to-source="(graphData: GraphData) => syncGraphBlockToSource(block, graphData)"
            @extract-selection="(payload: X6ExtractSelectionPayload) => handleExtractX6Selection(payload, index)"
            @request-insert-ref="(payload: X6InsertRefRequestPayload) => requestX6RefInsert(index, payload)"
            class="block-content board-content"
          />
          <TableBlock
            v-else-if="block.type === 'table'"
            :ref="(el: any) => setMarkdownLinkCapableRef(el, index)"
            :data="block.tableData"
            :editable="editable"
            class="block-content"
            @click="activeBlockIndex = index"
            @active="activeBlockIndex = index"
            @change="(tableData) => { block.tableData = tableData; emit('content-change', localBlocks); }"
          />
          <!-- 引用块 -->
          <template v-else-if="block.type === 'ref' && block.refId">
            <div class="ref-block-wrap">
              <div v-if="block.refType === 'page'" class="page-ref-card">
                <button type="button" class="page-ref-card__header" @click="openReferencedPage(block.refId)">
                  <span class="page-ref-card__label">页面引用</span>
                  <span class="page-ref-card__title">{{ getPageRefTitle(block.refId) }}</span>
                </button>
                <div v-if="referencedPageLoading[block.refId]" class="page-ref-card__status">正在加载页面内容...</div>
                <div v-else-if="referencedPageErrors[block.refId]" class="page-ref-card__status page-ref-card__status--error">
                  {{ referencedPageErrors[block.refId] }}
                </div>
                <div v-else class="page-ref-content">
                  <div v-if="(referencedPageBlocks[block.refId] ?? []).length === 0" class="page-ref-card__status">空页面</div>
                  <template
                    v-for="refPageBlock in referencedPageBlocks[block.refId] ?? []"
                    :key="refPageBlock.id"
                  >
                    <VditorRichEditor
                      v-if="isRichTextBlock(refPageBlock)"
                      :model-value="refPageBlock.content ?? ''"
                      :editable="false"
                      class="block-content page-ref-content__block"
                    />
                    <X6Component
                      v-else-if="refPageBlock.type === 'x6'"
                      :graphData="refPageBlock.graphData"
                      :editable="false"
                      :block-actions-enabled="false"
                      class="block-content board-content page-ref-content__block"
                    />
                    <TableBlock
                      v-else-if="refPageBlock.type === 'table'"
                      :data="refPageBlock.tableData"
                      :editable="false"
                      class="block-content page-ref-content__block"
                    />
                    <ReferencedBlockRenderer
                      v-else-if="refPageBlock.type === 'container'"
                      :block="refPageBlock"
                      :editable="false"
                      class="page-ref-content__block"
                    />
                    <div v-else-if="refPageBlock.type !== 'ref'" class="page-ref-content__fallback">
                      {{ renderReferencedBlockText(refPageBlock) }}
                    </div>
                  </template>
                </div>
              </div>
              <template v-else>
              <div class="ref-block-badge">
                🔗 引用自：{{ registryStore.getMeta(block.refId)?.pageTitle ?? '未知页面' }}
              </div>
              <ReferencedBlockRenderer
                :key="`ref-${block.id}`"
                :block="registryStore.getBlock(block.refId)"
                :editable="editable"
                @update-block="(updatedBlock: Block) => updateReferencedBlock(block.refId, updatedBlock)"
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
        <button
          v-if="editable && shouldShowDocumentTailInsert"
          type="button"
          class="document-tail-insert"
          @click.stop="appendRichTextBlockFromPageTail"
        >
          点击继续输入
        </button>
      </div>

      <aside v-if="tocItems.length > 0" class="page-toc" :class="{ 'page-toc--collapsed': !tocExpanded }">
        <div class="page-toc__card">
          <button
            type="button"
            class="page-toc__header"
            :aria-expanded="tocExpanded"
            @click="tocExpanded = !tocExpanded"
          >
            <span class="page-toc__title">目录</span>
            <span class="page-toc__meta">{{ tocItems.length }}</span>
            <span class="page-toc__toggle">{{ tocExpanded ? '收起' : '展开' }}</span>
          </button>
          <div v-show="tocExpanded" class="page-toc__list">
            <button
              v-for="item in tocItems"
              :key="item.id"
              type="button"
              class="page-toc__item"
              :class="{
                'page-toc__item--active': highlightedBlockId === item.blockId,
                [`page-toc__item--level-${item.level}`]: true,
              }"
              @click="handleTocItemClick(item)"
            >
              <span class="page-toc__bullet">H{{ item.level }}</span>
              <span class="page-toc__text">{{ item.text }}</span>
            </button>
          </div>
        </div>
      </aside>
    </div>

    <!-- 引用块选择弹窗 -->
    <BlockPicker
      v-model:visible="showBlockPicker"
      :initial-type-filter="blockPickerInitialTypeFilter"
      :pages="workspaceStore.pageTree"
      :current-page-id="workspaceStore.currentPageId"
      @select="onRefBlockSelected"
    />

    <BlockMetadataTagEditor
      :visible="tagEditorState.visible"
      :selected-tags="activeEditorTags"
      :available-tags="availableTags"
      :top="tagEditorState.top"
      :left="tagEditorState.left"
      @close="closeTagEditor"
      @update:selected-tags="(tags) => { if (tagEditorState.position >= 0) updateBlockTags(tagEditorState.position, tags); }"
    />

    <SelectionToolbar
      :visible="selectionBlockIndex >= 0 && hasSelection"
      :top="selectionToolbarPos.top"
      :left="selectionToolbarPos.left"
      @add-note="handleAddNoteFromSelection"
    />

    <NoteEditor
      :visible="noteEditorVisible"
      :annotation="editingAnnotation"
      @save="handleSaveAnnotation"
      @cancel="noteEditorVisible = false; editingAnnotation = undefined"
    />

    <NotePopover
      :visible="notePopoverVisible"
      :annotation="notePopoverAnnotation"
      :top="notePopoverPos.top"
      :left="notePopoverPos.left"
      @edit="handleEditAnnotation"
      @delete="handleDeleteAnnotation"
      @close="notePopoverVisible = false; notePopoverAnnotation = null"
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
  min-height: max(100%, max-content);
  display: flex;
  flex-direction: column;
}

.page-toolbar {
  position: sticky;
  top: 0;
  z-index: 30;
  display: flex;
  align-items: center;
  padding: 10px 20px;
  background-color: rgba(245, 245, 245, 0.96);
  backdrop-filter: blur(8px);
  border-bottom: 1px solid #e0e0e0;
  margin-bottom: 20px;
  border-radius: 4px 4px 0 0;
  box-shadow: 0 2px 8px rgba(31, 35, 40, 0.06);
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

.page-title-row {
  flex: 0 0 auto;
  width: 100%;
  box-sizing: border-box;
  margin: 0 0 22px;
  padding: 8px 0 4px;
  cursor: text;
}

.page-title-input,
.page-title-heading {
  display: block;
  width: 100%;
  box-sizing: border-box;
  margin: 0;
  border: 0;
  background: transparent;
  color: #111827;
  font: inherit;
  font-size: clamp(30px, 4vw, 44px);
  font-weight: 760;
  line-height: 1.12;
  letter-spacing: -0.04em;
}

.page-title-input {
  padding: 8px 0;
  outline: none;
}

.page-title-input::placeholder {
  color: #9ca3af;
}

.page-title-input:focus {
  box-shadow: inset 0 -2px 0 rgba(22, 119, 255, 0.28);
}

.link-popover {
  position: fixed;
  z-index: 1200;
  width: 320px;
  padding: 12px;
  border: 1px solid #d0d7de;
  border-radius: 8px;
  background: #fff;
  box-shadow: 0 12px 32px rgba(31, 35, 40, 0.18);
}

.link-popover label {
  display: flex;
  flex-direction: column;
  gap: 4px;
  margin-bottom: 10px;
  color: #57606a;
  font-size: 12px;
}

.link-popover input {
  width: 100%;
  min-width: 0;
  box-sizing: border-box;
  padding: 7px 9px;
  border: 1px solid #d0d7de;
  border-radius: 6px;
  color: #24292f;
  font: inherit;
  outline: none;
}

.link-popover input:focus {
  border-color: #1677ff;
  box-shadow: 0 0 0 2px rgba(22, 119, 255, 0.14);
}

.link-popover__actions {
  display: flex;
  justify-content: flex-end;
  gap: 8px;
}

.link-popover__actions button {
  padding: 6px 10px;
  border: 1px solid #d0d7de;
  border-radius: 6px;
  background: #fff;
  color: #24292f;
  cursor: pointer;
  font-size: 13px;
}

.link-popover__actions button[type="submit"] {
  border-color: #1677ff;
  background: #1677ff;
  color: #fff;
}

.link-popover__actions button:disabled {
  border-color: #d8dee4;
  background: #f6f8fa;
  color: #8c959f;
  cursor: not-allowed;
}

.inserted-link-toolbar {
  position: fixed;
  z-index: 1200;
  display: flex;
  align-items: center;
  gap: 10px;
  max-width: min(560px, calc(100vw - 24px));
  padding: 8px 10px;
  border: 1px solid #d0d7de;
  border-radius: 8px;
  background: #fff;
  box-shadow: 0 10px 28px rgba(31, 35, 40, 0.16);
}

.inserted-link-toolbar__url {
  overflow: hidden;
  max-width: 240px;
  color: #57606a;
  font-size: 12px;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.inserted-link-toolbar__actions {
  display: flex;
  gap: 6px;
}

.inserted-link-toolbar__actions button {
  padding: 5px 8px;
  border: 1px solid #d0d7de;
  border-radius: 6px;
  background: #fff;
  color: #24292f;
  cursor: pointer;
  font-size: 12px;
}

.inserted-link-toolbar__actions button.active {
  border-color: #1677ff;
  background: #eaf3ff;
  color: #0969da;
}

.inserted-link-toolbar__actions button:disabled {
  border-color: #d8dee4;
  background: #f6f8fa;
  color: #8c959f;
  cursor: not-allowed;
}

.content-shell {
  display: flex;
  align-items: flex-start;
  gap: 20px;
  width: 100%;
  min-height: 0;
}

.content-container {
  position: relative;
  min-height: 100%;
  display: flex;
  flex-direction: column;
  flex: 1;
  min-width: 0;
}

.blocks-list {
  display: flex;
  flex-direction: row;
  flex-wrap: wrap;
  align-content: flex-start;
  gap: 8px;
  flex: 0 0 auto;
  min-height: 0;
}

.document-tail-insert {
  width: 100%;
  min-height: 96px;
  margin-top: 8px;
  border: 1px dashed transparent;
  border-radius: 8px;
  background: transparent;
  color: transparent;
  cursor: text;
  text-align: left;
}

.document-tail-insert:hover,
.document-tail-insert:focus {
  border-color: #91caff;
  background: #f8fbff;
  color: #8c959f;
  outline: none;
}

.page-toc {
  position: sticky;
  top: 72px;
  flex: 0 0 248px;
  width: 248px;
  align-self: flex-start;
  z-index: 24;
  transition: flex-basis 0.2s ease, width 0.2s ease;
}

.page-toc--collapsed {
  flex-basis: 112px;
  width: 112px;
}

.page-toc__card {
  display: flex;
  flex-direction: column;
  max-height: calc(100vh - 40px);
  overflow: hidden;
  padding: 10px;
  border: 1px solid #e5e7eb;
  border-radius: 12px;
  background: rgba(252, 253, 255, 0.94);
  backdrop-filter: blur(10px);
  box-shadow: 0 14px 32px rgba(15, 23, 42, 0.12);
}

.page-toc__header {
  display: flex;
  align-items: center;
  gap: 8px;
  width: 100%;
  padding: 6px 8px;
  border: 0;
  border-radius: 8px;
  background: transparent;
  color: #1f2937;
  cursor: pointer;
  text-align: left;
}

.page-toc__header:hover {
  background: rgba(22, 119, 255, 0.08);
}

.page-toc__title {
  flex: 1;
  min-width: 0;
  font-size: 13px;
  font-weight: 700;
}

.page-toc__meta {
  flex: 0 0 auto;
  min-width: 20px;
  padding: 1px 6px;
  border-radius: 999px;
  background: rgba(22, 119, 255, 0.12);
  color: #1677ff;
  font-size: 11px;
  font-weight: 700;
  text-align: center;
}

.page-toc__toggle {
  flex: 0 0 auto;
  color: #6b7280;
  font-size: 12px;
}

.page-toc--collapsed .page-toc__header {
  justify-content: center;
}

.page-toc--collapsed .page-toc__title,
.page-toc--collapsed .page-toc__meta {
  display: none;
}

.page-toc__list {
  display: flex;
  flex-direction: column;
  gap: 6px;
  margin-top: 6px;
  overflow: auto;
}

.page-toc__item {
  display: flex;
  align-items: flex-start;
  gap: 8px;
  width: 100%;
  padding: 8px 10px;
  border: 0;
  border-radius: 8px;
  background: transparent;
  color: #4b5563;
  cursor: pointer;
  text-align: left;
  transition: background 0.2s ease, color 0.2s ease, transform 0.2s ease;
}

.page-toc__item:hover {
  background: rgba(22, 119, 255, 0.08);
  color: #0958d9;
}

.page-toc__item--active {
  background: rgba(22, 119, 255, 0.12);
  color: #0958d9;
}

.page-toc__bullet {
  flex: 0 0 auto;
  min-width: 26px;
  padding-top: 1px;
  font-size: 11px;
  font-weight: 700;
  color: #1677ff;
}

.page-toc__text {
  flex: 1;
  min-width: 0;
  font-size: 13px;
  line-height: 1.45;
  word-break: break-word;
}

.page-toc__item--level-2 {
  padding-left: 18px;
}

.page-toc__item--level-3 {
  padding-left: 28px;
}

.page-toc__item--level-4 {
  padding-left: 38px;
}

.page-toc__item--level-5 {
  padding-left: 48px;
}

.page-toc__item--level-6 {
  padding-left: 58px;
}


.content-wrapper {
  --block-handle-gutter: 36px;
  --block-shell-pad-x: 0px;
  --block-shell-pad-y: 0px;
  flex: 0 0 100%;
  min-width: 260px;
  box-sizing: border-box;
  margin-bottom: 0;
  padding: var(--block-shell-pad-y) var(--block-shell-pad-x) var(--block-shell-pad-y) var(--block-handle-gutter);
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

.content-wrapper--active {
  border-color: #1677ff;
  box-shadow: 0 0 0 2px rgba(22, 119, 255, 0.14);
}

.content-wrapper--highlighted {
  box-shadow:
    0 0 0 2px rgba(22, 119, 255, 0.22),
    0 16px 28px rgba(22, 119, 255, 0.12);
  background: linear-gradient(135deg, rgba(22, 119, 255, 0.08), rgba(22, 119, 255, 0.02));
}

/* 富文本块不显示外边框 */
.content-wrapper--richtext {
  border: none;
  box-shadow: none;
  --block-content-pad-y: 10px;
  --block-content-pad-x: 15px;
  padding: 0;
  min-height: 44px;
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

.content-wrapper--richtext.content-wrapper--active {
  border: 1px solid rgba(22, 119, 255, 0.35);
  box-shadow: 0 0 0 2px rgba(22, 119, 255, 0.1);
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
  gap: 12px;
  margin-bottom: 6px;
}

.block-header h3 {
  margin: 0;
  color: #333;
  font-size: 16px;
}

.block-title-input {
  flex: 1;
  min-width: 0;
  border: 1px solid transparent;
  border-radius: 6px;
  padding: 5px 8px;
  color: #333;
  background: transparent;
  font: inherit;
  font-size: 16px;
  font-weight: 600;
  outline: none;
}

.block-title-input:hover,
.block-title-input:focus {
  border-color: #91caff;
  background: #fff;
}

.block-tag-list {
  display: flex;
  flex-wrap: wrap;
  gap: 8px;
  width: 100%;
  padding: 0;
  margin: 0 0 12px;
  border: none;
  background: transparent;
  cursor: pointer;
  text-align: left;
}

.block-tag-chip {
  --block-tag-color: #1677ff;
  display: inline-flex;
  align-items: center;
  border-radius: 999px;
  padding: 4px 10px;
  font-size: 12px;
  line-height: 1.4;
  color: var(--block-tag-color);
  background: rgba(22, 119, 255, 0.1);
  border: 1px solid rgba(22, 119, 255, 0.2);
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

.block-resize-handle {
  position: absolute;
  z-index: 20;
  border: 1px solid #1677ff;
  border-radius: 4px;
  background: #fff;
  box-shadow: 0 2px 8px rgba(22, 119, 255, 0.18);
  opacity: 0.92;
}

.block-resize-handle--right {
  top: 50%;
  right: -6px;
  width: 10px;
  height: 36px;
  cursor: ew-resize;
  transform: translateY(-50%);
}

.block-resize-handle--bottom {
  bottom: -6px;
  left: 50%;
  width: 44px;
  height: 10px;
  cursor: ns-resize;
  transform: translateX(-50%);
}

.block-resize-handle--corner {
  right: -7px;
  bottom: -7px;
  width: 14px;
  height: 14px;
  cursor: nwse-resize;
}

:global(.tu-block-resizing) {
  cursor: nwse-resize;
  user-select: none;
}

:global(.tu-block-resizing iframe),
:global(.tu-block-resizing textarea),
:global(.tu-block-resizing [contenteditable='true']) {
  pointer-events: none;
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

.page-ref-card {
  display: flex;
  flex-direction: column;
  gap: 10px;
  padding: 10px 12px 12px;
}

.page-ref-card__header {
  display: flex;
  flex-direction: column;
  align-items: flex-start;
  gap: 4px;
  width: 100%;
  padding: 0;
  border: 0;
  background: transparent;
  cursor: pointer;
  text-align: left;
}

.page-ref-card__header:hover .page-ref-card__title {
  color: #0958d9;
}

.page-ref-card__label {
  font-size: 11px;
  color: #1677ff;
  user-select: none;
}

.page-ref-card__title {
  font-size: 14px;
  font-weight: 600;
  color: #1f1f1f;
  line-height: 1.4;
  word-break: break-word;
}

.page-ref-card__status {
  padding: 8px 0;
  font-size: 12px;
  color: #8c8c8c;
}

.page-ref-card__status--error {
  color: #cf1322;
}

.page-ref-content {
  display: flex;
  flex-direction: column;
  gap: 10px;
  padding-top: 8px;
  border-top: 1px solid #d6e4ff;
}

.page-ref-content__block {
  background: #fff;
  border-radius: 6px;
}

.page-ref-content__fallback {
  padding: 10px 12px;
  border-radius: 6px;
  background: #fff;
  color: #595959;
  font-size: 13px;
  line-height: 1.5;
  white-space: pre-wrap;
  word-break: break-word;
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
  margin: 0 !important;
  border-radius: 8px !important;
}

/* 容器块样式 */
.container-block {
  position: relative;
  border: 2px solid #d9d9d9;
  border-radius: 8px;
  margin: 8px 0;
  background:
    linear-gradient(#f0f0f0 1px, transparent 1px),
    linear-gradient(90deg, #f0f0f0 1px, transparent 1px),
    #fafafa;
  background-size: 24px 24px;
  overflow: auto;
}

.container-block--vertical {
  border: 1px solid #d6e4ff;
  background: #fff;
  overflow: visible;
}

.container-canvas {
  position: relative;
  min-width: 100%;
}

.container-canvas--vertical {
  display: flex;
  flex-direction: column;
  gap: 10px;
  padding: 10px 12px;
}

.container-item {
  position: absolute;
  min-width: 220px;
  box-sizing: border-box;
}

.container-item--vertical {
  position: relative;
  min-width: 0;
  width: 100%;
}

.container-item > .content-wrapper {
  width: 100%;
  height: 100%;
  min-width: 0;
  background: #fff;
  box-shadow: 0 4px 14px rgba(31, 35, 40, 0.08);
}

.container-item-move {
  position: absolute;
  top: -10px;
  left: 8px;
  z-index: 20;
  border: 1px solid #d0d7de;
  border-radius: 6px;
  background: #fff;
  color: #57606a;
  cursor: grab;
  font-size: 12px;
  line-height: 1;
  padding: 3px 6px;
  box-shadow: 0 3px 10px rgba(31, 35, 40, 0.12);
}

.container-item-move:active {
  cursor: grabbing;
}

.container-z-toolbar {
  position: absolute;
  top: -34px;
  right: 0;
  z-index: 21;
  display: flex;
  gap: 6px;
  flex-wrap: wrap;
  justify-content: flex-end;
  max-width: 220px;
  padding: 4px;
  border: 1px solid #d0d7de;
  border-radius: 6px;
  background: #fff;
  box-shadow: 0 3px 10px rgba(31, 35, 40, 0.12);
}

.container-z-toolbar button {
  border: 0;
  background: #f6f8fa;
  border-radius: 4px;
  padding: 3px 6px;
  cursor: pointer;
  font-size: 12px;
  color: #24292f;
}

@media (max-width: 1100px) {
  .content-shell {
    flex-direction: column;
  }

  .page-toc {
    position: static;
    order: -1;
    width: 100%;
    flex-basis: auto;
  }

  .page-toc--collapsed {
    width: 100%;
    flex-basis: auto;
  }

  .page-toc__card {
    max-height: none;
  }
}
</style>
