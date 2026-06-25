import type { KnowledgeAnchor, KnowledgePoint, KnowledgePointAnchor } from '@/api/types';
import { request } from './http';
import { isMockDataSource } from '@/dev/dataSource';
import { DEFAULT_PAGE_SIZE } from '@/constants/pagination';
import type { PageResult } from '@/constants/pagination';
import {
  addKnowledgePointAnchorMock,
  createKnowledgePointMock,
  deleteKnowledgePointMock,
  getKnowledgePointTreeMock,
  listKnowledgePointAnchorsMock,
  listKnowledgePointsByLocatorMock,
  listKnowledgePointsMock,
} from '@/mock/knowledgePoint';

export async function getKnowledgePointTree(kbId: string): Promise<KnowledgePoint[]> {
  if (isMockDataSource()) return getKnowledgePointTreeMock(kbId);
  return request<KnowledgePoint[]>(`/api/kbs/${kbId}/knowledge-points/tree`);
}

export async function listKnowledgePoints(
  kbId: string,
  params: { q?: string; page?: number; pageSize?: number } = {},
): Promise<PageResult<KnowledgePoint>> {
  if (isMockDataSource()) return listKnowledgePointsMock(kbId, params);
  const query = new URLSearchParams();
  if (params.q) query.set('q', params.q);
  query.set('page', String(params.page ?? 0));
  query.set('pageSize', String(params.pageSize ?? DEFAULT_PAGE_SIZE));
  return request<PageResult<KnowledgePoint>>(`/api/kbs/${kbId}/knowledge-points?${query.toString()}`);
}

export async function listKnowledgePointsByLocator(kbId: string, locator: string): Promise<KnowledgePoint[]> {
  if (isMockDataSource()) return listKnowledgePointsByLocatorMock(kbId, locator);
  const query = new URLSearchParams({ locator });
  return request<KnowledgePoint[]>(`/api/kbs/${kbId}/knowledge-points/by-locator?${query.toString()}`);
}

export async function createKnowledgePoint(
  kbId: string,
  payload: {
    parentId?: string | null;
    title: string;
    summary?: string;
    estimatedHours?: number | null;
    sourceAnchor?: KnowledgeAnchor;
  },
): Promise<KnowledgePoint> {
  if (isMockDataSource()) return createKnowledgePointMock(kbId, payload);
  return request<KnowledgePoint>(`/api/kbs/${kbId}/knowledge-points`, {
    method: 'POST',
    body: JSON.stringify(payload),
  });
}

export async function deleteKnowledgePoint(id: string): Promise<void> {
  if (isMockDataSource()) {
    deleteKnowledgePointMock(id);
    return;
  }
  await request<void>(`/api/knowledge-points/${id}`, { method: 'DELETE' });
}

export async function listKnowledgePointAnchors(pointId: string): Promise<KnowledgePointAnchor[]> {
  if (isMockDataSource()) return listKnowledgePointAnchorsMock(pointId);
  return request<KnowledgePointAnchor[]>(`/api/knowledge-points/${pointId}/anchors`);
}

export async function addKnowledgePointAnchor(
  pointId: string,
  payload: { anchor: KnowledgeAnchor; role?: string; primary?: boolean },
): Promise<KnowledgePointAnchor> {
  if (isMockDataSource()) return addKnowledgePointAnchorMock(pointId, payload);
  return request<KnowledgePointAnchor>(`/api/knowledge-points/${pointId}/anchors`, {
    method: 'POST',
    body: JSON.stringify(payload),
  });
}
