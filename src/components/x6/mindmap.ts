import type { Graph, Node } from '@antv/x6';
import type { GraphData } from '@/api/types';
import { createId } from './cellUtils';
import {
  createMindmapEdgeMetadata,
  createMindmapNode,
  type MindmapNodeRole,
} from './graphCells';

export type MindmapDirection = 'LR' | 'RL' | 'TB' | 'BT';

const H_GAP = 88;
const V_GAP = 16;
const DEFAULT_NODE_WIDTH = 156;
const DEFAULT_NODE_HEIGHT = 48;
const ROOT_NODE_WIDTH = 180;
const ROOT_NODE_HEIGHT = 56;

interface MindmapTreeNode {
  id: string;
  children: MindmapTreeNode[];
  width: number;
  height: number;
  subtreeHeight: number;
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

  const childrenByParent = new Map<string, string[]>();
  graph.getEdges().forEach((edge) => {
    const source = edge.getSourceCellId();
    const target = edge.getTargetCellId();
    if (!source || !target) return;
    if (!childrenByParent.has(source)) childrenByParent.set(source, []);
    childrenByParent.get(source)!.push(target);
  });

  const visit = (id: string): MindmapTreeNode => {
    const node = nodeById.get(id)!;
    const { width, height } = getNodeSize(node);
    const childIds = (childrenByParent.get(id) ?? []).filter((childId) => {
      const childNode = nodeById.get(childId);
      return childNode?.isVisible() !== false;
    });
    const children = childIds.map((childId) => visit(childId));
    const subtreeHeight = children.length
      ? children.reduce((sum, child) => sum + child.subtreeHeight + V_GAP, -V_GAP)
      : height;
    return {
      id,
      children,
      width,
      height,
      subtreeHeight: Math.max(height, subtreeHeight),
    };
  };

  return visit(rootId);
}

function assignPositions(
  tree: MindmapTreeNode,
  direction: MindmapDirection,
  originX: number,
  originY: number,
  positions: Map<string, { x: number; y: number }>,
) {
  const placeSubtree = (node: MindmapTreeNode, x: number, y: number) => {
    positions.set(node.id, { x, y });
    if (!node.children.length) return;

    let childY = y + node.subtreeHeight / 2 - (
      node.children.reduce((sum, child) => sum + child.subtreeHeight + V_GAP, -V_GAP) / 2
    );

    node.children.forEach((child) => {
      const childX = direction === 'LR'
        ? x + node.width + H_GAP
        : direction === 'RL'
          ? x - child.width - H_GAP
          : x;
      const childPosY = direction === 'TB'
        ? y + node.height + H_GAP
        : direction === 'BT'
          ? y - child.subtreeHeight
          : childY;
      placeSubtree(child, childX, childPosY);
      if (direction === 'LR' || direction === 'RL') {
        childY += child.subtreeHeight + V_GAP;
      }
    });
  };

  placeSubtree(tree, originX, originY - tree.subtreeHeight / 2 + tree.height / 2);
}

export function layoutMindmapGraph(graph: Graph, direction: MindmapDirection = 'LR') {
  const rootId = findMindmapRootId(graph);
  if (!rootId) return;

  const tree = buildTree(graph, rootId);
  if (!tree) return;

  const positions = new Map<string, { x: number; y: number }>();
  assignPositions(tree, direction, 80, 220, positions);

  graph.batchUpdate(() => {
    positions.forEach((pos, id) => {
      const node = graph.getCellById(id);
      if (node && graph.isNode(node)) {
        node.position(pos.x, pos.y);
      }
    });

    graph.getEdges().forEach((edge) => {
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
  });
}

export function syncMindmapEdgeStyles(graph: Graph) {
  graph.getEdges().forEach((edge) => {
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
