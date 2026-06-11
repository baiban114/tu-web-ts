import type { Graph, Node } from '@antv/x6';
import { createMindmapEdgeMetadata } from './graphCells';
import {
  MINDMAP_DRAG_PREVIEW_EDGE_ID,
  MINDMAP_DRAG_PREVIEW_OPTION,
  MINDMAP_FREE_TOPIC_ROLE,
  applyMindmapTopicStyle,
  collectMindmapDescendantIds,
  computeMindmapInsertBeforeId,
  findMindmapRootId,
  getOrderedMindmapChildIds,
  insertMindmapChildOrder,
  layoutMindmapGraph,
  removeMindmapChildFromOrder,
  setMindmapDragPreviewActive,
  setMindmapDragSession,
  syncMindmapEdgeStyles,
  type MindmapDirection,
  type MindmapDropSide,
  type MindmapDropTarget,
  type MindmapLayoutPreviewAttach,
} from './mindmap';
import { getMindmapEdgePorts } from './ports';

export type { MindmapDropSide, MindmapDropTarget };

interface NodeBBox {
  x: number;
  y: number;
  width: number;
  height: number;
}

let activeDropTarget: MindmapDropTarget | null = null;
let lastDragPointer: { x: number; y: number } | null = null;
let dragStartNodePositions = new Map<string, { x: number; y: number }>();

const DROP_TARGET_HIT_PADDING = 6;
const SUBTREE_H_GAP = 88;
const SUBTREE_V_GAP = 16;

function pointInBBox(x: number, y: number, bbox: NodeBBox, padding = 0): boolean {
  return (
    x >= bbox.x - padding
    && x <= bbox.x + bbox.width + padding
    && y >= bbox.y - padding
    && y <= bbox.y + bbox.height + padding
  );
}

function computeDropSide(pointer: { x: number; y: number }, targetNode: Node): MindmapDropSide {
  const targetCenter = getNodeCenter(targetNode);
  return pointer.x < targetCenter.x ? 'left' : 'right';
}

function isPointerOverTargetNode(
  pointer: { x: number; y: number },
  targetNode: Node,
  draggedNode: Node,
): boolean {
  const targetBBox = getNodeBBox(targetNode);
  if (pointInBBox(pointer.x, pointer.y, targetBBox, DROP_TARGET_HIT_PADDING)) {
    return true;
  }
  const dragged = getNodeCenter(draggedNode);
  if (bboxIntersects(dragged.bbox, targetBBox)) {
    return true;
  }
  return false;
}

export function resetMindmapDragDropState() {
  activeDropTarget = null;
  lastDragPointer = null;
}

export function getLastMindmapDragPointer(): { x: number; y: number } | null {
  return lastDragPointer;
}

function getNodeBBox(node: Node): NodeBBox {
  const pos = node.getPosition();
  const size = node.getSize();
  return {
    x: pos.x,
    y: pos.y,
    width: size.width,
    height: size.height,
  };
}

function getNodeCenter(node: Node) {
  const bbox = getNodeBBox(node);
  return {
    x: bbox.x + bbox.width / 2,
    y: bbox.y + bbox.height / 2,
    bbox,
  };
}

function getNodeSize(node: Node) {
  const size = node.getSize();
  return {
    width: size.width || 156,
    height: size.height || 48,
  };
}

function bboxIntersects(a: NodeBBox, b: NodeBBox): boolean {
  return !(
    a.x + a.width < b.x
    || b.x + b.width < a.x
    || a.y + a.height < b.y
    || b.y + b.height < a.y
  );
}

function bboxOverlapArea(a: NodeBBox, b: NodeBBox): number {
  const overlapX = Math.min(a.x + a.width, b.x + b.width) - Math.max(a.x, b.x);
  const overlapY = Math.min(a.y + a.height, b.y + b.height) - Math.max(a.y, b.y);
  if (overlapX <= 0 || overlapY <= 0) return 0;
  return overlapX * overlapY;
}

