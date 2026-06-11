import type { Graph, Node } from '@antv/x6';
import type { GraphData } from '@/api/types';
import { createId } from './cellUtils';
import {
  createMindmapEdgeMetadata,
  createMindmapNode,
  type MindmapNodeRole,
} from './graphCells';
import { getMindmapEdgePorts } from './ports';

export type MindmapDirection = 'LR' | 'RL' | 'TB' | 'BT';
export type MindmapDropSide = 'left' | 'right';

export interface MindmapDropTarget {
  nodeId: string;
  side: MindmapDropSide;
}

export const MINDMAP_FREE_TOPIC_ROLE = 'free' as const;

export interface MindmapLayoutPreviewAttach {
  childId: string;
  parentId: string;
  side: MindmapDropSide;
  insertBeforeId?: string | null;
}

let mindmapLayoutPreviewAttach: MindmapLayoutPreviewAttach | null = null;
let mindmapLayoutSkipNodeIds = new Set<string>();
let mindmapDragPreviewActive = false;
let mindmapDragSessionActive = false;

export function isApplyingMindmapDragPreview(): boolean {
  return mindmapDragPreviewActive || mindmapDragSessionActive;
}

export function setMindmapDragPreviewActive(active: boolean) {
  mindmapDragPreviewActive = active;
}

export function setMindmapDragSession(draggedNodeId: string | null, graph?: Graph) {
  mindmapDragSessionActive = draggedNodeId != null;
  if (draggedNodeId && graph) {
    mindmapLayoutSkipNodeIds = new Set(collectMindmapDescendantIds(graph, draggedNodeId));
  } else {
    mindmapLayoutSkipNodeIds = new Set();
  }
  if (!draggedNodeId) {
    mindmapLayoutPreviewAttach = null;
  }
}

export function getMindmapLayoutSkipNodeIds(): ReadonlySet<string> {
  return mindmapLayoutSkipNodeIds;
}

export function setMindmapLayoutPreview(attach: MindmapLayoutPreviewAttach | null) {
  mindmapLayoutPreviewAttach = attach;
}

export function getMindmapLayoutPreview(): MindmapLayoutPreviewAttach | null {
  return mindmapLayoutPreviewAttach;
}

const H_GAP = 88;
const V_GAP = 16;
const DEFAULT_NODE_WIDTH = 156;
const DEFAULT_NODE_HEIGHT = 48;
const ROOT_NODE_WIDTH = 180;
const ROOT_NODE_HEIGHT = 56;

interface MindmapTreeNode {
  id: string;
  leftChildren: MindmapTreeNode[];
  rightChildren: MindmapTreeNode[];
  width: number;
  height: number;
  subtreeHeight: number;
}

function stackHeight(children: MindmapTreeNode[]): number {
  if (!children.length) return 0;
  return children.reduce((sum, child) => sum + child.subtreeHeight + V_GAP, -V_GAP);
}

export function getMindmapBranchSide(graph: Graph, nodeId: string): MindmapDropSide {
  if (mindmapLayoutPreviewAttach?.childId === nodeId) {
    return mindmapLayoutPreviewAttach.side;
  }
  const node = graph.getCellById(nodeId);
  if (!node || !graph.isNode(node)) return 'right';
  const side = node.getData<Record<string, unknown>>()?.mindBranchSide;
  return side === 'left' ? 'left' : 'right';
}

export function setMindmapBranchSide(graph: Graph, nodeId: string, side: MindmapDropSide) {
  const node = graph.getCellById(nodeId);
  if (!node || !graph.isNode(node)) return;
  node.setData({
    ...node.getData(),
    mindBranchSide: side,
  });
}

function getNodeSize(node: Node) {
  const size = node.getSize();
  const data = node.getData<Record<string, any>>() ?? {};
  const isRoot = data.mindRole === 'root';
  return {
    width: size.width || (isRoot ? ROOT_NODE_WIDTH : DEFAULT_NODE_WIDTH),
    height: size.height || (isRoot ? ROOT_NODE_HEIGHT : DEFAULT_NODE_HEIGHT),
  };
}

function getRawChildIds(graph: Graph, parentId: string): string[] {
  const childIds: string[] = [];
  graph.getEdges().forEach((edge) => {
    if (edge.getSourceCellId() !== parentId) return;
    const target = edge.getTargetCellId();
    if (target) childIds.push(target);
  });
  return childIds;
}

