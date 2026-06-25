import type { KnowledgeAnchor, KnowledgePoint, KnowledgePointAnchor } from '@/api/types';
import { DEFAULT_PAGE_SIZE } from '@/constants/pagination';
import type { PageResult } from '@/constants/pagination';
import { paginateSlice } from '@/utils/clientPagination';

const POINTS_KEY = 'tu-mock-knowledge-points';
const ANCHORS_KEY = 'tu-mock-knowledge-point-anchors';

function loadPoints(): KnowledgePoint[] {
  try {
    const raw = localStorage.getItem(POINTS_KEY);
    if (!raw) return [];
    return JSON.parse(raw) as KnowledgePoint[];
  } catch {
    return [];
  }
}

function savePoints(points: KnowledgePoint[]) {
  localStorage.setItem(POINTS_KEY, JSON.stringify(points));
}

function loadAnchors(): KnowledgePointAnchor[] {
  try {
    const raw = localStorage.getItem(ANCHORS_KEY);
    if (!raw) return [];
    return JSON.parse(raw) as KnowledgePointAnchor[];
  } catch {
    return [];
  }
}

function saveAnchors(anchors: KnowledgePointAnchor[]) {
  localStorage.setItem(ANCHORS_KEY, JSON.stringify(anchors));
}

function ensureDemoKnowledgePointsSeed(): void {
  if (loadPoints().length > 0) return;
  savePoints([
    {
      id: 'kp-demo-1',
      kbId: 'kb-demo-1',
      parentId: null,
      title: '基础概念',
      summary: '演示知识点：基础概念',
      status: 'active',
      estimatedHours: null,
      sortOrder: 0,
    },
    {
      id: 'kp-demo-2',
      kbId: 'kb-demo-1',
      parentId: 'kp-demo-1',
      title: '数据结构',
      summary: null,
      status: 'active',
      estimatedHours: 2,
      sortOrder: 0,
    },
  ]);
}

function newPointId(): string {
  return `kp-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
}

function newAnchorId(): string {
  return `kpa-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
}

function buildTree(points: KnowledgePoint[]): KnowledgePoint[] {
  const map = new Map(points.map((point) => [point.id, { ...point, children: [] as KnowledgePoint[] }]));
  const roots: KnowledgePoint[] = [];
  for (const point of map.values()) {
    if (point.parentId && map.has(point.parentId)) {
      map.get(point.parentId)!.children!.push(point);
    } else {
      roots.push(point);
    }
  }
  const sortNodes = (nodes: KnowledgePoint[]) => {
    nodes.sort((a, b) => a.sortOrder - b.sortOrder || a.title.localeCompare(b.title));
    nodes.forEach((node) => sortNodes(node.children ?? []));
  };
  sortNodes(roots);
  return roots;
}

export function getKnowledgePointTreeMock(kbId: string): KnowledgePoint[] {
  ensureDemoKnowledgePointsSeed();
  return buildTree(loadPoints().filter((item) => item.kbId === kbId));
}

export function listKnowledgePointsMock(
  kbId: string,
  params: { q?: string; page?: number; pageSize?: number },
): PageResult<KnowledgePoint> {
  ensureDemoKnowledgePointsSeed();
  const q = params.q?.trim().toLowerCase() ?? '';
  const filtered = loadPoints().filter((item) => {
    if (item.kbId !== kbId) return false;
    if (!q) return true;
    return `${item.title} ${item.summary ?? ''}`.toLowerCase().includes(q);
  });
  return paginateSlice(filtered, params.page ?? 0, params.pageSize ?? DEFAULT_PAGE_SIZE);
}

export function listKnowledgePointsByLocatorMock(kbId: string, locator: string): KnowledgePoint[] {
  const pointIds = new Set(
    loadAnchors()
      .filter((anchor) => anchor.locator === locator)
      .map((anchor) => anchor.knowledgePointId),
  );
  return loadPoints().filter((point) => point.kbId === kbId && pointIds.has(point.id));
}

export function findPointById(pointId: string): KnowledgePoint | undefined {
  return loadPoints().find((item) => item.id === pointId);
}

export function createKnowledgePointMock(
  kbId: string,
  payload: {
    parentId?: string | null;
    title: string;
    summary?: string;
    estimatedHours?: number | null;
    sourceAnchor?: KnowledgeAnchor;
  },
): KnowledgePoint {
  const points = loadPoints();
  const siblings = points.filter((item) => item.kbId === kbId && item.parentId === (payload.parentId ?? null));
  const point: KnowledgePoint = {
    id: newPointId(),
    kbId,
    parentId: payload.parentId ?? null,
    title: payload.title.trim(),
    summary: payload.summary ?? null,
    status: 'active',
    estimatedHours: payload.estimatedHours ?? null,
    sortOrder: siblings.length,
  };
  points.push(point);
  savePoints(points);
  if (payload.sourceAnchor) {
    addKnowledgePointAnchorMock(point.id, { anchor: payload.sourceAnchor, primary: true });
  }
  return point;
}

export function deleteKnowledgePointMock(id: string): void {
  savePoints(loadPoints().filter((item) => item.id !== id));
  saveAnchors(loadAnchors().filter((item) => item.knowledgePointId !== id));
}

export function listKnowledgePointAnchorsMock(pointId: string): KnowledgePointAnchor[] {
  return loadAnchors().filter((item) => item.knowledgePointId === pointId);
}

export function addKnowledgePointAnchorMock(
  pointId: string,
  payload: { anchor: KnowledgeAnchor; role?: string; primary?: boolean },
): KnowledgePointAnchor {
  const anchors = loadAnchors();
  if (payload.primary) {
    anchors.forEach((item) => {
      if (item.knowledgePointId === pointId) item.primary = false;
    });
  }
  const anchor: KnowledgePointAnchor = {
    id: newAnchorId(),
    knowledgePointId: pointId,
    kind: payload.anchor.kind,
    locator: payload.anchor.locator,
    snapshot: payload.anchor.snapshot,
    role: payload.role ?? 'primary',
    primary: payload.primary ?? false,
  };
  anchors.push(anchor);
  saveAnchors(anchors);
  return anchor;
}

export function ensurePointForAnchorMock(
  kbId: string,
  anchor: KnowledgeAnchor,
  title?: string,
): KnowledgePoint {
  const existing = listKnowledgePointsByLocatorMock(kbId, anchor.locator)[0];
  if (existing) return existing;
  const resolvedTitle = title?.trim()
    || (typeof anchor.snapshot?.title === 'string' ? anchor.snapshot.title : '')
    || '未命名知识点';
  return createKnowledgePointMock(kbId, { title: resolvedTitle, sourceAnchor: anchor });
}

export function clearKnowledgePointsMock(): void {
  localStorage.removeItem(POINTS_KEY);
  localStorage.removeItem(ANCHORS_KEY);
}