export function findMindmapDropTarget(
  graph: Graph,
  pointer: { x: number; y: number },
  draggedNode: Node,
  excludedNodeIds: ReadonlySet<string>,
): MindmapDropTarget | null {
  if (activeDropTarget) {
    const stickyNode = graph.getCellById(activeDropTarget.nodeId);
    if (
      stickyNode
      && graph.isNode(stickyNode)
      && !excludedNodeIds.has(stickyNode.id)
      && stickyNode.isVisible() !== false
      && isPointerOverTargetNode(pointer, stickyNode, draggedNode)
    ) {
      activeDropTarget = {
        nodeId: stickyNode.id,
        side: computeDropSide(pointer, stickyNode),
      };
      return activeDropTarget;
    }
  }

  let bestTarget: MindmapDropTarget | null = null;
  let bestScore = 0;

  for (const node of graph.getNodes()) {
    if (node.id === draggedNode.id) continue;
    if (excludedNodeIds.has(node.id)) continue;
    if (node.isVisible() === false) continue;
    if (!isPointerOverTargetNode(pointer, node, draggedNode)) continue;

    const targetBBox = getNodeBBox(node);
    const pointerInside = pointInBBox(pointer.x, pointer.y, targetBBox, DROP_TARGET_HIT_PADDING) ? 1 : 0;
    const overlap = bboxOverlapArea(getNodeCenter(draggedNode).bbox, targetBBox);
    const score = overlap + pointerInside * 100000;
    if (!bestTarget || score > bestScore) {
      bestTarget = {
        nodeId: node.id,
        side: computeDropSide(pointer, node),
      };
      bestScore = score;
    }
  }

  activeDropTarget = bestTarget;
  return bestTarget;
}

function buildPreviewAttach(
  graph: Graph,
  draggedNode: Node,
  target: MindmapDropTarget,
): MindmapLayoutPreviewAttach | null {
  const targetNode = graph.getCellById(target.nodeId);
  if (!targetNode || !graph.isNode(targetNode)) return null;
  if (!canReparentMindmapNode(graph, targetNode, draggedNode)) return null;

  return {
    childId: draggedNode.id,
    parentId: target.nodeId,
    side: target.side,
    insertBeforeId: null,
  };
}

function upsertMindmapDragPreviewEdge(
  graph: Graph,
  preview: MindmapLayoutPreviewAttach,
) {
  const ports = getMindmapEdgePorts(preview.side);
  const lineColor = preview.side === 'left' ? '#1677ff' : '#722ed1';
  const edgeAttrs = {
    line: {
      stroke: lineColor,
      strokeWidth: 2.6,
      strokeDasharray: '6 4',
      'data-source-port': ports.sourcePort,
      'data-target-port': ports.targetPort,
      targetMarker: {
        name: 'classic',
        size: 8,
      },
    },
  };

  const existing = graph.getCellById(MINDMAP_DRAG_PREVIEW_EDGE_ID);
  if (existing && graph.isEdge(existing)) {
    const options = { [MINDMAP_DRAG_PREVIEW_OPTION]: true };
    existing.setSource({ cell: preview.parentId, port: ports.sourcePort }, options);
    existing.setTarget({ cell: preview.childId, port: ports.targetPort }, options);
    existing.setRouter({ name: 'normal' }, options);
    existing.setConnector({ name: 'smooth' }, options);
    existing.attr(edgeAttrs, options);
    existing.setZIndex(10, options);
    return;
  }

  graph.addEdge({
    id: MINDMAP_DRAG_PREVIEW_EDGE_ID,
    shape: 'edge',
    source: { cell: preview.parentId, port: ports.sourcePort },
    target: { cell: preview.childId, port: ports.targetPort },
    router: { name: 'normal' },
    connector: { name: 'smooth' },
    attrs: edgeAttrs,
    zIndex: 10,
  }, { [MINDMAP_DRAG_PREVIEW_OPTION]: true });
}

function clearMindmapDragPreviewVisuals(graph: Graph) {
  const previewEdge = graph.getCellById(MINDMAP_DRAG_PREVIEW_EDGE_ID);
  if (previewEdge) {
    graph.removeCell(previewEdge, { [MINDMAP_DRAG_PREVIEW_OPTION]: true });
  }
}

function getExcludedDropTargetIds(graph: Graph, draggedNode: Node): Set<string> {
  return new Set(collectMindmapDescendantIds(graph, draggedNode.id));
}

function captureStableNodePositions(
  graph: Graph,
  excludedNodeIds: ReadonlySet<string>,
): Map<string, { x: number; y: number }> {
  const positions = new Map<string, { x: number; y: number }>();
  graph.getNodes().forEach((node) => {
    if (excludedNodeIds.has(node.id)) return;
    positions.set(node.id, node.getPosition());
  });
  return positions;
}

function captureAllNodePositions(graph: Graph): Map<string, { x: number; y: number }> {
  const positions = new Map<string, { x: number; y: number }>();
  graph.getNodes().forEach((node) => {
    positions.set(node.id, node.getPosition());
  });
  return positions;
}

function restoreStableNodePositions(graph: Graph, positions: Map<string, { x: number; y: number }>) {
  positions.forEach((position, nodeId) => {
    const node = graph.getCellById(nodeId);
    if (node && graph.isNode(node)) {
      node.position(position.x, position.y);
    }
  });
}