export function getOrderedMindmapChildIds(graph: Graph, parentId: string): string[] {
  const parent = graph.getCellById(parentId);
  const raw = getRawChildIds(graph, parentId);
  if (!parent || !graph.isNode(parent)) return raw;

  const order = (parent.getData<Record<string, unknown>>()?.mindChildOrder as string[] | undefined) ?? [];
  const ordered = order.filter((id) => raw.includes(id));
  const rest = raw.filter((id) => !ordered.includes(id));
  return [...ordered, ...rest];
}

export function setMindmapChildOrder(graph: Graph, parentId: string, childIds: string[]) {
  const parent = graph.getCellById(parentId);
  if (!parent || !graph.isNode(parent)) return;
  parent.setData({
    ...parent.getData(),
    mindChildOrder: childIds,
  });
}

export function insertMindmapChildOrder(
  graph: Graph,
  parentId: string,
  childId: string,
  side: MindmapDropSide,
  insertBeforeId?: string | null,
) {
  setMindmapBranchSide(graph, childId, side);

  const currentOrder = getOrderedMindmapChildIds(graph, parentId).filter((id) => id !== childId);
  let leftIds = currentOrder.filter((id) => getMindmapBranchSide(graph, id) === 'left');
  let rightIds = currentOrder.filter((id) => getMindmapBranchSide(graph, id) !== 'left');

  const targetBranch = side === 'left' ? leftIds : rightIds;
  if (insertBeforeId && targetBranch.includes(insertBeforeId)) {
    targetBranch.splice(targetBranch.indexOf(insertBeforeId), 0, childId);
  } else {
    targetBranch.push(childId);
  }

  if (side === 'left') {
    leftIds = targetBranch;
  } else {
    rightIds = targetBranch;
  }

  setMindmapChildOrder(graph, parentId, [...leftIds, ...rightIds]);
}

export function removeMindmapChildFromOrder(graph: Graph, parentId: string, childId: string) {
  const order = getOrderedMindmapChildIds(graph, parentId).filter((id) => id !== childId);
  setMindmapChildOrder(graph, parentId, order);
}

function getParentIdMap(graph: Graph): Map<string, string> {
  const parentByChild = new Map<string, string>();
  graph.getEdges().forEach((edge) => {
    const source = edge.getSourceCellId();
    const target = edge.getTargetCellId();
    if (!source || !target || !graph.isNode(graph.getCellById(source))) return;
    if (!graph.isNode(graph.getCellById(target))) return;
    parentByChild.set(target, source);
  });
  return parentByChild;
}

function buildChildrenByParent(graph: Graph): Map<string, string[]> {
  const childrenByParent = new Map<string, string[]>();
  graph.getEdges().forEach((edge) => {
    const source = edge.getSourceCellId();
    const target = edge.getTargetCellId();
    if (!source || !target) return;
    if (!childrenByParent.has(source)) childrenByParent.set(source, []);
    childrenByParent.get(source)!.push(target);
  });

  for (const [parentId, childIds] of childrenByParent.entries()) {
    const ordered = getOrderedMindmapChildIds(graph, parentId);
    childrenByParent.set(parentId, ordered.filter((id) => childIds.includes(id)));
  }

  const preview = mindmapLayoutPreviewAttach;
  if (preview) {
    for (const [parentId, childIds] of childrenByParent.entries()) {
      childrenByParent.set(parentId, childIds.filter((id) => id !== preview.childId));
    }
    const previewChildren = (childrenByParent.get(preview.parentId) ?? []).filter(
      (id) => id !== preview.childId,
    );
    const leftIds = previewChildren.filter((id) => getMindmapBranchSide(graph, id) === 'left');
    const rightIds = previewChildren.filter((id) => getMindmapBranchSide(graph, id) !== 'left');
    const branchIds = preview.side === 'left' ? leftIds : rightIds;
    if (preview.insertBeforeId && branchIds.includes(preview.insertBeforeId)) {
      branchIds.splice(branchIds.indexOf(preview.insertBeforeId), 0, preview.childId);
    } else {
      branchIds.push(preview.childId);
    }
    if (preview.side === 'left') {
      childrenByParent.set(preview.parentId, [...leftIds, ...rightIds]);
    } else {
      childrenByParent.set(preview.parentId, [...leftIds, ...rightIds]);
    }
  }

  return childrenByParent;
}

export function isMindmapFreeTopic(node: Node): boolean {
  const data = node.getData<Record<string, unknown>>() ?? {};
  return data.mindRole === MINDMAP_FREE_TOPIC_ROLE || data.mindFree === true;
}

