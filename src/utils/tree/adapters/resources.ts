import type {
  ResourceExcerpt,
  ResourceItem,
  ResourceType,
  ResourceWork,
} from '@/api/externalResource';
import { supportsResourceExcerpts } from '@/api/externalResource';
import type { TreeNode } from '../types';

export type ResourceTreeLayer = 'root' | 'type' | 'work' | 'unassigned' | 'item' | 'excerpt';

export interface ResourceTreeMeta {
  layer: ResourceTreeLayer;
  entityId: string;
  typeId?: string;
  typeCode?: string;
  workId?: string | null;
  itemId?: string;
  clusterKey?: string | null;
}

export interface ResourceTreeInput {
  types: ResourceType[];
  works: ResourceWork[];
  items: ResourceItem[];
  /** resourceItemId → excerpts (optional; omit for lighter trees) */
  excerptsByItemId?: Record<string, ResourceExcerpt[]>;
  /** When set, only include this resource type branch */
  filterTypeId?: string;
}

const ROOT_ID = 'rt-root';
const UNASSIGNED_PREFIX = 'rw-unassigned:';

function truncateClusterKey(value: string | null | undefined, max = 24): string {
  const text = value?.trim();
  if (!text) return '';
  return text.length <= max ? text : `${text.slice(0, max)}…`;
}

function buildExcerptNodes(
  item: ResourceItem,
  typeId: string,
  workId: string | null,
  excerptsByItemId: Record<string, ResourceExcerpt[]>,
): TreeNode<ResourceTreeMeta>[] {
  const excerpts = excerptsByItemId[item.id] ?? [];
  return excerpts.map((excerpt) => ({
    id: `re:${excerpt.id}`,
    label: excerpt.title,
    meta: {
      layer: 'excerpt',
      entityId: excerpt.id,
      typeId,
      workId,
      itemId: item.id,
    },
  }));
}

function buildItemNodes(
  type: ResourceType,
  workId: string | null,
  items: ResourceItem[],
  excerptsByItemId: Record<string, ResourceExcerpt[]>,
  includeExcerpts: boolean,
): TreeNode<ResourceTreeMeta>[] {
  return items.map((item) => {
    const children = includeExcerpts && supportsResourceExcerpts(type.code)
      ? buildExcerptNodes(item, type.id, workId, excerptsByItemId)
      : undefined;
    return {
      id: `ri:${item.id}`,
      label: item.title,
      ...(children && children.length > 0 ? { children } : {}),
      meta: {
        layer: 'item',
        entityId: item.id,
        typeId: type.id,
        typeCode: type.code,
        workId,
        itemId: item.id,
      },
    };
  });
}

function buildWorkBranch(
  type: ResourceType,
  work: ResourceWork,
  items: ResourceItem[],
  excerptsByItemId: Record<string, ResourceExcerpt[]>,
  includeExcerpts: boolean,
): TreeNode<ResourceTreeMeta> {
  const workItems = items.filter((item) => item.workId === work.id);
  const clusterHint = truncateClusterKey(work.clusterKey);
  const label = clusterHint ? `${work.title} · ${clusterHint}` : work.title;
  const children = buildItemNodes(type, work.id, workItems, excerptsByItemId, includeExcerpts);

  return {
    id: `rw:${work.id}`,
    label,
    ...(children.length > 0 ? { children } : {}),
    meta: {
      layer: 'work',
      entityId: work.id,
      typeId: type.id,
      typeCode: type.code,
      workId: work.id,
      clusterKey: work.clusterKey ?? null,
    },
  };
}

function buildTypeBranch(
  type: ResourceType,
  works: ResourceWork[],
  items: ResourceItem[],
  excerptsByItemId: Record<string, ResourceExcerpt[]>,
  includeExcerpts: boolean,
): TreeNode<ResourceTreeMeta> {
  const typeWorks = works.filter((work) => work.typeId === type.id);
  const unassignedItems = items.filter((item) => item.typeId === type.id && !item.workId);

  const children: TreeNode<ResourceTreeMeta>[] = typeWorks.map((work) => (
    buildWorkBranch(type, work, items, excerptsByItemId, includeExcerpts)
  ));

  if (unassignedItems.length > 0) {
    const unassignedChildren = buildItemNodes(type, null, unassignedItems, excerptsByItemId, includeExcerpts);
    children.push({
      id: `${UNASSIGNED_PREFIX}${type.id}`,
      label: '未归类',
      children: unassignedChildren,
      meta: {
        layer: 'unassigned',
        entityId: `${UNASSIGNED_PREFIX}${type.id}`,
        typeId: type.id,
        typeCode: type.code,
        workId: null,
      },
    });
  }

  return {
    id: `rt:${type.id}`,
    label: `${type.icon ? `${type.icon} ` : ''}${type.name}`.trim(),
    ...(children.length > 0 ? { children } : {}),
    meta: {
      layer: 'type',
      entityId: type.id,
      typeId: type.id,
      typeCode: type.code,
    },
  };
}

/**
 * ResourceType → ResourceWork → ResourceItem → ResourceExcerpt
 */
export function resourcesToTreeNodes(input: ResourceTreeInput): TreeNode<ResourceTreeMeta>[] {
  const {
    types,
    works,
    items,
    excerptsByItemId = {},
    filterTypeId,
  } = input;
  const includeExcerpts = Object.keys(excerptsByItemId).length > 0;
  const filteredTypes = filterTypeId
    ? types.filter((type) => type.id === filterTypeId)
    : types;

  const typeBranches = filteredTypes.map((type) => (
    buildTypeBranch(type, works, items, excerptsByItemId, includeExcerpts)
  ));

  if (filterTypeId) {
    return typeBranches;
  }

  return [{
    id: ROOT_ID,
    label: '外部资源',
    children: typeBranches,
    meta: {
      layer: 'root',
      entityId: ROOT_ID,
    },
  }];
}

/** Work nodes only (for merge-work target picker). */
export function resourceWorksToTreeNodes(
  type: ResourceType,
  works: ResourceWork[],
  items: ResourceItem[],
): TreeNode<ResourceTreeMeta>[] {
  return works
    .filter((work) => work.typeId === type.id)
    .map((work) => {
      const count = items.filter((item) => item.workId === work.id).length;
      const clusterHint = truncateClusterKey(work.clusterKey);
      const suffix = clusterHint ? ` · ${clusterHint}` : '';
      return {
        id: `rw:${work.id}`,
        label: `${work.title}${suffix}（${count} 个实体）`,
        meta: {
          layer: 'work',
          entityId: work.id,
          typeId: type.id,
          typeCode: type.code,
          workId: work.id,
          clusterKey: work.clusterKey ?? null,
        },
      };
    });
}

export function isResourceTreeNodeId(id: string): boolean {
  return id.startsWith('rt:') || id.startsWith('rw:') || id.startsWith('ri:') || id.startsWith('re:');
}