function removeIncomingMindmapEdges(graph: Graph, nodeId: string) {
  const node = graph.getCellById(nodeId);
  if (!node || !graph.isNode(node)) return;

  (graph.getIncomingEdges(node) ?? []).forEach((edge) => {
    const parentId = edge.getSourceCellId();
    if (parentId) {
      removeMindmapChildFromOrder(graph, parentId, nodeId);
    }
    graph.removeEdge(edge.id);
  });
}

function canReparentMindmapNode(graph: Graph, newParent: Node, draggedNode: Node): boolean {
  if (newParent.id === draggedNode.id) return false;

  const parentByChild = getParentIdMapForReparent(graph);
  let cursor: string | undefined = newParent.id;
  while (cursor) {
    if (cursor === draggedNode.id) return false;
    cursor = parentByChild.get(cursor);
  }
  return true;
}

function getParentIdMapForReparent(graph: Graph): Map<string, string> {
  const parentByChild = new Map<string, string>();
  graph.getEdges().forEach((edge) => {
    const source = edge.getSourceCellId();
    const target = edge.getTargetCellId();
    if (!source || !target) return;
    if (edge.id === MINDMAP_DRAG_PREVIEW_EDGE_ID) return;
    parentByChild.set(target, source);
  });
  return parentByChild;
}

interface LocalTreeNode {
  id: string;
  children: LocalTreeNode[];
  width: number;
  height: number;
  subtreeHeight: number;
}

function getSubtreeHeight(children: LocalTreeNode[]): number {
  if (!children.length) return 0;
  return children.reduce((sum, child) => sum + child.subtreeHeight + SUBTREE_V_GAP, -SUBTREE_V_GAP);
}

function buildLocalTree(graph: Graph, rootId: string): LocalTreeNode | null {
  const node = graph.getCellById(rootId);
  if (!node || !graph.isNode(node)) return null;
  const size = getNodeSize(node);
  const children = getOrderedMindmapChildIds(graph, rootId)
    .map((childId) => buildLocalTree(graph, childId))
    .filter((child): child is LocalTreeNode => child != null);

  return {
    id: rootId,
    children,
    width: size.width,
    height: size.height,
    subtreeHeight: Math.max(size.height, getSubtreeHeight(children)),
  };
}

function positionLocalSubtree(
  graph: Graph,
  tree: LocalTreeNode,
  x: number,
  y: number,
  side: MindmapDropSide,
) {
  const node = graph.getCellById(tree.id);
  if (node && graph.isNode(node)) {
    node.position(x, y);
  }

  if (!tree.children.length) return;

  const totalHeight = getSubtreeHeight(tree.children);
  let childY = y + tree.subtreeHeight / 2 - totalHeight / 2;
  tree.children.forEach((child) => {
    const childX = side === 'left'
      ? x - SUBTREE_H_GAP - child.width
      : x + tree.width + SUBTREE_H_GAP;
    positionLocalSubtree(graph, child, childX, childY, side);
    childY += child.subtreeHeight + SUBTREE_V_GAP;
  });
}

function anchorDraggedSubtreeToTarget(
  graph: Graph,
  draggedNode: Node,
  targetNode: Node,
  side: MindmapDropSide,
) {
  const draggedTree = buildLocalTree(graph, draggedNode.id);
  if (!draggedTree) return;

  const targetPosition = targetNode.getPosition();
  const targetSize = getNodeSize(targetNode);
  const draggedPosition = draggedNode.getPosition();
  const x = side === 'left'
    ? targetPosition.x - SUBTREE_H_GAP - draggedTree.width
    : targetPosition.x + targetSize.width + SUBTREE_H_GAP;

  positionLocalSubtree(graph, draggedTree, x, draggedPosition.y, side);
}

export function updateMindmapDragPreview(
  graph: Graph,
  draggedNode: Node,
  pointer: { x: number; y: number },
): MindmapDropTarget | null {
  lastDragPointer = pointer;
  const excluded = getExcludedDropTargetIds(graph, draggedNode);
  const target = findMindmapDropTarget(graph, pointer, draggedNode, excluded);

  if (!target) {
    activeDropTarget = null;
    setMindmapDragPreviewActive(false);
    clearMindmapDragPreviewVisuals(graph);
    return null;
  }

  const preview = buildPreviewAttach(graph, draggedNode, target);
  if (!preview) {
    activeDropTarget = null;
    setMindmapDragPreviewActive(false);
    clearMindmapDragPreviewVisuals(graph);
    return null;
  }

  setMindmapDragPreviewActive(true);
  upsertMindmapDragPreviewEdge(graph, preview);
  return target;
}