export function applyMindmapTopicStyle(node: Node) {
  const data = node.getData<Record<string, unknown>>() ?? {};
  const isRoot = data.mindRole === 'root';
  const isFree = isMindmapFreeTopic(node);
  node.attr({
    body: {
      fill: isRoot ? '#e6f4ff' : (isFree ? '#fffbe6' : '#f6ffed'),
      stroke: isRoot ? '#1677ff' : (isFree ? '#d48806' : '#52c41a'),
      strokeWidth: isRoot ? 2 : 1.6,
      strokeDasharray: isFree ? '5 4' : '',
      rx: isRoot ? 20 : 14,
      ry: isRoot ? 20 : 14,
    },
    label: {
      fill: isRoot ? '#003a8c' : (isFree ? '#874d00' : '#135200'),
      fontSize: isRoot ? 15 : 14,
      fontWeight: isRoot ? 700 : 600,
    },
  });
}

export function findMindmapRootId(graph: Graph): string | null {
  const nodes = graph.getNodes();
  if (!nodes.length) return null;

  const explicitRoot = nodes.find((node) => node.getData<Record<string, any>>()?.mindRole === 'root');
  if (explicitRoot) return explicitRoot.id;

  const parentByChild = getParentIdMap(graph);
  const roots = nodes.filter((node) => !parentByChild.has(node.id));
  if (roots.length === 1) return roots[0].id;

  return nodes[0]?.id ?? null;
}

function buildTree(graph: Graph, rootId: string): MindmapTreeNode | null {
  const nodeById = new Map(graph.getNodes().map((node) => [node.id, node]));
  const rootNode = nodeById.get(rootId);
  if (!rootNode) return null;

  const childrenByParent = buildChildrenByParent(graph);

  const visit = (id: string): MindmapTreeNode => {
    const node = nodeById.get(id)!;
    const { width, height } = getNodeSize(node);
    const childIds = (childrenByParent.get(id) ?? []).filter((childId) => {
      const childNode = nodeById.get(childId);
      return childNode?.isVisible() !== false;
    });
    const childTrees = childIds.map((childId) => visit(childId));
    const leftChildren = childTrees.filter((child) => getMindmapBranchSide(graph, child.id) === 'left');
    const rightChildren = childTrees.filter((child) => getMindmapBranchSide(graph, child.id) !== 'left');
    const subtreeHeight = Math.max(
      height,
      stackHeight(leftChildren),
      stackHeight(rightChildren),
    );
    return {
      id,
      leftChildren,
      rightChildren,
      width,
      height,
      subtreeHeight,
    };
  };

  return visit(rootId);
}

function assignPositions(
  tree: MindmapTreeNode,
  originX: number,
  originY: number,
  positions: Map<string, { x: number; y: number }>,
) {
  const placeSubtree = (node: MindmapTreeNode, x: number, y: number) => {
    positions.set(node.id, { x, y });

    const layoutBranch = (children: MindmapTreeNode[], side: MindmapDropSide) => {
      if (!children.length) return;
      const totalHeight = stackHeight(children);
      let childY = y + node.subtreeHeight / 2 - totalHeight / 2;
      children.forEach((child) => {
        const childX = side === 'left'
          ? x - H_GAP - child.width
          : x + node.width + H_GAP;
        placeSubtree(child, childX, childY);
        childY += child.subtreeHeight + V_GAP;
      });
    };

    layoutBranch(node.leftChildren, 'left');
    layoutBranch(node.rightChildren, 'right');
  };

  placeSubtree(tree, originX, originY);
}

export function computeMindmapLayoutPositions(graph: Graph): Map<string, { x: number; y: number }> {
  const rootId = findMindmapRootId(graph);
  if (!rootId) return new Map();

  const tree = buildTree(graph, rootId);
  if (!tree) return new Map();
  const rootNode = graph.getCellById(rootId);
  const rootPosition = rootNode && graph.isNode(rootNode)
    ? rootNode.getPosition()
    : { x: 360, y: 220 };

  const positions = new Map<string, { x: number; y: number }>();
  assignPositions(tree, rootPosition.x, rootPosition.y, positions);
  return positions;
}

