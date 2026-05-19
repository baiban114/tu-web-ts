<script setup lang="ts">
import { computed, nextTick, onBeforeUnmount, onMounted, ref, watch } from 'vue';
import X6NodeOverlay from './X6NodeOverlay.vue';
import { useObjectModelStore } from '@/stores/objectModel';
import type { UmlClassDefinition, UmlModel } from '@/stores/objectModel';
import {
  Clipboard,
  type Edge,
  Graph,
  History,
  Keyboard,
  type Node,
  Selection,
  Snapline,
  Transform,
} from '@antv/x6';

type CellData = Record<string, any>;
const BLUEPRINT_ANCHOR = { x: 480, y: 280 } as const;
const TASK_FLOW_KIND = 'task-flow' as const;

interface GraphData {
  cells?: CellData[];
  nodes: CellData[];
  edges: CellData[];
  [key: string]: any;
}

interface Props {
  graphData?: GraphData;
  graphSourceKind?: string | null;
  editable?: boolean;
  width?: number;
  height?: number;
  blockActionsEnabled?: boolean;
  sourceLoadEnabled?: boolean;
  sourceWriteBackEnabled?: boolean;
}

type NodePreset = 'rect' | 'round' | 'ellipse' | 'diamond' | 'umlClass';

type SelectedCellState =
  | {
      kind: 'node';
      id: string;
      shape: string;
      label: string;
      fill: string;
      stroke: string;
      width: number;
      height: number;
      textMode: 'plain' | 'rich';
      richContent: string;
    }
  | {
      kind: 'edge';
      id: string;
      label: string;
      stroke: string;
      router: string;
      connector: string;
    };

const props = withDefaults(defineProps<Props>(), {
  graphData: undefined,
  graphSourceKind: null,
  editable: true,
  width: 960,
  height: 540,
  blockActionsEnabled: true,
  sourceLoadEnabled: false,
  sourceWriteBackEnabled: false,
});

interface ExtractedGraphSelectionPayload {
  graphData: GraphData;
  count: number;
}

interface InsertRefRequestPayload {
  x: number;
  y: number;
}

const emit = defineEmits<{
  (e: 'graph-data-change', graphData: GraphData): void;
  (e: 'extract-selection', payload: ExtractedGraphSelectionPayload): void;
  (e: 'request-insert-ref', payload: InsertRefRequestPayload): void;
  (e: 'sync-from-source'): void;
  (e: 'sync-to-source', graphData: GraphData): void;
  (e: 'active'): void;
}>();

const stageRef = ref<HTMLDivElement | null>(null);
const containerRef = ref<HTMLDivElement | null>(null);
const nodeOverlayRefs = ref<Record<string, {
  getMarkdownLinkAnchor?: () => { top: number; left: number } | undefined;
  insertMarkdownLink?: (label: string, url: string, display?: 'link' | 'image') => boolean;
  updateInsertedLinkDisplay?: (display: 'link' | 'image') => boolean;
  updateInsertedImageWidth?: (widthPercent: number) => boolean;
}>>({});

const canUndo = ref(false);
const canRedo = ref(false);
const gridVisible = ref(true);
const zoomPercent = ref(100);
const selectedCellsCount = ref(0);
const selectedCell = ref<SelectedCellState | null>(null);
const objectModelStore = useObjectModelStore();

// Node overlay state — unified for plain and rich text editing
const editingNodeId = ref<string | null>(null);
const nodeOverlays = ref<Array<{
  id: string;
  style: Record<string, string>; 
  textMode: 'plain' | 'rich';
  label: string;
  richContent: string;
}>>([]);
const graphSourceRegion = ref<{
  kind: string;
  label: string;
  style: Record<string, string>;
} | null>(null);

// Edge inline editing state (kept here, edge editing not split into sub-component)
const edgeInlineEditing = ref(false);
const edgeInlineEditId = ref<string | null>(null);
const edgeInlineEditStyle = ref<Record<string, string>>({});
const edgeInlineEditText = ref('');
const edgeInlineInputRef = ref<HTMLTextAreaElement | null>(null);

const isEditable = computed(() => props.editable !== false);
const isTaskFlow = computed(() => props.graphData?.blueprintMeta?.kind === TASK_FLOW_KIND);
const hasGraphSourceActions = computed(() => props.sourceLoadEnabled || props.sourceWriteBackEnabled);
const selectionSummary = computed(() => {
  if (selectedCellsCount.value === 0) return '未选中对象';
  if (selectedCellsCount.value > 1) return `已选中 ${selectedCellsCount.value} 个对象`;
  if (!selectedCell.value) return '已选中 1 个对象';
  return selectedCell.value.kind === 'node'
    ? `节点: ${selectedCell.value.label || selectedCell.value.id}`
    : `连线: ${selectedCell.value.label || selectedCell.value.id}`;
});
const taskSequenceSummary = computed(() => {
  if (!isTaskFlow.value) return [] as string[];
  const data = normalizeGraphData(props.graphData);
  const taskNodes = data.nodes.filter((node) => node.data?.taskRole === 'task');
  if (!taskNodes.length) return [];

  const taskIds = new Set(taskNodes.map((node) => node.id));
  const incomingCount = new Map(taskNodes.map((node) => [node.id, 0]));
  const nextById = new Map<string, string>();
  const labelById = new Map(taskNodes.map((node) => [node.id, String(node.label ?? node.data?.label ?? '未命名任务')]));

  data.edges.forEach((edge) => {
    const sourceId = typeof edge.source === 'string' ? edge.source : typeof edge.source?.cell === 'string' ? edge.source.cell : '';
    const targetId = typeof edge.target === 'string' ? edge.target : typeof edge.target?.cell === 'string' ? edge.target.cell : '';
    if (!taskIds.has(sourceId) || !taskIds.has(targetId)) return;
    nextById.set(sourceId, targetId);
    incomingCount.set(targetId, (incomingCount.get(targetId) ?? 0) + 1);
  });

  const ordered: string[] = [];
  const visited = new Set<string>();
  let cursor = taskNodes.find((node) => (incomingCount.get(node.id) ?? 0) === 0)?.id ?? taskNodes[0].id;

  while (cursor && !visited.has(cursor)) {
    visited.add(cursor);
    ordered.push(labelById.get(cursor) ?? '未命名任务');
    cursor = nextById.get(cursor) ?? '';
  }

  taskNodes.forEach((node) => {
    if (!visited.has(node.id)) ordered.push(labelById.get(node.id) ?? '未命名任务');
  });

  return ordered;
});
let graph: Graph | null = null;
let resizeObserver: ResizeObserver | null = null;
let syncTimer: number | null = null;
let isApplyingExternalData = false;
let isUserInteracting = false;
let pendingSyncAfterInteraction = false;
let lastSerializedSnapshot = '';
let pendingNodeInternalClickId: string | null = null;
let suppressNextNodeInternalClickId: string | null = null;

const PORT_GROUPS = {
  top: {
    position: 'top',
    attrs: {
      circle: {
        r: 4,
        magnet: true,
        stroke: '#1677ff',
        strokeWidth: 2,
        fill: '#ffffff',
        visibility: 'hidden',
      },
    },
  },
  right: {
    position: 'right',
    attrs: {
      circle: {
        r: 4,
        magnet: true,
        stroke: '#1677ff',
        strokeWidth: 2,
        fill: '#ffffff',
        visibility: 'hidden',
      },
    },
  },
  bottom: {
    position: 'bottom',
    attrs: {
      circle: {
        r: 4,
        magnet: true,
        stroke: '#1677ff',
        strokeWidth: 2,
        fill: '#ffffff',
        visibility: 'hidden',
      },
    },
  },
  left: {
    position: 'left',
    attrs: {
      circle: {
        r: 4,
        magnet: true,
        stroke: '#1677ff',
        strokeWidth: 2,
        fill: '#ffffff',
        visibility: 'hidden',
      },
    },
  },
} as const;

const createNodePorts = () => ({
  groups: PORT_GROUPS,
  items: [
    { id: 'port-top', group: 'top' },
    { id: 'port-right', group: 'right' },
    { id: 'port-bottom', group: 'bottom' },
    { id: 'port-left', group: 'left' },
  ],
});

