<script setup lang="ts">
import { computed, nextTick, onBeforeUnmount, onMounted, ref, watch } from 'vue';
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

interface GraphData {
  cells?: CellData[];
  nodes?: CellData[];
  edges?: CellData[];
  [key: string]: any;
}

interface Props {
  graphData?: GraphData;
  editable?: boolean;
  width?: number;
  height?: number;
}

type NodePreset = 'rect' | 'round' | 'ellipse' | 'diamond';

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
  editable: true,
  width: 960,
  height: 540,
});

const emit = defineEmits<{
  (e: 'graph-data-change', graphData: GraphData): void;
}>();

const stageRef = ref<HTMLDivElement | null>(null);
const containerRef = ref<HTMLDivElement | null>(null);

const canUndo = ref(false);
const canRedo = ref(false);
const gridVisible = ref(true);
const zoomPercent = ref(100);
const selectedCellsCount = ref(0);
const selectedCell = ref<SelectedCellState | null>(null);

const isEditable = computed(() => props.editable !== false);
const selectionSummary = computed(() => {
  if (selectedCellsCount.value === 0) return '未选中对象';
  if (selectedCellsCount.value > 1) return `已选中 ${selectedCellsCount.value} 个对象`;
  if (!selectedCell.value) return '已选中 1 个对象';
  return selectedCell.value.kind === 'node'
    ? `节点: ${selectedCell.value.label || selectedCell.value.id}`
    : `连线: ${selectedCell.value.label || selectedCell.value.id}`;
});

let graph: Graph | null = null;
let resizeObserver: ResizeObserver | null = null;
let syncTimer: number | null = null;
let isApplyingExternalData = false;
let isUserInteracting = false;
let pendingSyncAfterInteraction = false;
let lastSerializedSnapshot = '';

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

function extractNodeLabel(node: CellData) {
  return node.label ?? node.data?.label ?? node.attrs?.label?.text ?? '节点';
}

function createNodeMetadata(preset: NodePreset, options: Partial<CellData> = {}): CellData {
  const labels: Record<NodePreset, string> = {
    rect: '处理步骤',
    round: '子流程',
    ellipse: '开始 / 结束',
    diamond: '判断',
  };

  const fills: Record<NodePreset, string> = {
    rect: '#fff7e6',
    round: '#f6ffed',
    ellipse: '#e6f4ff',
    diamond: '#fff1f0',
  };

  const strokes: Record<NodePreset, string> = {
    rect: '#d48806',
    round: '#389e0d',
    ellipse: '#1677ff',
    diamond: '#cf1322',
  };

  const textColors: Record<NodePreset, string> = {
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

function normalizeNode(node: CellData): CellData {
  const preset = (node.data?.preset as NodePreset | undefined)
    ?? (node.shape === 'ellipse'
      ? 'ellipse'
      : node.shape === 'polygon'
        ? 'diamond'
        : node.attrs?.body?.rx
          ? 'round'
          : 'rect');

  const base = createNodeMetadata(preset, {
    id: node.id,
    x: node.x ?? node.style?.x ?? 120,
    y: node.y ?? node.style?.y ?? 120,
    width: node.width,
    height: node.height,
    label: extractNodeLabel(node),
    data: node.data,
  });

  return {
    ...base,
    ...node,
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
    return { cells: [], nodes: [], edges: [] };
  }

  const nodes = graph.getNodes().map((node) => node.toJSON() as CellData);
  const edges = graph.getEdges().map((edge) => edge.toJSON() as CellData);
  return {
    cells: graph.toJSON().cells as CellData[],
    nodes,
    edges,
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

function refreshSelectedCellState() {
  if (!graph) return;

  const cells = graph.getSelectedCells();
  selectedCellsCount.value = cells.length;
  selectedCell.value = null;

  if (cells.length === 1) {
    const [cell] = cells;

    if (graph.isNode(cell)) {
      const size = cell.getSize();
      selectedCell.value = {
        kind: 'node',
        id: cell.id,
        shape: cell.shape,
        label: getNodeLabel(cell),
        fill: (cell.attr('body/fill') as string) || '#ffffff',
        stroke: (cell.attr('body/stroke') as string) || '#1677ff',
        width: size.width,
        height: size.height,
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
  refreshSelectedCellState();

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

function addNode(preset: NodePreset, position?: { x: number; y: number }) {
  if (!graph || !isEditable.value) return;
  const center = position ?? getCanvasCenter();
  const node = graph.addNode(
    createNodeMetadata(preset, {
      x: center.x,
      y: center.y,
    }),
  );
  graph.cleanSelection();
  graph.select(node);
  refreshSelectedCellState();
  scheduleSync();
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
  node.attr('label/text', value);
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

function editNodeLabel(node: Node) {
  if (!isEditable.value) return;
  const current = getNodeLabel(node);
  const next = window.prompt('编辑节点文字', current);
  if (next == null) return;
  node.attr('label/text', next);
  scheduleSync();
}

function editEdgeLabel(edge: Edge) {
  if (!isEditable.value) return;
  const current = getEdgeLabel(edge);
  const next = window.prompt('编辑连线文字', current);
  if (next == null) return;
  setEdgeLabel(edge, next);
  scheduleSync();
}

function resizeGraph() {
  if (!graph || !stageRef.value) return;
  const width = stageRef.value.clientWidth || props.width;
  const height = stageRef.value.clientHeight || props.height;
  graph.resize(width, height);
  updateUndoRedoState();
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

  graph.on('node:mousedown', () => {
    startUserInteraction();
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
    finishUserInteraction();
  });

  graph.on('blank:mouseup', () => {
    finishUserInteraction();
  });

  graph.on('blank:dblclick', ({ x, y }) => {
    addNode('rect', { x: x - 80, y: y - 32 });
  });

  graph.on('node:dblclick', ({ node }) => {
    editNodeLabel(node);
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
</script>

<template>
  <div class="x6-editor" @mousedown.stop @click.stop @dblclick.stop>
    <div class="x6-toolbar">
      <div class="toolbar-group">
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
        <div class="x6-stage-hint">
          <span>双击空白处快速新建节点</span>
          <span>拖拽节点四周锚点创建连线</span>
          <span>双击节点或连线直接改文字</span>
        </div>
      </div>

      <aside class="x6-inspector">
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
              <span>文字</span>
              <input
                type="text"
                :value="selectedCell.label"
                :disabled="!isEditable"
                @input="updateSelectedNodeLabel(($event.target as HTMLInputElement).value)"
              />
            </label>

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
  border-right: 1px solid #e3e7ef;
  background:
    radial-gradient(circle at top left, rgba(22, 119, 255, 0.08), transparent 28%),
    linear-gradient(180deg, rgba(255, 255, 255, 0.98), rgba(247, 250, 255, 0.96));
}

.x6-canvas {
  width: 100%;
  height: 100%;
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

.field {
  display: flex;
  flex-direction: column;
  gap: 6px;
  font-size: 12px;
  color: #5f6b7a;
}

.field input,
.field select {
  width: 100%;
  border: 1px solid #d2d8e2;
  border-radius: 10px;
  padding: 8px 10px;
  font-size: 13px;
  color: #213547;
  background: #ffffff;
  box-sizing: border-box;
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