export function resolveMindmapInsertBeforeId(
  graph: Graph,
  parentId: string,
  draggedNodeId: string,
  branchSide: MindmapDropSide,
  compareY: number,
  layoutPositions: Map<string, { x: number; y: number }>,
): string | null {
  const siblings = getOrderedMindmapChildIds(graph, parentId)
    .filter((id) => id !== draggedNodeId && getMindmapBranchSide(graph, id) === branchSide);

  for (const siblingId of siblings) {
    const pos = layoutPositions.get(siblingId);
    if (!pos) continue;
    const sibling = graph.getCellById(siblingId);
    if (!sibling || !graph.isNode(sibling)) continue;
    const { height } = getNodeSize(sibling);
    if (pos.y + height / 2 > compareY) {
      return siblingId;
    }
  }
  return null;
}

export function computeMindmapInsertBeforeId(
  graph: Graph,
  parentId: string,
  draggedNodeId: string,
  branchSide: MindmapDropSide,
  compareY: number,
): string | null {
  const savedPreview = mindmapLayoutPreviewAttach;
  setMindmapLayoutPreview({
    childId: draggedNodeId,
    parentId,
    side: branchSide,
    insertBeforeId: null,
  });
  const layoutPositions = computeMindmapLayoutPositions(graph);
  const insertBeforeId = resolveMindmapInsertBeforeId(
    graph,
    parentId,
    draggedNodeId,
    branchSide,
    compareY,
    layoutPositions,
  );
  setMindmapLayoutPreview(savedPreview);
  return insertBeforeId;
}

export function syncMindmapEdgePorts(graph: Graph, silent = false) {
  const cellOptions = silent ? { silent: true } : undefined;
  graph.getEdges().forEach((edge) => {
    if (edge.id === MINDMAP_DRAG_PREVIEW_EDGE_ID) return;
    const targetId = edge.getTargetCellId();
    const sourceId = edge.getSourceCellId();
    if (!targetId || !sourceId) return;
    const targetNode = graph.getCellById(targetId);
    if (!targetNode || !graph.isNode(targetNode)) return;
    const ports = getMindmapEdgePorts(getMindmapBranchSide(graph, targetId));
    edge.setSource({ cell: sourceId, port: ports.sourcePort }, cellOptions);
    edge.setTarget({ cell: targetId, port: ports.targetPort }, cellOptions);
  });
}

export const MINDMAP_DRAG_PREVIEW_EDGE_ID = '__mindmap-drag-preview-edge__';
export const MINDMAP_DRAG_PREVIEW_OPTION = '__mindmapDragPreview';

export function layoutMindmapGraph(graph: Graph, direction: MindmapDirection = 'LR') {
  const rootId = findMindmapRootId(graph);
  if (!rootId) return;

  const positions = computeMindmapLayoutPositions(graph);
  if (!positions.size) return;

  const previewActive = mindmapLayoutPreviewAttach != null;
  const skipIds = previewActive ? new Set<string>() : mindmapLayoutSkipNodeIds;

  graph.batchUpdate(() => {
    positions.forEach((pos, id) => {
      if (skipIds.has(id)) return;
      const node = graph.getCellById(id);
      if (node && graph.isNode(node)) {
        if (isMindmapFreeTopic(node)) return;
        node.position(pos.x, pos.y);
      }
    });

    graph.getNodes().forEach((node) => {
      if (isMindmapFreeTopic(node)) {
        applyMindmapTopicStyle(node);
      }
    });

    graph.getEdges().forEach((edge) => {
      if (edge.id === MINDMAP_DRAG_PREVIEW_EDGE_ID) return;
      edge.setRouter({ name: 'normal' });
      edge.setConnector({ name: 'smooth' });
      edge.attr({
        line: {
          stroke: '#8c8c8c',
          strokeWidth: 2,
          targetMarker: {
            name: 'classic',
            size: 8,
          },
        },
      });
    });

    syncMindmapEdgePorts(graph);
  });
}

export function syncMindmapEdgeStyles(graph: Graph) {
  graph.getEdges().forEach((edge) => {
    if (edge.id === MINDMAP_DRAG_PREVIEW_EDGE_ID) return;
    edge.setRouter({ name: 'normal' });
    edge.setConnector({ name: 'smooth' });
    edge.attr({
      line: {
        stroke: '#8c8c8c',
        strokeWidth: 2,
        targetMarker: {
          name: 'classic',
          size: 8,
        },
      },
    });
  });
  syncMindmapEdgePorts(graph);
}

function getSelectedMindmapNode(graph: Graph): Node | null {
  const selected = graph.getSelectedCells().filter((cell) => graph.isNode(cell)) as Node[];
  return selected.length === 1 ? selected[0] : null;
}