function createId(prefix: string) {
  return `${prefix}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}

function isPlainObject(value: unknown): value is Record<string, any> {
  return Object.prototype.toString.call(value) === '[object Object]';
}

function mergeDeep<T extends Record<string, any>>(base: T, extra: Record<string, any>): T {
  const result: Record<string, any> = { ...base };
  Object.entries(extra).forEach(([key, value]) => {
    const baseValue = result[key];
    if (isPlainObject(baseValue) && isPlainObject(value)) {
      result[key] = mergeDeep(baseValue, value);
      return;
    }
    result[key] = value;
  });
  return result as T;
}

function getCellPosition(cell: CellData, fallback = { x: 120, y: 120 }) {
  const position = isPlainObject(cell.position) ? cell.position : undefined;
  const style = isPlainObject(cell.style) ? cell.style : undefined;
  return {
    x: typeof position?.x === 'number'
      ? position.x
      : typeof cell.x === 'number'
        ? cell.x
        : typeof style?.x === 'number'
          ? style.x
          : fallback.x,
    y: typeof position?.y === 'number'
      ? position.y
      : typeof cell.y === 'number'
        ? cell.y
        : typeof style?.y === 'number'
          ? style.y
          : fallback.y,
  };
}

function getCellSize(cell: CellData) {
  const size = isPlainObject(cell.size) ? cell.size : undefined;
  return {
    width: typeof size?.width === 'number'
      ? size.width
      : typeof cell.width === 'number'
        ? cell.width
        : undefined,
    height: typeof size?.height === 'number'
      ? size.height
      : typeof cell.height === 'number'
        ? cell.height
        : undefined,
  };
}

function createEdgeMetadata(edge: Partial<CellData> = {}): CellData {
  return {
    shape: 'edge',
    router: { name: 'orth' },
    connector: { name: 'rounded' },
    attrs: mergeDeep(
      {
        line: {
          stroke: '#52616b',
          strokeWidth: 2,
          targetMarker: {
            name: 'block',
            width: 10,
            height: 8,
          },
        },
      },
      edge.attrs ?? {},
    ),
    zIndex: 0,
    ...edge,
  };
}

function splitLines(value: string): string[] {
  return value
    .split('\n')
    .map((line) => line.trim())
    .filter(Boolean);
}

function normalizeUmlModel(value: unknown): UmlModel {
  const source = isPlainObject(value) ? value : {};
  const classes = Array.isArray(source.classes)
    ? source.classes.map((item: any) => ({
      id: typeof item.id === 'string' ? item.id : createId('uml-class'),
      name: typeof item.name === 'string' && item.name.trim() ? item.name.trim() : 'Class',
      attributes: Array.isArray(item.attributes) ? item.attributes.filter((line: unknown): line is string => typeof line === 'string') : [],
      methods: Array.isArray(item.methods) ? item.methods.filter((line: unknown): line is string => typeof line === 'string') : [],
      nodeId: typeof item.nodeId === 'string' ? item.nodeId : undefined,
    }))
    : [];
  const classIds = new Set(classes.map((item) => item.id));
  const objects = Array.isArray(source.objects)
    ? source.objects
      .map((item: any) => ({
        id: typeof item.id === 'string' ? item.id : createId('uml-object'),
        name: typeof item.name === 'string' && item.name.trim() ? item.name.trim() : 'object',
        classId: typeof item.classId === 'string' ? item.classId : '',
        propertyValues: isPlainObject(item.propertyValues) ? item.propertyValues as Record<string, string> : {},
      }))
      .filter((item) => classIds.has(item.classId))
    : [];
  return { classes, objects };
}

function formatUmlClassLabel(definition: UmlClassDefinition): string {
  const attributes = definition.attributes.length ? definition.attributes.join('\n') : ' ';
  const methods = definition.methods.length ? definition.methods.join('\n') : ' ';
  return `${definition.name}\n────────────\n${attributes}\n────────────\n${methods}`;
}

function createUmlClassNode(definition: UmlClassDefinition, options: Partial<CellData> = {}): CellData {
  return {
    id: options.id ?? definition.nodeId ?? createId('uml-class-node'),
    shape: 'rect',
    x: options.x ?? 160,
    y: options.y ?? 120,
    width: options.width ?? 240,
    height: options.height ?? 172,
    ports: options.ports ?? createNodePorts(),
    attrs: mergeDeep(
      {
        body: {
          fill: '#fffdf7',
          stroke: '#31511e',
          strokeWidth: 1.8,
          rx: 2,
          ry: 2,
        },
        label: {
          text: formatUmlClassLabel(definition),
          fill: '#1f2d1f',
          fontSize: 13,
          fontFamily: 'Consolas, Menlo, monospace',
          textVerticalAnchor: 'middle',
          textAnchor: 'middle',
          lineHeight: 18,
        },
      },
      options.attrs ?? {},
    ),
    data: {
      preset: 'umlClass',
      umlClassId: definition.id,
      ...(options.data ?? {}),
    },
    ...options,
  };
}

function extractNodeLabel(node: CellData) {
  return node.label ?? node.data?.label ?? node.attrs?.label?.text ?? '节点';
}

function createNodeMetadata(preset: NodePreset, options: Partial<CellData> = {}): CellData {
  if (preset === 'umlClass') {
    const definition: UmlClassDefinition = options.data?.umlDefinition ?? {
      id: options.data?.umlClassId ?? createId('uml-class'),
      name: options.label ?? 'Class',
      attributes: [],
      methods: [],
      nodeId: options.id,
    };
    return createUmlClassNode(definition, options);
  }

  const labels: Record<Exclude<NodePreset, 'umlClass'>, string> = {
    rect: '处理步骤',
    round: '子流程',
    ellipse: '开始 / 结束',
    diamond: '判断',
  };

  const fills: Record<Exclude<NodePreset, 'umlClass'>, string> = {
    rect: '#fff7e6',
    round: '#f6ffed',
    ellipse: '#e6f4ff',
    diamond: '#fff1f0',
  };

  const strokes: Record<Exclude<NodePreset, 'umlClass'>, string> = {
    rect: '#d48806',
    round: '#389e0d',
    ellipse: '#1677ff',
    diamond: '#cf1322',
  };

  const textColors: Record<Exclude<NodePreset, 'umlClass'>, string> = {
    rect: '#593103',
    round: '#135200',
    ellipse: '#003a8c',
    diamond: '#820014',
  };

  const shape = preset === 'diamond' ? 'polygon' : preset === 'ellipse' ? 'ellipse' : 'rect';
  const defaultWidth = preset === 'ellipse' ? 140 : preset === 'diamond' ? 140 : 160;
  const defaultHeight = preset === 'diamond' ? 88 : 64;
  const baseBody: Record<string, any> = {
    fill: fills[preset],
    stroke: strokes[preset],
    strokeWidth: 1.6,
  };

  if (preset === 'round') {
    baseBody.rx = 16;
    baseBody.ry = 16;
  }

  if (preset === 'diamond') {
    baseBody.refPoints = '0,10 10,0 20,10 10,20';
  }

  return {
    id: options.id ?? createId(`x6-${preset}`),
    shape,
    x: options.x ?? 120,
    y: options.y ?? 120,
    width: options.width ?? defaultWidth,
    height: options.height ?? defaultHeight,
    ports: options.ports ?? createNodePorts(),
    attrs: mergeDeep(
      {
        body: baseBody,
        label: {
          text: options.label ?? labels[preset],
          fill: textColors[preset],
          fontSize: 14,
          fontWeight: 600,
        },
      },
      options.attrs ?? {},
    ),
    data: {
      preset,
      ...(options.data ?? {}),
    },
    ...options,
  };
}

function createTaskNode(options: Partial<CellData> = {}): CellData {
  const label = typeof options.label === 'string' && options.label.trim() ? options.label.trim() : '新任务';
  const description = typeof options.data?.taskDescription === 'string' && options.data.taskDescription.trim()
    ? options.data.taskDescription.trim()
    : '连接上下游任务';

  return createNodeMetadata('round', {
    width: 196,
    height: 86,
    label,
    attrs: mergeDeep(
      {
        body: {
          fill: '#fff8e6',
          stroke: '#d48806',
          strokeWidth: 1.8,
          rx: 18,
          ry: 18,
        },
        label: {
          text: `${label}\n${description}`,
          fill: '#6b3f00',
          fontSize: 14,
          fontWeight: 700,
          lineHeight: 18,
        },
      },
      options.attrs ?? {},
    ),
    data: {
      preset: 'round',
      textMode: 'plain',
      taskRole: 'task',
      taskStatus: 'todo',
      taskDescription: description,
      ...(options.data ?? {}),
    },
    ...options,
  });
}

function createStarterGraphData(): GraphData {
  const startNode = createNodeMetadata('ellipse', {
    id: 'x6-start-node',
    x: 100,
    y: 160,
    label: '开始',
  });

  const processNode = createNodeMetadata('round', {
    id: 'x6-process-node',
    x: 340,
    y: 150,
    label: '编辑流程',
  });

  const decisionNode = createNodeMetadata('diamond', {
    id: 'x6-decision-node',
    x: 610,
    y: 148,
    label: '需要分支?',
  });

  const finishNode = createNodeMetadata('ellipse', {
    id: 'x6-finish-node',
    x: 870,
    y: 160,
    label: '完成',
  });

  const edges = [
    createEdgeMetadata({
      id: 'x6-edge-1',
      source: { cell: startNode.id, port: 'port-right' },
      target: { cell: processNode.id, port: 'port-left' },
    }),
    createEdgeMetadata({
      id: 'x6-edge-2',
      source: { cell: processNode.id, port: 'port-right' },
      target: { cell: decisionNode.id, port: 'port-left' },
    }),
    createEdgeMetadata({
      id: 'x6-edge-3',
      source: { cell: decisionNode.id, port: 'port-right' },
      target: { cell: finishNode.id, port: 'port-left' },
      labels: [
        {
          attrs: {
            label: {
              text: '是',
              fill: '#52616b',
              fontSize: 12,
            },
          },
        },
      ],
    }),
  ];

  const cells = [startNode, processNode, decisionNode, finishNode, ...edges];
  return {
    cells,
    nodes: [startNode, processNode, decisionNode, finishNode],
    edges,
  };
}

function createTaskFlowStarterGraphData(): GraphData {
  const startNode = createNodeMetadata('ellipse', {
    id: 'task-flow-start-node',
    x: 100,
    y: 170,
    width: 136,
    height: 64,
    label: '开始',
    data: {
      preset: 'ellipse',
      taskRole: 'start',
      taskStatus: 'ready',
    },
  });

  const taskNode = createTaskNode({
    id: 'task-flow-task-node',
    x: 360,
    y: 156,
    label: '核心任务',
    data: {
      taskDescription: '双击后编辑任务内容',
    },
  });

  const finishNode = createNodeMetadata('ellipse', {
    id: 'task-flow-finish-node',
    x: 660,
    y: 170,
    width: 136,
    height: 64,
    label: '完成',
    data: {
      preset: 'ellipse',
      taskRole: 'finish',
      taskStatus: 'ready',
    },
  });

  const edges = [
    createEdgeMetadata({
      id: 'task-flow-edge-1',
      source: { cell: startNode.id, port: 'port-right' },
      target: { cell: taskNode.id, port: 'port-left' },
    }),
    createEdgeMetadata({
      id: 'task-flow-edge-2',
      source: { cell: taskNode.id, port: 'port-right' },
      target: { cell: finishNode.id, port: 'port-left' },
    }),
  ];

  return {
    cells: [startNode, taskNode, finishNode, ...edges],
    nodes: [startNode, taskNode, finishNode],
    edges,
    blueprintMeta: {
      anchor: { x: 480, y: 240 },
      kind: TASK_FLOW_KIND,
    },
  };
}

function normalizeNode(node: CellData): CellData {
  const preset = (node.data?.preset as NodePreset | undefined)
    ?? (node.shape === 'ellipse'
      ? 'ellipse'
      : node.shape === 'polygon'
        ? 'diamond'
        : node.attrs?.body?.rx
        ? 'round'
        : 'rect');
  const position = getCellPosition(node);
  const nodeSize = getCellSize(node);
  if (preset === 'umlClass') {
    const definition = normalizeUmlModel({ classes: [node.data?.umlDefinition ?? {
      id: node.data?.umlClassId,
      name: extractNodeLabel(node).split('\n')[0],
      attributes: [],
      methods: [],
      nodeId: node.id,
    }] }).classes[0];
    const base = createUmlClassNode(definition, {
      id: node.id,
      x: position.x,
      y: position.y,
      width: nodeSize.width,
      height: nodeSize.height,
      data: {
        ...node.data,
        umlClassId: definition.id,
      },
    });
    return {
      ...base,
      ...node,
      x: position.x,
      y: position.y,
      width: nodeSize.width ?? base.width,
      height: nodeSize.height ?? base.height,
      position: {
        ...(isPlainObject(node.position) ? node.position : {}),
        x: position.x,
        y: position.y,
      },
      size: {
        ...(isPlainObject(node.size) ? node.size : {}),
        width: nodeSize.width ?? base.width,
        height: nodeSize.height ?? base.height,
      },
      attrs: mergeDeep(base.attrs, node.attrs ?? {}),
      ports: node.ports ?? base.ports,
    };
  }

  const base = createNodeMetadata(preset, {
    id: node.id,
    x: position.x,
    y: position.y,
    width: nodeSize.width,
    height: nodeSize.height,
    label: extractNodeLabel(node),
    data: node.data,
  });

  return {
    ...base,
    ...node,
    x: position.x,
    y: position.y,
    width: nodeSize.width ?? base.width,
    height: nodeSize.height ?? base.height,
    position: {
      ...(isPlainObject(node.position) ? node.position : {}),
      x: position.x,
      y: position.y,
    },
    size: {
      ...(isPlainObject(node.size) ? node.size : {}),
      width: nodeSize.width ?? base.width,
      height: nodeSize.height ?? base.height,
    },
    attrs: mergeDeep(base.attrs, node.attrs ?? {}),
    ports: node.ports ?? base.ports,
  };
}

function normalizeEdge(edge: CellData): CellData {
  const base = createEdgeMetadata(edge);
  const router = edge.router;
  const routerName = typeof router === 'string' ? router : router?.name;
  return {
    ...base,
    ...edge,
    router: routerName === 'manhattan' ? { name: 'orth' } : (router ?? base.router),
    attrs: mergeDeep(base.attrs, edge.attrs ?? {}),
  };
}

function normalizeGraphData(data?: GraphData): GraphData {
  if (data == null) {
    return createStarterGraphData();
  }

  if (data.blueprintMeta?.kind === TASK_FLOW_KIND && !(Array.isArray(data.cells) || data.nodes?.length || data.edges?.length)) {
    return createTaskFlowStarterGraphData();
  }

  if (Array.isArray(data.cells)) {
    const cells = data.cells.map((cell) =>
      cell.shape === 'edge' || cell.source || cell.target ? normalizeEdge(cell) : normalizeNode(cell),
    );
    return {
      ...data,
      cells,
      nodes: cells.filter((cell) => !(cell.shape === 'edge' || cell.source || cell.target)),
      edges: cells.filter((cell) => cell.shape === 'edge' || cell.source || cell.target),
    };
  }

  const nodes = (data.nodes ?? []).map((node) => normalizeNode(node));
  const edges = (data.edges ?? []).map((edge) => normalizeEdge(edge));
  return {
    ...data,
    cells: [...nodes, ...edges],
    nodes,
    edges,
  };
}

function getGraphSnapshot(data?: GraphData) {
  return JSON.stringify(normalizeGraphData(data));
}

function serializeGraphData(): GraphData {
  if (!graph) {
    return { cells: [], nodes: [], edges: [], uml: objectModelStore.model };
  }

  const nodes = graph.getNodes().map((node) => node.toJSON() as CellData);
  const edges = graph.getEdges().map((edge) => edge.toJSON() as CellData);
  return {
    cells: graph.toJSON().cells as CellData[],
    nodes,
    edges,
    uml: objectModelStore.model,
  };
}

function emitGraphData() {
  if (!graph || isApplyingExternalData) return;
  const payload = normalizeGraphData(serializeGraphData());
  const snapshot = JSON.stringify(payload);
  if (snapshot === lastSerializedSnapshot) return;
  lastSerializedSnapshot = snapshot;
  emit('graph-data-change', payload);
}

function updateUndoRedoState() {
  if (!graph) return;
  canUndo.value = graph.canUndo();
  canRedo.value = graph.canRedo();
  zoomPercent.value = Math.round(graph.zoom() * 100);
}

function getNodeLabel(node: Node) {
  const value = node.attr('label/text');
  return typeof value === 'string' ? value : '';
}

function isNodeSoleSelected(node: Node) {
  const cells = graph?.getSelectedCells() ?? [];
  return cells.length === 1 && cells[0].id === node.id;
}

function getEdgeLabel(edge: Edge) {
  const labels = edge.getLabels();
  if (!labels.length) return '';
  const label = labels[0] as Record<string, any>;
  return typeof label === 'string' ? label : (label?.attrs?.label?.text ?? '');
}

function setEdgeLabel(edge: Edge, text: string) {
  if (!text.trim()) {
    edge.setLabels([]);
    return;
  }

  edge.setLabels([
    {
      attrs: {
        label: {
          text,
          fill: '#52616b',
          fontSize: 12,
        },
      },
    },
  ]);
}

// --- Node overlay helpers ---

function getNodeOverlayStyle(node: Node): Record<string, string> {
  if (!graph || !stageRef.value) return {};
  const bbox = node.getBBox();
  const zoom = graph.zoom();
  const { tx, ty } = graph.translate();
  const left = bbox.x * zoom + tx;
  const top = bbox.y * zoom + ty;
  const width = bbox.width * zoom;
  const height = bbox.height * zoom;
  return {
    position: 'absolute',
    left: `${left}px`,
    top: `${top}px`,
    width: `${width}px`,
    height: `${height}px`,
    zIndex: '1000',
    fontSize: `${Math.max(12, 14 * zoom)}px`,
  };
}

function getGraphSourceRegionLabel(kind: string): string {
  if (kind === 'knowledge-base-pages') return '知识库路线图';
  if (kind === 'selection-blueprint') return '蓝图';
  if (kind === 'knowledge-roadmap') return '知识库路线图';
  if (kind === 'blueprint') return '蓝图';
  if (kind === TASK_FLOW_KIND) return '任务流';
  return kind;
}

function updateGraphSourceRegion() {
  const kind = props.graphSourceKind ?? props.graphData?.blueprintMeta?.kind;
  if (!graph || !kind) {
    graphSourceRegion.value = null;
    return;
  }

  const nodes = graph.getNodes();
  if (nodes.length === 0) {
    graphSourceRegion.value = null;
    return;
  }

  const zoom = graph.zoom();
  const { tx, ty } = graph.translate();
  const boxes = nodes.map((node) => node.getBBox());
  const minX = Math.min(...boxes.map((box) => box.x));
  const minY = Math.min(...boxes.map((box) => box.y));
  const maxX = Math.max(...boxes.map((box) => box.x + box.width));
  const maxY = Math.max(...boxes.map((box) => box.y + box.height));
  const padding = 28;

  graphSourceRegion.value = {
    kind,
    label: getGraphSourceRegionLabel(kind),
    style: {
      left: `${(minX - padding) * zoom + tx}px`,
      top: `${(minY - padding) * zoom + ty}px`,
      width: `${(maxX - minX + padding * 2) * zoom}px`,
      height: `${(maxY - minY + padding * 2) * zoom}px`,
    },
  };
}

function updateNodeOverlays() {
  if (!graph) {
    nodeOverlays.value = [];
    graphSourceRegion.value = null;
    return;
  }
  nodeOverlays.value = graph.getNodes().map(node => {
    const data = node.getData<Record<string, any>>() ?? {};
    return {
      id: node.id,
      style: getNodeOverlayStyle(node),
      textMode: (data.textMode ?? 'plain') as 'plain' | 'rich',
      label: getNodeLabel(node),
      richContent: data.richContent ?? '',
    };
  });
  updateGraphSourceRegion();
}

// Handlers called by X6NodeOverlay emit events

function handleNodeOverlayCommit(nodeId: string, text: string) {
  const node = graph?.getCellById(nodeId);
  if (node && graph?.isNode(node)) {
    node.attr('label/text', text);
    node.attr('label/visibility', 'visible');
  }
  suppressNextNodeInternalClickId = nodeId;
  editingNodeId.value = null;
  graph?.enablePanning();
  graph?.enableSelection();
  updateNodeOverlays();
  scheduleSync();
}

function handleNodeOverlayCancel(nodeId: string) {
  const node = graph?.getCellById(nodeId);
  if (node && graph?.isNode(node)) {
    const data = node.getData<Record<string, any>>() ?? {};
    if (data.textMode !== 'rich') {
      node.attr('label/visibility', 'visible');
    }
  }
  suppressNextNodeInternalClickId = nodeId;
  editingNodeId.value = null;
  pendingNodeInternalClickId = null;
  graph?.enablePanning();
  graph?.enableSelection();
}

function handleRichChange(nodeId: string, markdown: string) {
  const node = graph?.getCellById(nodeId);
  if (node && graph?.isNode(node)) {
    node.updateData({ richContent: markdown });
  }
  scheduleSync();
}

function setNodeOverlayRef(el: unknown, nodeId: string) {
  if (el) {
    nodeOverlayRefs.value[nodeId] = el as {
      getMarkdownLinkAnchor?: () => { top: number; left: number } | undefined;
      insertMarkdownLink?: (label: string, url: string, display?: 'link' | 'image') => boolean;
      updateInsertedLinkDisplay?: (display: 'link' | 'image') => boolean;
      updateInsertedImageWidth?: (widthPercent: number) => boolean;
    };
  } else {
    delete nodeOverlayRefs.value[nodeId];
  }
}

function insertMarkdownLink(label: string, url: string, display: 'link' | 'image' = 'link'): boolean {
  if (!isEditable.value || !editingNodeId.value) return false;
  return nodeOverlayRefs.value[editingNodeId.value]?.insertMarkdownLink?.(label, url, display) ?? false;
}

function getMarkdownLinkAnchor(): { top: number; left: number } | undefined {
  if (!isEditable.value || !editingNodeId.value) return undefined;
  return nodeOverlayRefs.value[editingNodeId.value]?.getMarkdownLinkAnchor?.();
}

function updateInsertedLinkDisplay(display: 'link' | 'image'): boolean {
  if (!isEditable.value || !editingNodeId.value) return false;
  return nodeOverlayRefs.value[editingNodeId.value]?.updateInsertedLinkDisplay?.(display) ?? false;
}

function updateInsertedImageWidth(widthPercent: number): boolean {
  if (!isEditable.value || !editingNodeId.value) return false;
  return nodeOverlayRefs.value[editingNodeId.value]?.updateInsertedImageWidth?.(widthPercent) ?? false;
}

// --- Edge inline editing helpers ---

function getEdgeOverlayStyle(edge: Edge): Record<string, string> {
  if (!graph || !stageRef.value) return {};
  const zoom = graph.zoom();
  const { tx, ty } = graph.translate();

  const sourceNode = edge.getSourceNode();
  const targetNode = edge.getTargetNode();
  let midX = 0, midY = 0;

  if (sourceNode && targetNode) {
    const sBBox = sourceNode.getBBox();
    const tBBox = targetNode.getBBox();
    midX = (sBBox.x + sBBox.width / 2 + tBBox.x + tBBox.width / 2) / 2;
    midY = (sBBox.y + sBBox.height / 2 + tBBox.y + tBBox.height / 2) / 2;
  }

  const edgeWidth = 160;
  const edgeHeight = 40;
  return {
    position: 'absolute',
    left: `${midX * zoom + tx - edgeWidth / 2}px`,
    top: `${midY * zoom + ty - edgeHeight / 2}px`,
    width: `${edgeWidth}px`,
    height: `${edgeHeight}px`,
    zIndex: '1000',
    fontSize: `${Math.max(11, 12 * zoom)}px`,
  };
}

function commitEdgeInlineEdit() {
  if (!graph || !edgeInlineEditId.value) return;
  const edge = graph.getCellById(edgeInlineEditId.value);
  if (edge && graph.isEdge(edge)) {
    setEdgeLabel(edge, edgeInlineEditText.value);
  }
  edgeInlineEditing.value = false;
  edgeInlineEditId.value = null;
  graph.enablePanning();
  graph.enableSelection();
  scheduleSync();
}

function cancelEdgeInlineEdit() {
  edgeInlineEditing.value = false;
  edgeInlineEditId.value = null;
  if (graph) {
    graph.enablePanning();
    graph.enableSelection();
  }
}

function handleEdgeEditKeydown(e: KeyboardEvent) {
  e.stopPropagation();
  if (e.key === 'Escape') {
    e.preventDefault();
    cancelEdgeInlineEdit();
  } else if (e.key === 'Enter' && !e.ctrlKey && !e.metaKey && !e.shiftKey) {
    e.preventDefault();
    commitEdgeInlineEdit();
  }
}

// --- Text mode toggle ---

function toggleNodeTextMode(mode: 'plain' | 'rich') {
  if (!graph || !selectedCell.value || selectedCell.value.kind !== 'node') return;
  const node = graph.getCellById(selectedCell.value.id);
  if (!node || !graph.isNode(node)) return;

  const currentData = node.getData<Record<string, any>>() ?? {};

  if (mode === 'rich' && currentData.textMode !== 'rich') {
    const plainText = getNodeLabel(node);
    node.updateData({
      textMode: 'rich',
      richContent: currentData.richContent || plainText,
    });
    node.attr('label/visibility', 'hidden');
  } else if (mode === 'plain' && currentData.textMode !== 'plain') {
    node.updateData({ textMode: 'plain' });
    node.attr('label/visibility', 'visible');
  }

  refreshSelectedCellState();
  scheduleSync();
  updateNodeOverlays();
}

function refreshSelectedCellState() {
  if (!graph) return;

  const cells = graph.getSelectedCells();
  selectedCellsCount.value = cells.length;
  selectedCell.value = null;

  if (cells.length === 1) {
    const [cell] = cells;

    if (graph.isNode(cell)) {
      const size = cell.getSize();
      const nodeData = cell.getData<Record<string, any>>() ?? {};
      selectedCell.value = {
        kind: 'node',
        id: cell.id,
        shape: cell.shape,
        label: getNodeLabel(cell),
        fill: (cell.attr('body/fill') as string) || '#ffffff',
        stroke: (cell.attr('body/stroke') as string) || '#1677ff',
        width: size.width,
        height: size.height,
        textMode: nodeData.textMode ?? 'plain',
        richContent: nodeData.richContent ?? '',
      };
    } else if (graph.isEdge(cell)) {
      const router = cell.getRouter();
      const connector = cell.getConnector();
      selectedCell.value = {
        kind: 'edge',
        id: cell.id,
        label: getEdgeLabel(cell),
        stroke: (cell.attr('line/stroke') as string) || '#52616b',
        router: typeof router === 'string' ? router : (router?.name ?? 'orth'),
        connector: typeof connector === 'string' ? connector : (connector?.name ?? 'rounded'),
      };
    }
  }

  updateUndoRedoState();
}

function scheduleSync() {
  if (!graph || isApplyingExternalData) return;

  refreshSelectedCellState();

  if (isUserInteracting) {
    pendingSyncAfterInteraction = true;
    if (syncTimer !== null) {
      window.clearTimeout(syncTimer);
      syncTimer = null;
    }
    return;
  }

  if (syncTimer !== null) {
    window.clearTimeout(syncTimer);
  }

  syncTimer = window.setTimeout(() => {
    syncTimer = null;
    if (isUserInteracting) {
      pendingSyncAfterInteraction = true;
      return;
    }
    emitGraphData();
  }, 120);
}

function startUserInteraction() {
  isUserInteracting = true;
  if (syncTimer !== null) {
    window.clearTimeout(syncTimer);
    syncTimer = null;
  }
}

function finishUserInteraction() {
  const shouldSync = pendingSyncAfterInteraction;
  isUserInteracting = false;
  pendingSyncAfterInteraction = false;

  if (shouldSync) {
    refreshSelectedCellState();
    emitGraphData();
    return;
  }

  refreshSelectedCellState();
}

function applyGraphData(data?: GraphData, fitView = false) {
  if (!graph) return;

  const normalized = normalizeGraphData(data);
  const incomingUml = (data as Record<string, any> | undefined)?.uml;
  if (incomingUml) {
    objectModelStore.replaceModel(incomingUml);
  }
  const snapshot = JSON.stringify(normalized);
  if (snapshot === lastSerializedSnapshot) {
    refreshSelectedCellState();
    return;
  }

  isApplyingExternalData = true;
  isUserInteracting = false;
  pendingSyncAfterInteraction = false;
  if (syncTimer !== null) {
    window.clearTimeout(syncTimer);
    syncTimer = null;
  }
  lastSerializedSnapshot = snapshot;
  graph.fromJSON({ cells: normalized.cells ?? [] });
  graph.cleanSelection();
  syncTaskFlowEdgeState();

  // Hide SVG labels for rich-text nodes after loading
  graph.getNodes().forEach(n => {
    const d = n.getData<Record<string, any>>() ?? {};
    if (d.textMode === 'rich') {
      n.attr('label/visibility', 'hidden');
    }
  });

  refreshSelectedCellState();
  updateNodeOverlays();

  nextTick(() => {
    if (!graph) return;
    if (fitView) {
      if (graph.getCellCount() > 0) {
        graph.zoomToFit({ padding: 24, maxScale: 1 });
        graph.centerContent();
      } else {
        graph.zoomTo(1);
      }
    }
    isApplyingExternalData = false;
  });
}

function getCanvasCenter() {
  if (!graph || !stageRef.value) return { x: 120, y: 120 };
  const rect = stageRef.value.getBoundingClientRect();
  const point = graph.clientToLocal(rect.left + rect.width / 2, rect.top + rect.height / 2);
  return {
    x: Math.max(40, point.x - 80),
    y: Math.max(40, point.y - 32),
  };
}

function getSelectionBounds(cells: Array<Node | Edge>) {
  if (!cells.length) return null;

  const boxes: Array<{ x: number; y: number; width: number; height: number }> = [];

  cells.forEach((cell) => {
    try {
      const box = cell.getBBox();
      boxes.push({
        x: box.x,
        y: box.y,
        width: box.width,
        height: box.height,
      });
    } catch {
      // ignore cells that cannot provide a usable bounding box
    }
  });

  if (!boxes.length) return null;

  const minX = Math.min(...boxes.map((box) => box.x));
  const minY = Math.min(...boxes.map((box) => box.y));
  const maxX = Math.max(...boxes.map((box) => box.x + box.width));
  const maxY = Math.max(...boxes.map((box) => box.y + box.height));

  return {
    minX,
    minY,
    maxX,
    maxY,
    width: maxX - minX,
    height: maxY - minY,
  };
}

function offsetCellPosition(cell: CellData, offsetX: number, offsetY: number): CellData {
  const nextCell = JSON.parse(JSON.stringify(cell)) as CellData;

  if (typeof nextCell.x === 'number') {
    nextCell.x += offsetX;
  }
  if (isPlainObject(nextCell.position)) {
    nextCell.position = {
      ...nextCell.position,
      ...(typeof nextCell.position.x === 'number' ? { x: nextCell.position.x + offsetX } : {}),
      ...(typeof nextCell.position.y === 'number' ? { y: nextCell.position.y + offsetY } : {}),
    };
  }
  if (typeof nextCell.style?.x === 'number') {
    nextCell.style.x += offsetX;
  }

  if (typeof nextCell.y === 'number') {
    nextCell.y += offsetY;
  }
  if (typeof nextCell.style?.y === 'number') {
    nextCell.style.y += offsetY;
  }

  if (Array.isArray(nextCell.vertices)) {
    nextCell.vertices = nextCell.vertices.map((vertex: Record<string, any>) => ({
      ...vertex,
      ...(typeof vertex.x === 'number' ? { x: vertex.x + offsetX } : {}),
      ...(typeof vertex.y === 'number' ? { y: vertex.y + offsetY } : {}),
    }));
  }

  if (Array.isArray(nextCell.labels)) {
    nextCell.labels = nextCell.labels.map((label: Record<string, any>) => {
      if (!label || typeof label !== 'object') return label;
      const nextLabel = { ...label };
      if (typeof nextLabel.offset === 'object' && nextLabel.offset) {
        nextLabel.offset = {
          ...nextLabel.offset,
          ...(typeof nextLabel.offset.x === 'number' ? { x: nextLabel.offset.x + offsetX } : {}),
          ...(typeof nextLabel.offset.y === 'number' ? { y: nextLabel.offset.y + offsetY } : {}),
        };
      }
      return nextLabel;
    });
  }

  const translateTerminal = (terminal: unknown) => {
    if (!terminal || typeof terminal !== 'object') return terminal;
    const nextTerminal = terminal as Record<string, any>;
    if (typeof nextTerminal.cell === 'string') return nextTerminal;

    return {
      ...nextTerminal,
      ...(typeof nextTerminal.x === 'number' ? { x: nextTerminal.x + offsetX } : {}),
      ...(typeof nextTerminal.y === 'number' ? { y: nextTerminal.y + offsetY } : {}),
    };
  };

  if (nextCell.source) {
    nextCell.source = translateTerminal(nextCell.source);
  }

  if (nextCell.target) {
    nextCell.target = translateTerminal(nextCell.target);
  }

  return nextCell;
}

function buildExtractedSelectionGraphData(): ExtractedGraphSelectionPayload | null {
  if (!graph) return null;

  const selectedCells = graph.getSelectedCells();
  if (!selectedCells.length) return null;

  const selectedNodesMap = new Map<string, Node>();
  const selectedEdgesMap = new Map<string, Edge>();

  selectedCells.forEach((cell) => {
    if (graph?.isNode(cell)) {
      selectedNodesMap.set(cell.id, cell);
      return;
    }

    if (graph?.isEdge(cell)) {
      selectedEdgesMap.set(cell.id, cell);
      const sourceNode = cell.getSourceNode();
      const targetNode = cell.getTargetNode();
      if (sourceNode) selectedNodesMap.set(sourceNode.id, sourceNode);
      if (targetNode) selectedNodesMap.set(targetNode.id, targetNode);
    }
  });

  const selectedNodeIds = new Set(selectedNodesMap.keys());

  graph.getEdges().forEach((edge) => {
    const sourceNode = edge.getSourceNode();
    const targetNode = edge.getTargetNode();
    if (!sourceNode || !targetNode) return;
    if (!selectedNodeIds.has(sourceNode.id) || !selectedNodeIds.has(targetNode.id)) return;
    selectedEdgesMap.set(edge.id, edge);
  });

  const selectedNodes = Array.from(selectedNodesMap.values());
  const selectedEdges = Array.from(selectedEdgesMap.values()).filter((edge) => {
    const sourceNode = edge.getSourceNode();
    const targetNode = edge.getTargetNode();
    if (!sourceNode || !targetNode) return false;
    return selectedNodeIds.has(sourceNode.id) && selectedNodeIds.has(targetNode.id);
  });

  if (!selectedNodes.length) return null;

  const bounds = getSelectionBounds(selectedNodes);
  const anchorX = bounds ? bounds.minX : BLUEPRINT_ANCHOR.x;
  const anchorY = bounds ? bounds.minY : BLUEPRINT_ANCHOR.y;
  const offsetX = BLUEPRINT_ANCHOR.x - anchorX;
  const offsetY = BLUEPRINT_ANCHOR.y - anchorY;

  const nodes = selectedNodes.map((node) => offsetCellPosition(node.toJSON() as CellData, offsetX, offsetY));
  const edges = selectedEdges.map((edge) => offsetCellPosition(edge.toJSON() as CellData, offsetX, offsetY));

  const offsetBounds = {
    minX: (bounds?.minX ?? BLUEPRINT_ANCHOR.x) + offsetX,
    minY: (bounds?.minY ?? BLUEPRINT_ANCHOR.y) + offsetY,
    maxX: (bounds?.maxX ?? BLUEPRINT_ANCHOR.x) + offsetX,
    maxY: (bounds?.maxY ?? BLUEPRINT_ANCHOR.y) + offsetY,
    width: bounds?.width ?? 0,
    height: bounds?.height ?? 0,
  };

  return {
    count: selectedCells.length,
    graphData: normalizeGraphData({
      cells: [...nodes, ...edges],
      nodes,
      edges,
      blueprintMeta: {
        anchor: {
          x: BLUEPRINT_ANCHOR.x,
          y: BLUEPRINT_ANCHOR.y,
        },
        extractedCenter: {
          x: offsetBounds.minX + offsetBounds.width / 2,
          y: offsetBounds.minY + offsetBounds.height / 2,
        },
        extractedCount: selectedCells.length,
        kind: 'blueprint',
      },
    }),
  };
}

function getRefInsertPosition() {
  if (!graph) return getCanvasCenter();

  const currentGraph = graph;
  const selectedCells = currentGraph.getSelectedCells();
  const bounds = getSelectionBounds(selectedCells.filter((cell): cell is Node | Edge => currentGraph.isNode(cell) || currentGraph.isEdge(cell)));
  if (!bounds) return getCanvasCenter();

  return {
    x: bounds.maxX + 48,
    y: bounds.minY + Math.max(0, bounds.height / 2 - 32),
  };
}

function addNode(preset: NodePreset, position?: { x: number; y: number }) {
  if (!graph || !isEditable.value) return;
  const center = position ?? getCanvasCenter();
  const node = graph.addNode(
    isTaskFlow.value
      ? createTaskNode({
        x: center.x,
        y: center.y,
      })
      : createNodeMetadata(preset, {
        x: center.x,
        y: center.y,
      }),
  );
  graph.cleanSelection();
  graph.select(node);
  refreshSelectedCellState();
  scheduleSync();
}

function canCreateTaskFlowEdge(sourceCell: Node, targetCell: Node) {
  if (!graph || !isTaskFlow.value) return true;
  if (sourceCell.id === targetCell.id) return false;

  const sourceRole = sourceCell.getData<Record<string, any>>()?.taskRole;
  const targetRole = targetCell.getData<Record<string, any>>()?.taskRole;
  if (!sourceRole || !targetRole) return false;
  if (sourceRole === 'finish' || targetRole === 'start') return false;

  const outgoing = graph.getOutgoingEdges(sourceCell) ?? [];
  const incoming = graph.getIncomingEdges(targetCell) ?? [];
  return outgoing.length === 0 && incoming.length === 0;
}

function syncTaskFlowEdgeState() {
  if (!graph || !isTaskFlow.value) return;
  graph.getEdges().forEach((edge) => {
    edge.setLabels([]);
    edge.attr({
      line: {
        stroke: '#c97a00',
        strokeWidth: 2.4,
        targetMarker: {
          name: 'block',
          width: 10,
          height: 8,
        },
      },
    });
  });
}

function deleteSelection() {
  if (!graph || !isEditable.value) return;
  const cells = graph.getSelectedCells();
  if (!cells.length) return;
  graph.removeCells(cells);
  graph.cleanSelection();
  refreshSelectedCellState();
  scheduleSync();
}

function duplicateSelection() {
  if (!graph || !isEditable.value) return;
  const cells = graph.getSelectedCells();
  if (!cells.length) return;

  const clones = Object.values(graph.cloneCells(cells));
  clones.forEach((cell) => {
    if (graph?.isNode(cell)) {
      cell.translate(32, 32);
    }
  });
  graph.addCell(clones);
  graph.resetSelection(clones);
  refreshSelectedCellState();
  scheduleSync();
}

function copySelection() {
  if (!graph) return;
  const cells = graph.getSelectedCells();
  if (!cells.length) return;
  graph.copy(cells);
}

function pasteSelection() {
  if (!graph || !isEditable.value) return;
  const pasted = graph.paste({ offset: { dx: 32, dy: 32 } });
  if (!pasted.length) return;
  graph.resetSelection(pasted);
  refreshSelectedCellState();
  scheduleSync();
}

function extractSelectionAsBlock() {
  if (!graph || !props.blockActionsEnabled) return;
  const payload = buildExtractedSelectionGraphData();
  if (!payload) return;
  emit('extract-selection', payload);
}

function requestInsertRefBlock() {
  if (!graph || !isEditable.value || !props.blockActionsEnabled) return;
  const position = getRefInsertPosition();
  emit('request-insert-ref', position);
}

function syncFromSource() {
  emit('sync-from-source');
}

function syncToSource() {
  if (!graph) return;
  emit('sync-to-source', normalizeGraphData(serializeGraphData()));
}

function clearCanvas() {
  if (!graph || !isEditable.value) return;
  if (!window.confirm('确认清空当前图形吗？')) return;
  graph.clearCells();
  graph.cleanSelection();
  refreshSelectedCellState();
  scheduleSync();
}

function undo() {
  if (!graph || !canUndo.value) return;
  graph.undo();
  refreshSelectedCellState();
  scheduleSync();
}

function redo() {
  if (!graph || !canRedo.value) return;
  graph.redo();
  refreshSelectedCellState();
  scheduleSync();
}

function zoomIn() {
  if (!graph) return;
  graph.zoom(0.1);
  updateUndoRedoState();
}

function zoomOut() {
  if (!graph) return;
  graph.zoom(-0.1);
  updateUndoRedoState();
}

function resetZoom() {
  if (!graph) return;
  graph.zoomTo(1);
  graph.centerContent();
  updateUndoRedoState();
}

function fitGraph() {
  if (!graph) return;
  if (graph.getCellCount() > 0) {
    graph.zoomToFit({ padding: 24, maxScale: 1 });
    graph.centerContent();
  } else {
    graph.zoomTo(1);
  }
  updateUndoRedoState();
}

function toggleGrid() {
  if (!graph) return;
  gridVisible.value = !gridVisible.value;
  if (gridVisible.value) {
    graph.showGrid();
  } else {
    graph.hideGrid();
  }
}

function centerGraph() {
  if (!graph) return;
  graph.centerContent();
}

function updateSelectedNodeLabel(value: string) {
  if (!graph || !selectedCell.value || selectedCell.value.kind !== 'node') return;
  const node = graph.getCellById(selectedCell.value.id);
  if (!node || !graph.isNode(node)) return;
  const nodeData = node.getData<Record<string, any>>() ?? {};
  node.attr('label/text', value);
  if (nodeData.taskRole === 'task') {
    const description = typeof nodeData.taskDescription === 'string' ? nodeData.taskDescription : '连接上下游任务';
    node.updateData({
      ...nodeData,
      label: value,
      taskDescription: description,
    });
    node.attr('label/text', `${value}\n${description}`);
  }
  scheduleSync();
}

function updateSelectedNodeFill(value: string) {
  if (!graph || !selectedCell.value || selectedCell.value.kind !== 'node') return;
  const node = graph.getCellById(selectedCell.value.id);
  if (!node || !graph.isNode(node)) return;
  node.attr('body/fill', value);
  scheduleSync();
}

function updateSelectedNodeStroke(value: string) {
  if (!graph || !selectedCell.value || selectedCell.value.kind !== 'node') return;
  const node = graph.getCellById(selectedCell.value.id);
  if (!node || !graph.isNode(node)) return;
  node.attr('body/stroke', value);
  scheduleSync();
}

function updateSelectedNodeSize(key: 'width' | 'height', rawValue: string) {
  if (!graph || !selectedCell.value || selectedCell.value.kind !== 'node') return;
  const node = graph.getCellById(selectedCell.value.id);
  if (!node || !graph.isNode(node)) return;

  const value = Number(rawValue);
  if (!Number.isFinite(value) || value < 40) return;

  const size = node.getSize();
  node.resize(key === 'width' ? value : size.width, key === 'height' ? value : size.height);
  scheduleSync();
}

function updateSelectedEdgeLabel(value: string) {
  if (!graph || !selectedCell.value || selectedCell.value.kind !== 'edge') return;
  const edge = graph.getCellById(selectedCell.value.id);
  if (!edge || !graph.isEdge(edge)) return;
  setEdgeLabel(edge, value);
  scheduleSync();
}

function updateSelectedEdgeStroke(value: string) {
  if (!graph || !selectedCell.value || selectedCell.value.kind !== 'edge') return;
  const edge = graph.getCellById(selectedCell.value.id);
  if (!edge || !graph.isEdge(edge)) return;
  edge.attr('line/stroke', value);
  scheduleSync();
}

function updateSelectedEdgeRouter(value: string) {
  if (!graph || !selectedCell.value || selectedCell.value.kind !== 'edge') return;
  const edge = graph.getCellById(selectedCell.value.id);
  if (!edge || !graph.isEdge(edge)) return;
  edge.setRouter(value === 'manhattan' ? 'orth' : value, {});
  scheduleSync();
}

function updateSelectedEdgeConnector(value: string) {
  if (!graph || !selectedCell.value || selectedCell.value.kind !== 'edge') return;
  const edge = graph.getCellById(selectedCell.value.id);
  if (!edge || !graph.isEdge(edge)) return;
  edge.setConnector(value);
  scheduleSync();
}

function syncUmlClassNode(definition: UmlClassDefinition) {
  if (!graph) return;
  const nodeId = definition.nodeId;
  const existingNode = nodeId ? graph.getCellById(nodeId) : null;
  if (existingNode && graph.isNode(existingNode)) {
    existingNode.attr('label/text', formatUmlClassLabel(definition));
    existingNode.updateData({
      preset: 'umlClass',
      umlClassId: definition.id,
      umlDefinition: definition,
    });
    return;
  }

  const center = getCanvasCenter();
  const node = graph.addNode(createUmlClassNode(definition, {
    x: center.x,
    y: center.y,
    data: {
      umlClassId: definition.id,
      umlDefinition: definition,
    },
  }));
  definition.nodeId = node.id;
  graph.cleanSelection();
  graph.select(node);
}

function syncAllUmlClassNodes() {
  objectModelStore.classes.forEach(syncUmlClassNode);
  updateNodeOverlays();
  scheduleSync();
}

function insertUmlClassPreset() {
  if (!isEditable.value) return;
  const userClass: UmlClassDefinition = {
    id: createId('uml-class'),
    name: 'User',
    attributes: ['id: string', 'name: string', 'email: string'],
    methods: ['login(): void', 'logout(): void'],
  };
  const orderClass: UmlClassDefinition = {
    id: createId('uml-class'),
    name: 'Order',
    attributes: ['id: string', 'createdAt: Date', 'status: OrderStatus'],
    methods: ['submit(): void', 'cancel(): void'],
  };
  const classNodes = [
    createUmlClassNode(userClass, { x: 160, y: 120, data: { umlClassId: userClass.id, umlDefinition: userClass } }),
    createUmlClassNode(orderClass, { x: 460, y: 120, data: { umlClassId: orderClass.id, umlDefinition: orderClass } }),
  ];
  userClass.nodeId = classNodes[0].id;
  orderClass.nodeId = classNodes[1].id;
  const relation = createEdgeMetadata({
    id: createId('uml-edge'),
    source: { cell: userClass.nodeId, port: 'port-right' },
    target: { cell: orderClass.nodeId, port: 'port-left' },
    labels: [{ attrs: { label: { text: '1  creates  *', fill: '#31511e', fontSize: 12 } } }],
    attrs: {
      line: {
        stroke: '#31511e',
        strokeDasharray: '',
      },
    },
  });
  const userNode = graph?.addNode(classNodes[0]);
  const orderNode = graph?.addNode(classNodes[1]);
  if (userNode && orderNode) {
    graph?.addEdge(relation);
  }
  objectModelStore.upsertClass(userClass);
  objectModelStore.upsertClass(orderClass);
  objectModelStore.upsertObject({
    name: 'currentUser',
    classId: userClass.id,
    propertyValues: {
      id: 'u-001',
      name: 'Alice',
      email: 'alice@example.com',
    },
  });
  scheduleSync();
}

function editNodeLabel(node: Node) {
  if (!isEditable.value || !graph) return;
  emit('active');
  if (editingNodeId.value === node.id) return;

  const data = node.getData<Record<string, any>>() ?? {};
  if (data.textMode !== 'rich') {
    node.attr('label/visibility', 'hidden');
  }
  graph.disablePanning();
  graph.disableSelection();
  editingNodeId.value = node.id;
  updateNodeOverlays();
}

function tryHandleNodeInternalClick(node: Node) {
  if (!isEditable.value || editingNodeId.value != null) return;
  if (suppressNextNodeInternalClickId === node.id) {
    suppressNextNodeInternalClickId = null;
    return;
  }
  editNodeLabel(node);
}

function editEdgeLabel(edge: Edge) {
  if (!isEditable.value || !graph) return;

  edgeInlineEditId.value = edge.id;
  edgeInlineEditText.value = getEdgeLabel(edge);
  edgeInlineEditStyle.value = getEdgeOverlayStyle(edge);
  edgeInlineEditing.value = true;

  graph.disablePanning();
  graph.disableSelection();

  nextTick(() => {
    edgeInlineInputRef.value?.focus();
    edgeInlineInputRef.value?.select();
  });
}

function resizeGraph() {
  if (!graph || !stageRef.value) return;
  const width = stageRef.value.clientWidth || props.width;
  const height = stageRef.value.clientHeight || props.height;
  graph.resize(width, height);
  updateUndoRedoState();
  updateNodeOverlays();
}

function bindKeyboardShortcuts() {
  if (!graph || !isEditable.value) return;

  graph.bindKey(['backspace', 'delete'], () => {
    deleteSelection();
    return false;
  });

  graph.bindKey(['ctrl+c', 'meta+c'], () => {
    copySelection();
    return false;
  });

  graph.bindKey(['ctrl+v', 'meta+v'], () => {
    pasteSelection();
    return false;
  });

  graph.bindKey(['ctrl+d', 'meta+d'], () => {
    duplicateSelection();
    return false;
  });

  if (props.blockActionsEnabled) {
    graph.bindKey(['ctrl+shift+e', 'meta+shift+e'], () => {
      extractSelectionAsBlock();
      return false;
    });
  }

  graph.bindKey(['ctrl+z', 'meta+z'], () => {
    undo();
    return false;
  });

  graph.bindKey(['ctrl+y', 'meta+y', 'ctrl+shift+z', 'meta+shift+z'], () => {
    redo();
    return false;
  });

  graph.bindKey('escape', () => {
    graph?.cleanSelection();
    refreshSelectedCellState();
    return false;
  });
}

function bindGraphEvents() {
  if (!graph) return;

  graph.on('selection:changed', () => {
    refreshSelectedCellState();
  });

  graph.on('node:mousedown', ({ node }) => {
    startUserInteraction();
    pendingNodeInternalClickId = null;

    if (!isEditable.value || editingNodeId.value != null) {
      return;
    }

    if (isNodeSoleSelected(node)) {
      pendingNodeInternalClickId = node.id;
    }
  });

  graph.on('node:mouseup', () => {
    finishUserInteraction();
  });

  graph.on('node:moved', () => {
    finishUserInteraction();
  });

  graph.on('node:resize', () => {
    startUserInteraction();
  });

  graph.on('node:resized', () => {
    finishUserInteraction();
  });

  graph.on('edge:mousedown', () => {
    startUserInteraction();
  });

  graph.on('edge:mouseup', () => {
    finishUserInteraction();
  });

  graph.on('edge:connected', () => {
    syncTaskFlowEdgeState();
    finishUserInteraction();
  });

  graph.on('blank:mouseup', () => {
    finishUserInteraction();
    pendingNodeInternalClickId = null;
  });

  graph.on('blank:click', () => {
    pendingNodeInternalClickId = null;
  });

  graph.on('node:click', ({ node }) => {
    const shouldHandleInternalClick = pendingNodeInternalClickId === node.id;
    pendingNodeInternalClickId = null;

    if (!shouldHandleInternalClick) {
      return;
    }

    tryHandleNodeInternalClick(node);
  });

  graph.on('blank:dblclick', ({ x, y }) => {
    addNode(isTaskFlow.value ? 'round' : 'rect', { x: x - 80, y: y - 32 });
  });

  graph.on('node:dblclick', ({ node }) => {
    tryHandleNodeInternalClick(node);
  });

  graph.on('edge:dblclick', ({ edge }) => {
    editEdgeLabel(edge);
  });

  graph.on('edge:mouseenter', ({ view }) => {
    view.addTools({
      items: [
        { name: 'vertices' },
        { name: 'source-arrowhead' },
        { name: 'target-arrowhead' },
        { name: 'button-remove', args: { distance: -30 } },
      ],
    });
  });

  graph.on('edge:mouseleave', ({ view }) => {
    view.removeTools();
  });

  graph.on('history:change', () => {
    updateUndoRedoState();
  });

  graph.model.on('cell:added', () => scheduleSync());
  graph.model.on('cell:removed', () => scheduleSync());
  graph.model.on('node:change:position', () => scheduleSync());
  graph.model.on('node:change:size', () => scheduleSync());
  graph.model.on('cell:change:attrs', () => scheduleSync());
  graph.model.on('cell:change:labels', () => scheduleSync());
  graph.model.on('cell:change:source', () => scheduleSync());
  graph.model.on('cell:change:target', () => scheduleSync());
  graph.model.on('cell:change:vertices', () => scheduleSync());
  graph.model.on('cell:change:data', () => scheduleSync());
  graph.model.on('cell:added', syncTaskFlowEdgeState);
  graph.model.on('cell:removed', syncTaskFlowEdgeState);
  graph.model.on('cell:change:source', syncTaskFlowEdgeState);
  graph.model.on('cell:change:target', syncTaskFlowEdgeState);

  // Update node overlays on graph transform / node changes
  graph.on('translate', updateNodeOverlays);
  graph.on('scale', updateNodeOverlays);
  graph.model.on('node:change:position', updateNodeOverlays);
  graph.model.on('node:change:size', updateNodeOverlays);
  graph.model.on('cell:change:data', updateNodeOverlays);
  graph.model.on('cell:added', updateNodeOverlays);
  graph.model.on('cell:removed', updateNodeOverlays);
}

function initGraph() {
  if (!containerRef.value || !stageRef.value) return;

  if (graph) {
    graph.dispose();
    graph = null;
  }

  graph = new Graph({
    container: containerRef.value,
    width: stageRef.value.clientWidth || props.width,
    height: stageRef.value.clientHeight || props.height,
    background: {
      color: '#fcfcfd',
    },
    grid: {
      size: 20,
      visible: true,
      type: 'doubleMesh',
      args: [
        { color: '#eef1f6', thickness: 1 },
        { color: '#d9dee8', thickness: 1, factor: 4 },
      ],
    },
    scaling: {
      min: 0.2,
      max: 3,
    },
    panning: {
      enabled: true,
      eventTypes: ['rightMouseDown'],
    },
    mousewheel: {
      enabled: true,
      modifiers: ['ctrl', 'meta'],
      minScale: 0.2,
      maxScale: 3,
      factor: 1.1,
    },
    connecting: {
      snap: { radius: 28 },
      allowBlank: false,
      allowLoop: false,
      allowNode: false,
      allowEdge: false,
      allowMulti: 'withPort',
      highlight: true,
      connectionPoint: 'boundary',
      anchor: 'center',
      router: {
        name: 'orth',
      },
      connector: {
        name: 'rounded',
      },
      createEdge: () => graph?.createEdge(createEdgeMetadata()) as Edge,
      validateMagnet: ({ magnet }) => isEditable.value && magnet.getAttribute('port-group') != null,
      validateConnection: ({ sourceCell, targetCell, sourceMagnet, targetMagnet }) => {
        if (!isEditable.value) return false;
        if (!sourceCell || !targetCell || !sourceMagnet || !targetMagnet) return false;
        if (sourceCell.id === targetCell.id && sourceMagnet === targetMagnet) return false;
        if (graph?.isNode(sourceCell) && graph?.isNode(targetCell) && !canCreateTaskFlowEdge(sourceCell, targetCell)) return false;
        return true;
      },
    },
    interacting: () => ({
      nodeMovable: isEditable.value,
      edgeMovable: isEditable.value,
      edgeLabelMovable: isEditable.value,
      magnetConnectable: isEditable.value,
      arrowheadMovable: isEditable.value,
      vertexMovable: isEditable.value,
      vertexAddable: isEditable.value,
      vertexDeletable: isEditable.value,
    }),
  });

  graph.use(
    new Selection({
      enabled: true,
      rubberband: true,
      multiple: true,
      movable: false,
      showEdgeSelectionBox: false,
      showNodeSelectionBox: false,
      pointerEvents: 'none',
    }),
  );
  graph.use(new Keyboard({ enabled: isEditable.value }));
  graph.use(new Clipboard({ enabled: true, useLocalStorage: false }));
  graph.use(new History({ enabled: true }));
  graph.use(new Snapline({ enabled: isEditable.value }));
  graph.use(
    new Transform({
      resizing: {
        enabled: isEditable.value,
        minWidth: 72,
        minHeight: 40,
        orthogonal: false,
        restrict: true,
      },
      rotating: false,
    }),
  );

  bindKeyboardShortcuts();
  bindGraphEvents();
  applyGraphData(props.graphData, true);
  updateUndoRedoState();
}

onMounted(() => {
  nextTick(() => {
    initGraph();

    if (stageRef.value) {
      resizeObserver = new ResizeObserver(() => {
        resizeGraph();
      });
      resizeObserver.observe(stageRef.value);
    }
  });
});

onBeforeUnmount(() => {
  if (syncTimer !== null) {
    window.clearTimeout(syncTimer);
  }
  if (resizeObserver) {
    resizeObserver.disconnect();
    resizeObserver = null;
  }
  if (graph) {
    graph.dispose();
    graph = null;
  }
});

watch(
  () => getGraphSnapshot(props.graphData),
  () => {
    if (!graph) return;
    applyGraphData(props.graphData);
  },
);

watch(
  () => props.editable,
  () => {
    nextTick(() => initGraph());
  },
);

defineExpose({
  getMarkdownLinkAnchor,
  insertMarkdownLink,
  updateInsertedLinkDisplay,
  updateInsertedImageWidth,
});
</script>

<template>
  <div class="x6-editor" @mousedown.stop="emit('active')" @click.stop @dblclick.stop>
    <div class="x6-toolbar">
      <div class="toolbar-group" v-if="isTaskFlow">
        <button type="button" class="tool-button tool-button--primary" :disabled="!isEditable" @click="addNode('round')">
          新任务
        </button>
        <button type="button" class="tool-button" :disabled="!isEditable" @click="addNode('ellipse')">
          起止节点
        </button>
      </div>
      <div class="toolbar-group" v-else>
        <button type="button" class="tool-button tool-button--primary" :disabled="!isEditable" @click="addNode('rect')">
          矩形
        </button>
        <button type="button" class="tool-button" :disabled="!isEditable" @click="addNode('round')">
          圆角矩形
        </button>
        <button type="button" class="tool-button" :disabled="!isEditable" @click="addNode('ellipse')">
          圆形
        </button>
        <button type="button" class="tool-button" :disabled="!isEditable" @click="addNode('diamond')">
          菱形
        </button>
        <button type="button" class="tool-button" :disabled="!isEditable" @click="insertUmlClassPreset">
          UML 类图
        </button>
        <button type="button" class="tool-button" :disabled="!isEditable || objectModelStore.classes.length === 0" @click="syncAllUmlClassNodes">
          同步对象模型
        </button>
      </div>
      <div class="toolbar-group">
        <button type="button" class="tool-button" :disabled="selectedCellsCount === 0" @click="copySelection">
          复制
        </button>
        <button type="button" class="tool-button" :disabled="!isEditable || selectedCellsCount === 0" @click="duplicateSelection">
          复制副本
        </button>
        <button type="button" class="tool-button" :disabled="!isEditable" @click="pasteSelection">
          粘贴
        </button>
        <button type="button" class="tool-button tool-button--danger" :disabled="!isEditable || selectedCellsCount === 0" @click="deleteSelection">
          删除
        </button>
      </div>

      <div class="toolbar-group">
        <button type="button" class="tool-button" :disabled="!canUndo" @click="undo">撤销</button>
        <button type="button" class="tool-button" :disabled="!canRedo" @click="redo">重做</button>
      </div>

      <div class="toolbar-group">
        <button type="button" class="tool-button" @click="zoomOut">缩小</button>
        <button type="button" class="tool-button" @click="zoomIn">放大</button>
        <button type="button" class="tool-button" @click="resetZoom">100%</button>
        <button type="button" class="tool-button" @click="fitGraph">适配</button>
        <button type="button" class="tool-button" @click="centerGraph">居中</button>
        <button type="button" class="tool-button" @click="toggleGrid">
          {{ gridVisible ? '隐藏网格' : '显示网格' }}
        </button>
      </div>

      <div v-if="blockActionsEnabled" class="toolbar-group">
        <button type="button" class="tool-button" :disabled="selectedCellsCount === 0" @click="extractSelectionAsBlock">
          提取为块（蓝图）
        </button>
        <button type="button" class="tool-button" :disabled="!isEditable" @click="requestInsertRefBlock">
          插入引用块
        </button>
      </div>

      <div class="toolbar-group toolbar-group--summary">
        <span class="toolbar-summary">{{ selectionSummary }}</span>
        <span class="toolbar-summary">{{ zoomPercent }}%</span>
        <button type="button" class="tool-button tool-button--danger" :disabled="!isEditable" @click="clearCanvas">
          清空
        </button>
      </div>
    </div>

    <div class="x6-workspace">
      <div ref="stageRef" class="x6-stage" :style="{ minHeight: `${height}px` }">
        <div ref="containerRef" class="x6-canvas"></div>

        <div
          v-if="graphSourceRegion"
          class="x6-source-region"
          :class="`x6-source-region--${graphSourceRegion.kind}`"
          :style="graphSourceRegion.style"
        >
          <div class="x6-source-region__header">
            <span class="x6-source-region__label">{{ graphSourceRegion.label }}</span>
            <div v-if="hasGraphSourceActions" class="x6-source-region__actions">
              <button
                v-if="sourceLoadEnabled"
                type="button"
                class="x6-source-region__button"
                @click.stop="syncFromSource"
              >
                从源同步
              </button>
              <button
                v-if="sourceWriteBackEnabled"
                type="button"
                class="x6-source-region__button x6-source-region__button--primary"
                :disabled="!isEditable"
                @click.stop="syncToSource"
              >
                同步至源
              </button>
            </div>
          </div>
        </div>

        <!-- Node overlays: plain text editing + rich text preview/editing -->
        <X6NodeOverlay
          v-for="overlay in nodeOverlays"
          :key="overlay.id"
          :ref="(el) => setNodeOverlayRef(el, overlay.id)"
          :node-id="overlay.id"
          :style-props="overlay.style"
          :text-mode="overlay.textMode"
          :label="overlay.label"
          :rich-content="overlay.richContent"
          :is-editing="editingNodeId === overlay.id"
          :is-editable="isEditable"
          @commit-plain="(text: string) => handleNodeOverlayCommit(overlay.id, text)"
          @cancel="() => handleNodeOverlayCancel(overlay.id)"
          @rich-change="(md: string) => handleRichChange(overlay.id, md)"
        />

        <!-- Edge inline text editor -->
        <div
          v-if="edgeInlineEditing"
          class="x6-inline-editor"
          :style="edgeInlineEditStyle"
          @mousedown.stop
          @click.stop
          @dblclick.stop
          @keydown.stop
        >
          <textarea
            ref="edgeInlineInputRef"
            v-model="edgeInlineEditText"
            class="x6-inline-editor__input"
            @keydown="handleEdgeEditKeydown"
            @blur="commitEdgeInlineEdit()"
          />
          <span v-if="blockActionsEnabled">多选后可直接提取为新蓝图块（蓝图）</span>
        </div>

        <div class="x6-stage-hint">
          <span v-if="blockActionsEnabled">多选后可直接提取为新蓝图块（蓝图）</span>
          <span>双击空白处快速新建节点</span>
          <span>拖拽节点四周锚点创建连线</span>
          <span>双击节点或连线直接改文字</span>
        </div>
      </div>

      <aside class="x6-inspector">
        <div v-if="isTaskFlow" class="inspector-card">
          <h4>任务顺序</h4>
          <p v-if="taskSequenceSummary.length === 0" class="inspector-empty">连接任务节点后会在这里显示执行顺序。</p>
          <ol v-else class="task-sequence-list">
            <li v-for="(taskLabel, index) in taskSequenceSummary" :key="`${taskLabel}-${index}`">
              {{ index + 1 }}. {{ taskLabel }}
            </li>
          </ol>
          <p class="inspector-empty">每个任务节点只允许一条前驱和一条后继连线，用于表达明确的先后顺序。</p>
        </div>

        <div class="inspector-card">
          <h4>属性面板</h4>

          <template v-if="selectedCellsCount === 0 && !selectedCell">
            <p class="inspector-empty">选中节点或连线后可在这里编辑文字、颜色和线路样式。</p>
            <ul class="inspector-tips">
              <li><code>Delete</code> 删除选中项</li>
              <li><code>Ctrl/Cmd + C</code> 复制</li>
              <li><code>Ctrl/Cmd + V</code> 粘贴</li>
              <li><code>Ctrl/Cmd + Z</code> 撤销</li>
            </ul>
          </template>

          <template v-else-if="selectedCellsCount > 1">
            <p class="inspector-empty">当前选中了 {{ selectedCellsCount }} 个对象，可直接拖拽整体移动或批量删除。</p>
          </template>

          <template v-else-if="selectedCell?.kind === 'node'">
            <label class="field">
              <span>文字模式</span>
              <select
                :value="selectedCell.textMode"
                :disabled="!isEditable"
                @change="toggleNodeTextMode(($event.target as HTMLSelectElement).value as 'plain' | 'rich')"
              >
                <option value="plain">纯文本</option>
                <option value="rich">富文本</option>
              </select>
            </label>

            <template v-if="selectedCell.textMode === 'plain'">
              <label class="field">
                <span>文字</span>
                <input
                  type="text"
                  :value="selectedCell.label"
                  :disabled="!isEditable"
                  @input="updateSelectedNodeLabel(($event.target as HTMLInputElement).value)"
                />
              </label>
            </template>
            <template v-else>
              <p class="inspector-empty" style="font-size:12px;">双击节点可直接编辑富文本</p>
            </template>

            <div class="field-row">
              <label class="field">
                <span>填充色</span>
                <input
                  type="color"
                  :value="selectedCell.fill"
                  :disabled="!isEditable"
                  @input="updateSelectedNodeFill(($event.target as HTMLInputElement).value)"
                />
              </label>

              <label class="field">
                <span>边框色</span>
                <input
                  type="color"
                  :value="selectedCell.stroke"
                  :disabled="!isEditable"
                  @input="updateSelectedNodeStroke(($event.target as HTMLInputElement).value)"
                />
              </label>
            </div>

            <div class="field-row">
              <label class="field">
                <span>宽度</span>
                <input
                  type="number"
                  min="40"
                  :value="selectedCell.width"
                  :disabled="!isEditable"
                  @change="updateSelectedNodeSize('width', ($event.target as HTMLInputElement).value)"
                />
              </label>

              <label class="field">
                <span>高度</span>
                <input
                  type="number"
                  min="40"
                  :value="selectedCell.height"
                  :disabled="!isEditable"
                  @change="updateSelectedNodeSize('height', ($event.target as HTMLInputElement).value)"
                />
              </label>
            </div>

            <p class="field-meta">形状类型: {{ selectedCell.shape }}</p>
          </template>

          <template v-else-if="selectedCell?.kind === 'edge'">
            <label class="field">
              <span>连线文字</span>
              <input
                type="text"
                :value="selectedCell.label"
                :disabled="!isEditable"
                @input="updateSelectedEdgeLabel(($event.target as HTMLInputElement).value)"
              />
            </label>

            <div class="field-row">
              <label class="field">
                <span>线条颜色</span>
                <input
                  type="color"
                  :value="selectedCell.stroke"
                  :disabled="!isEditable"
                  @input="updateSelectedEdgeStroke(($event.target as HTMLInputElement).value)"
                />
              </label>

              <label class="field">
                <span>路由</span>
                <select
                  :value="selectedCell.router"
                  :disabled="!isEditable"
                  @change="updateSelectedEdgeRouter(($event.target as HTMLSelectElement).value)"
                >
                  <option value="normal">直线</option>
                  <option value="orth">正交</option>
                </select>
              </label>
            </div>

            <label class="field">
              <span>连接器</span>
              <select
                :value="selectedCell.connector"
                :disabled="!isEditable"
                @change="updateSelectedEdgeConnector(($event.target as HTMLSelectElement).value)"
              >
                <option value="normal">普通</option>
                <option value="rounded">圆角</option>
                <option value="smooth">平滑</option>
              </select>
            </label>
          </template>
        </div>
      </aside>
    </div>
  </div>
</template>

<style scoped>
.x6-editor {
  width: 100%;
  border: 1px solid #e3e7ef;
  border-radius: 14px;
  overflow: hidden;
  background: linear-gradient(180deg, #fbfcfe 0%, #f4f7fb 100%);
  box-shadow: inset 0 1px 0 rgba(255, 255, 255, 0.7);
}

.x6-toolbar {
  display: flex;
  flex-wrap: wrap;
  gap: 10px;
  align-items: center;
  padding: 12px 14px;
  border-bottom: 1px solid #e3e7ef;
  background: rgba(255, 255, 255, 0.85);
  backdrop-filter: blur(8px);
}

.toolbar-group {
  display: flex;
  flex-wrap: wrap;
  gap: 8px;
  align-items: center;
}

.toolbar-group--summary {
  margin-left: auto;
}

.toolbar-summary {
  font-size: 12px;
  color: #5f6b7a;
  padding: 0 4px;
}

.tool-button {
  border: 1px solid #d2d8e2;
  background: #ffffff;
  color: #213547;
  border-radius: 10px;
  padding: 7px 12px;
  font-size: 13px;
  font-weight: 600;
  cursor: pointer;
  transition: all 0.18s ease;
}

.tool-button:hover:not(:disabled) {
  border-color: #8bb8ff;
  color: #0958d9;
  box-shadow: 0 6px 16px rgba(22, 119, 255, 0.12);
}

.tool-button:disabled {
  opacity: 0.45;
  cursor: not-allowed;
}

.tool-button--primary {
  background: linear-gradient(135deg, #1677ff 0%, #4096ff 100%);
  color: #ffffff;
  border-color: transparent;
}

.tool-button--danger {
  color: #cf1322;
}

.x6-workspace {
  display: grid;
  grid-template-columns: minmax(0, 1fr) 260px;
  min-height: 560px;
}

.x6-stage {
  position: relative;
  min-width: 0;
  overflow: hidden;
  border-right: 1px solid #e3e7ef;
  background:
    radial-gradient(circle at top left, rgba(22, 119, 255, 0.08), transparent 28%),
    linear-gradient(180deg, rgba(255, 255, 255, 0.98), rgba(247, 250, 255, 0.96));
}

.x6-canvas {
  position: absolute;
  inset: 0;
  width: 100%;
  height: 100%;
}

.x6-source-region {
  position: absolute;
  z-index: 2;
  pointer-events: none;
  box-sizing: border-box;
  border: 2px dashed rgba(22, 119, 255, 0.78);
  border-radius: 16px;
  background: rgba(22, 119, 255, 0.05);
  box-shadow:
    0 0 0 4px rgba(22, 119, 255, 0.08),
    0 12px 28px rgba(15, 23, 42, 0.08);
}

.x6-source-region--selection-blueprint,
.x6-source-region--blueprint {
  border-color: rgba(114, 46, 209, 0.75);
  background: rgba(114, 46, 209, 0.05);
  box-shadow:
    0 0 0 4px rgba(114, 46, 209, 0.08),
    0 12px 28px rgba(15, 23, 42, 0.08);
}

.x6-source-region--task-flow {
  border-color: rgba(82, 196, 26, 0.78);
  background: rgba(82, 196, 26, 0.05);
  box-shadow:
    0 0 0 4px rgba(82, 196, 26, 0.08),
    0 12px 28px rgba(15, 23, 42, 0.08);
}

.x6-source-region__header {
  position: absolute;
  top: 8px;
  left: 12px;
  display: inline-flex;
  align-items: center;
  gap: 6px;
  pointer-events: auto;
}

.x6-source-region__label {
  display: inline-flex;
  align-items: center;
  min-height: 22px;
  padding: 2px 10px;
  border-radius: 999px;
  background: #ffffff;
  color: #0958d9;
  border: 1px solid rgba(22, 119, 255, 0.28);
  box-shadow: 0 6px 16px rgba(15, 23, 42, 0.1);
  font-size: 12px;
  font-weight: 700;
}

.x6-source-region__actions {
  display: inline-flex;
  align-items: center;
  gap: 4px;
}

.x6-source-region__button {
  min-height: 24px;
  padding: 2px 8px;
  border: 1px solid rgba(22, 119, 255, 0.26);
  border-radius: 999px;
  background: #ffffff;
  color: #0958d9;
  box-shadow: 0 6px 16px rgba(15, 23, 42, 0.1);
  cursor: pointer;
  font-size: 12px;
  font-weight: 700;
  white-space: nowrap;
}

.x6-source-region__button:hover:not(:disabled) {
  border-color: #1677ff;
  background: #f0f7ff;
}

.x6-source-region__button:disabled {
  opacity: 0.48;
  cursor: not-allowed;
}

.x6-source-region__button--primary {
  border-color: #1677ff;
  background: #1677ff;
  color: #ffffff;
}

.x6-source-region__button--primary:hover:not(:disabled) {
  background: #0958d9;
}

/* Inline text editor overlay */
.x6-inline-editor {
  display: flex;
  align-items: center;
  justify-content: center;
  pointer-events: auto;
}

.x6-inline-editor__input {
  width: 100%;
  height: 100%;
  border: 2px solid #1677ff;
  border-radius: 4px;
  background: rgba(255, 255, 255, 0.96);
  font-weight: 600;
  text-align: center;
  resize: none;
  outline: none;
  padding: 4px 8px;
  box-sizing: border-box;
  font-family: inherit;
  line-height: 1.4;
}

.x6-inline-editor > span {
  display: none;
}

.x6-stage-hint {
  position: absolute;
  left: 16px;
  bottom: 16px;
  display: flex;
  flex-wrap: wrap;
  gap: 10px;
  max-width: calc(100% - 32px);
  pointer-events: none;
}

.x6-stage-hint span {
  display: inline-flex;
  align-items: center;
  padding: 6px 10px;
  border-radius: 999px;
  background: rgba(255, 255, 255, 0.88);
  border: 1px solid rgba(210, 216, 226, 0.9);
  color: #5f6b7a;
  font-size: 12px;
  box-shadow: 0 6px 14px rgba(31, 45, 61, 0.08);
}

.x6-inspector {
  display: flex;
  flex-direction: column;
  gap: 14px;
  padding: 16px;
  background: rgba(248, 250, 253, 0.92);
}

.inspector-card {
  display: flex;
  flex-direction: column;
  gap: 12px;
  padding: 16px;
  border: 1px solid #e3e7ef;
  border-radius: 14px;
  background: #ffffff;
  box-shadow: 0 10px 24px rgba(15, 23, 42, 0.06);
}

.inspector-card h4 {
  margin: 0;
  font-size: 15px;
  color: #1f2d3d;
}

.inspector-card__header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 8px;
}

.inspector-empty {
  margin: 0;
  color: #5f6b7a;
  line-height: 1.6;
  font-size: 13px;
}

.inspector-tips {
  margin: 0;
  padding-left: 18px;
  color: #5f6b7a;
  font-size: 12px;
  line-height: 1.7;
}

.task-sequence-list {
  margin: 0;
  padding-left: 18px;
  color: #213547;
  font-size: 13px;
  line-height: 1.7;
}

.field {
  display: flex;
  flex-direction: column;
  gap: 6px;
  font-size: 12px;
  color: #5f6b7a;
}

.field input,
.field select,
.field textarea {
  width: 100%;
  border: 1px solid #d2d8e2;
  border-radius: 10px;
  padding: 8px 10px;
  font-size: 13px;
  color: #213547;
  background: #ffffff;
  box-sizing: border-box;
  font-family: inherit;
}

.field textarea {
  resize: vertical;
  line-height: 1.45;
}

.field input[type='color'] {
  min-height: 40px;
  padding: 4px;
}

.field-row {
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: 10px;
}

.field-meta {
  margin: 0;
  font-size: 12px;
  color: #7b8794;
}

.x6-canvas :deep(.x6-graph) {
  border-radius: 0;
}

.x6-canvas :deep(.x6-node.x6-node-selected rect),
.x6-canvas :deep(.x6-node.x6-node-selected ellipse),
.x6-canvas :deep(.x6-node.x6-node-selected polygon) {
  filter: drop-shadow(0 0 0.45rem rgba(22, 119, 255, 0.22));
  stroke-width: 2.4px !important;
}

.x6-canvas :deep(.x6-edge.x6-edge-selected .connection) {
  stroke-width: 3px !important;
  stroke: #1677ff !important;
}

.x6-canvas :deep(.x6-node [magnet='true']) {
  visibility: hidden;
  opacity: 0;
  transition: transform 0.15s ease, opacity 0.15s ease;
}

.x6-canvas :deep(.x6-node:hover [magnet='true']),
.x6-canvas :deep(.x6-node.x6-node-selected [magnet='true']) {
  visibility: visible;
  opacity: 1;
}

.x6-canvas :deep(.x6-node [magnet='true']:hover) {
  transform: scale(1.12);
}

@media (max-width: 1100px) {
  .x6-workspace {
    grid-template-columns: 1fr;
  }

  .x6-stage {
    border-right: none;
    border-bottom: 1px solid #e3e7ef;
  }
}
</style>
