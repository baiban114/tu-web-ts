import type { KnowledgeAnchor, KnowledgeRelation, RelationTypeDef } from '@/api/types';
import { DEFAULT_PAGE_SIZE } from '@/constants/pagination';
import type { PageResult } from '@/constants/pagination';
import { paginateSlice } from '@/utils/clientPagination';
import type { ListKnowledgeRelationsParams } from '@/api/knowledgeRelation';

const STORAGE_KEY = 'tu-mock-knowledge-relations';

const SYSTEM_TYPES: RelationTypeDef[] = [
  { id: 'rt-sys-source', kbId: null, typeKey: 'source', label: '来源', color: '#52c41a', icon: null, bidirectional: false, system: true, enabled: true },
  { id: 'rt-sys-basis', kbId: null, typeKey: 'basis', label: '依据', color: '#389e0d', icon: null, bidirectional: false, system: true, enabled: true },
  { id: 'rt-sys-case', kbId: null, typeKey: 'case', label: '案例', color: '#1677ff', icon: null, bidirectional: false, system: true, enabled: true },
  { id: 'rt-sys-cites', kbId: null, typeKey: 'cites', label: '引用', color: '#722ed1', icon: null, bidirectional: false, system: true, enabled: true },
  { id: 'rt-sys-related', kbId: null, typeKey: 'related', label: '相关', color: '#8c8c8c', icon: null, bidirectional: true, system: true, enabled: true },
];

function loadRelations(): KnowledgeRelation[] {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return [];
    return JSON.parse(raw) as KnowledgeRelation[];
  } catch {
    return [];
  }
}

function saveRelations(relations: KnowledgeRelation[]) {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(relations));
}

function resolveType(kbId: string, typeKey: string): RelationTypeDef {
  return SYSTEM_TYPES.find((item) => item.typeKey === typeKey)
    ?? { id: `rt-custom-${typeKey}`, kbId, typeKey, label: typeKey, color: '#1677ff', icon: null, bidirectional: false, system: false, enabled: true };
}

function newId(): string {
  return `kr-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
}

export function listRelationTypesMock(_kbId: string): RelationTypeDef[] {
  return [...SYSTEM_TYPES];
}

export function listKnowledgeRelationsMock(
  kbId: string,
  params: ListKnowledgeRelationsParams,
): PageResult<KnowledgeRelation> {
  const locator = params.locator?.trim() ?? '';
  const typeKey = params.relationTypeKey?.trim() ?? '';
  const q = params.q?.trim().toLowerCase() ?? '';
  const filtered = loadRelations().filter((item) => {
    if (item.kbId !== kbId) return false;
    if (locator && item.from.locator !== locator && item.to.locator !== locator) return false;
    if (typeKey && item.relationTypeKey !== typeKey) return false;
    if (q) {
      const hay = `${item.from.locator} ${item.to.locator} ${item.note ?? ''} ${item.relationTypeLabel}`.toLowerCase();
      if (!hay.includes(q)) return false;
    }
    return true;
  });
  return paginateSlice(filtered, params.page ?? 0, params.pageSize ?? DEFAULT_PAGE_SIZE);
}

export function listKnowledgeRelationsByAnchorMock(kbId: string, locator: string): {
  locator: string;
  outgoing: KnowledgeRelation[];
  incoming: KnowledgeRelation[];
} {
  const all = loadRelations().filter((item) => item.kbId === kbId);
  return {
    locator,
    outgoing: all.filter((item) => item.from.locator === locator),
    incoming: all.filter((item) => item.to.locator === locator),
  };
}

export function createKnowledgeRelationMock(
  kbId: string,
  payload: {
    relationTypeKey: string;
    from: KnowledgeAnchor;
    to: KnowledgeAnchor;
    note?: string;
  },
): KnowledgeRelation {
  const typeDef = resolveType(kbId, payload.relationTypeKey);
  const relation: KnowledgeRelation = {
    id: newId(),
    kbId,
    relationTypeKey: typeDef.typeKey,
    relationTypeLabel: typeDef.label,
    relationTypeColor: typeDef.color,
    bidirectional: typeDef.bidirectional,
    from: payload.from,
    to: payload.to,
    note: payload.note ?? null,
    sourceProvenance: 'user',
    status: 'ok',
  };
  const all = loadRelations();
  all.push(relation);
  saveRelations(all);
  return relation;
}

export function deleteKnowledgeRelationMock(id: string): void {
  saveRelations(loadRelations().filter((item) => item.id !== id));
}

export function clearKnowledgeRelationsMock(): void {
  localStorage.removeItem(STORAGE_KEY);
}