export function clearMindmapDragPreview(graph: Graph, direction: MindmapDirection) {
  resetMindmapDragDropState();
  clearMindmapDragPreviewVisuals(graph);
  setMindmapDragPreviewActive(false);
  setMindmapDragSession(null);
  dragStartNodePositions = new Map();
  layoutMindmapGraph(graph, direction);
}

export function beginMindmapNodeDrag(graph: Graph, nodeId: string) {
  resetMindmapDragDropState();
  dragStartNodePositions = captureAllNodePositions(graph);
  setMindmapDragSession(nodeId, graph);
}

export function endMindmapNodeDrag(
  graph: Graph,
  direction: MindmapDirection,
  options: { layout?: boolean } = {},
) {
  resetMindmapDragDropState();
  clearMindmapDragPreviewVisuals(graph);
  setMindmapDragPreviewActive(false);
  setMindmapDragSession(null);
  dragStartNodePositions = new Map();
  if (options.layout === false) {
    syncMindmapEdgeStyles(graph);
  } else {
    layoutMindmapGraph(graph, direction);
  }
}

export function reparentMindmapNode(
  graph: Graph,
  draggedNode: Node,
  target: MindmapDropTarget,
  pointer?: { x: number; y: number } | null,
): boolean {
  const targetNode = graph.getCellById(target.nodeId);
  if (!targetNode || !graph.isNode(targetNode)) return false;
  if (!canReparentMindmapNode(graph, targetNode, draggedNode)) return false;

  const rootId = findMindmapRootId(graph);
  if (!rootId || draggedNode.id === rootId) return false;
  const draggedSubtreeIds = new Set(collectMindmapDescendantIds(graph, draggedNode.id));
  const stablePositions = dragStartNodePositions.size
    ? new Map(
      Array.from(dragStartNodePositions.entries()).filter(([nodeId]) => !draggedSubtreeIds.has(nodeId)),
    )
    : captureStableNodePositions(graph, draggedSubtreeIds);

  graph.batchUpdate(() => {
    removeIncomingMindmapEdges(graph, draggedNode.id);
    graph.addEdge(createMindmapEdgeMetadata(target.nodeId, draggedNode.id, undefined, target.side));
    const compareY = pointer?.y ?? getNodeCenter(draggedNode).y;
    const insertBeforeId = computeMindmapInsertBeforeId(
      graph,
      target.nodeId,
      draggedNode.id,
      target.side,
      compareY,
    );
    insertMindmapChildOrder(
      graph,
      target.nodeId,
      draggedNode.id,
      target.side,
      insertBeforeId,
    );
    draggedNode.setData({
      ...draggedNode.getData(),
      mindRole: 'topic',
      mindFree: false,
    });
    applyMindmapTopicStyle(draggedNode);
    anchorDraggedSubtreeToTarget(graph, draggedNode, targetNode, target.side);
    restoreStableNodePositions(graph, stablePositions);
  });

  return true;
}

export function detachMindmapAsFreeTopic(graph: Graph, draggedNode: Node): boolean {
  const rootId = findMindmapRootId(graph);
  if (!rootId || draggedNode.id === rootId) return false;
  const draggedSubtreeIds = new Set(collectMindmapDescendantIds(graph, draggedNode.id));
  const stablePositions = dragStartNodePositions.size
    ? new Map(
      Array.from(dragStartNodePositions.entries()).filter(([nodeId]) => !draggedSubtreeIds.has(nodeId)),
    )
    : captureStableNodePositions(graph, draggedSubtreeIds);

  graph.batchUpdate(() => {
    removeIncomingMindmapEdges(graph, draggedNode.id);
    draggedNode.setData({
      ...draggedNode.getData(),
      mindRole: MINDMAP_FREE_TOPIC_ROLE,
      mindFree: true,
    });
    applyMindmapTopicStyle(draggedNode);
    restoreStableNodePositions(graph, stablePositions);
  });

  return true;
}

export function commitMindmapDragDrop(
  graph: Graph,
  draggedNode: Node,
  dropTarget: MindmapDropTarget | null,
  pointer?: { x: number; y: number } | null,
): 'reparent' | 'free' | 'unchanged' {
  const rootId = findMindmapRootId(graph);
  if (!rootId || draggedNode.id === rootId) {
    return 'unchanged';
  }

  if (dropTarget) {
    const targetNode = graph.getCellById(dropTarget.nodeId);
    if (targetNode && graph.isNode(targetNode) && canReparentMindmapNode(graph, targetNode, draggedNode)) {
      if (reparentMindmapNode(graph, draggedNode, dropTarget, pointer)) {
        return 'reparent';
      }
    }
  }

  if (detachMindmapAsFreeTopic(graph, draggedNode)) {
    return 'free';
  }

  return 'unchanged';
}