export function addMindmapChild(graph: Graph, parent?: Node | null): Node | null {
  const parentNode = parent ?? getSelectedMindmapNode(graph) ?? (() => {
    const rootId = findMindmapRootId(graph);
    return rootId ? graph.getCellById(rootId) as Node : null;
  })();

  if (!parentNode || !graph.isNode(parentNode)) return null;

  const child = graph.addNode(createMindmapNode({
    id: createId('mindmap-topic'),
    label: '新分支',
    mindRole: 'topic' as MindmapNodeRole,
  }));

  graph.addEdge(createMindmapEdgeMetadata(parentNode.id, child.id));
  graph.cleanSelection();
  graph.select(child);

  const direction = (graph as any).__mindmapDirection as MindmapDirection | undefined;
  layoutMindmapGraph(graph, direction ?? 'LR');
  return child;
}

export function addMindmapSibling(graph: Graph, node?: Node | null): Node | null {
  const current = node ?? getSelectedMindmapNode(graph);
  if (!current) return addMindmapChild(graph);

  const parentByChild = getParentIdMap(graph);
  const parentId = parentByChild.get(current.id);
  if (!parentId) {
    return addMindmapChild(graph, current);
  }

  const parentNode = graph.getCellById(parentId);
  if (!parentNode || !graph.isNode(parentNode)) return null;

  const sibling = graph.addNode(createMindmapNode({
    id: createId('mindmap-topic'),
    label: '同级分支',
    mindRole: 'topic',
  }));

  graph.addEdge(createMindmapEdgeMetadata(parentNode.id, sibling.id));
  graph.cleanSelection();
  graph.select(sibling);

  const direction = (graph as any).__mindmapDirection as MindmapDirection | undefined;
  layoutMindmapGraph(graph, direction ?? 'LR');
  return sibling;
}

export function collectMindmapDescendantIds(graph: Graph, rootId: string): string[] {
  const result: string[] = [];
  const childrenByParent = new Map<string, string[]>();
  graph.getEdges().forEach((edge) => {
    const source = edge.getSourceCellId();
    const target = edge.getTargetCellId();
    if (!source || !target) return;
    if (!childrenByParent.has(source)) childrenByParent.set(source, []);
    childrenByParent.get(source)!.push(target);
  });

  const walk = (id: string) => {
    result.push(id);
    (childrenByParent.get(id) ?? []).forEach(walk);
  };

  walk(rootId);
  return result;
}

export function deleteMindmapSelection(graph: Graph): boolean {
  const selected = getSelectedMindmapNode(graph);
  if (!selected) return false;

  const rootId = findMindmapRootId(graph);
  if (selected.id === rootId) {
    const descendants = collectMindmapDescendantIds(graph, rootId);
    const toRemove = graph.getCells().filter((cell) => descendants.includes(cell.id) && cell.id !== rootId);
    if (toRemove.length) {
      graph.removeCells(toRemove);
    }
    selected.attr('label/text', '中心主题');
    return true;
  }

  const ids = collectMindmapDescendantIds(graph, selected.id);
  const cells = graph.getCells().filter((cell) => ids.includes(cell.id));
  graph.removeCells(cells);

  const direction = (graph as any).__mindmapDirection as MindmapDirection | undefined;
  layoutMindmapGraph(graph, direction ?? 'LR');
  return true;
}

export function readMindmapDirection(data?: GraphData | null): MindmapDirection {
  const direction = data?.blueprintMeta?.direction;
  if (direction === 'LR' || direction === 'RL' || direction === 'TB' || direction === 'BT') {
    return direction;
  }
  return 'LR';
}

export function attachMindmapDirection(graph: Graph, data?: GraphData | null) {
  (graph as any).__mindmapDirection = readMindmapDirection(data);
}

export function canConnectMindmapEdge(
  graph: Graph,
  sourceCell: Node,
  targetCell: Node,
  excludeEdgeId?: string | null,
): boolean {
  if (sourceCell.id === targetCell.id) return false;

  const parentByChild = getParentIdMap(graph);
  if (parentByChild.has(targetCell.id)) return false;

  const incoming = (graph.getIncomingEdges(targetCell) ?? []).filter(
    (edge) => edge.id !== excludeEdgeId,
  );
  if (incoming.some((edge) => edge.getSourceCellId() === sourceCell.id)) return false;

  let cursor: string | undefined = sourceCell.id;
  while (cursor) {
    if (cursor === targetCell.id) return false;
    cursor = parentByChild.get(cursor);
  }

  return true;
}
