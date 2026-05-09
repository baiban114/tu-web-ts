import { request } from './http';

export interface ResourceType {
  id: string;
  code: string;
  name: string;
  icon?: string;
  description?: string;
  identityFieldKey: string;
  identityFieldLabel: string;
}

export interface ResourceWork {
  id: string;
  typeId: string;
  typeName: string;
  title: string;
  subtitle?: string;
  description?: string;
}

export interface ResourceItem {
  id: string;
  typeId: string;
  typeName: string;
  identityFieldKey: string;
  identityFieldLabel: string;
  workId: string;
  workTitle: string;
  title: string;
  identityValue: string;
  sourceUrl?: string;
  edition?: string;
  note?: string;
}

export type CreateResourceTypePayload = Omit<ResourceType, 'id'>;
export type UpdateResourceTypePayload = Omit<ResourceType, 'id' | 'code'>;
export type CreateResourceWorkPayload = Omit<ResourceWork, 'id' | 'typeName'>;
export type UpdateResourceWorkPayload = CreateResourceWorkPayload;
export type CreateResourceItemPayload = Omit<ResourceItem, 'id' | 'typeName' | 'identityFieldKey' | 'identityFieldLabel' | 'workTitle'>;
export type UpdateResourceItemPayload = CreateResourceItemPayload;

function query(params: Record<string, string | undefined>): string {
  const search = new URLSearchParams();
  Object.entries(params).forEach(([key, value]) => {
    if (value) search.set(key, value);
  });
  const value = search.toString();
  return value ? `?${value}` : '';
}

export function listResourceTypes(): Promise<ResourceType[]> {
  return request<ResourceType[]>('/api/resource-types');
}

export function createResourceType(payload: CreateResourceTypePayload): Promise<ResourceType> {
  return request<ResourceType>('/api/resource-types', {
    method: 'POST',
    body: JSON.stringify(payload),
  });
}

export function updateResourceType(id: string, payload: UpdateResourceTypePayload): Promise<ResourceType> {
  return request<ResourceType>(`/api/resource-types/${id}`, {
    method: 'PATCH',
    body: JSON.stringify(payload),
  });
}

export function deleteResourceType(id: string): Promise<void> {
  return request<void>(`/api/resource-types/${id}`, { method: 'DELETE' });
}

export function listResourceWorks(typeId?: string): Promise<ResourceWork[]> {
  return request<ResourceWork[]>(`/api/resource-works${query({ typeId })}`);
}

export function createResourceWork(payload: CreateResourceWorkPayload): Promise<ResourceWork> {
  return request<ResourceWork>('/api/resource-works', {
    method: 'POST',
    body: JSON.stringify(payload),
  });
}

export function updateResourceWork(id: string, payload: UpdateResourceWorkPayload): Promise<ResourceWork> {
  return request<ResourceWork>(`/api/resource-works/${id}`, {
    method: 'PATCH',
    body: JSON.stringify(payload),
  });
}

export function deleteResourceWork(id: string): Promise<void> {
  return request<void>(`/api/resource-works/${id}`, { method: 'DELETE' });
}

export function listResourceItems(params: {
  typeId?: string;
  workId?: string;
  identityValue?: string;
} = {}): Promise<ResourceItem[]> {
  return request<ResourceItem[]>(`/api/resource-items${query(params)}`);
}

export function createResourceItem(payload: CreateResourceItemPayload): Promise<ResourceItem> {
  return request<ResourceItem>('/api/resource-items', {
    method: 'POST',
    body: JSON.stringify(payload),
  });
}

export function updateResourceItem(id: string, payload: UpdateResourceItemPayload): Promise<ResourceItem> {
  return request<ResourceItem>(`/api/resource-items/${id}`, {
    method: 'PATCH',
    body: JSON.stringify(payload),
  });
}

export function deleteResourceItem(id: string): Promise<void> {
  return request<void>(`/api/resource-items/${id}`, { method: 'DELETE' });
}

const LINK_RESOURCE_TYPE_CODE = 'web-link';

function getLinkTitle(label: string, url: string): string {
  const title = label.trim();
  if (title) return title.slice(0, 255);
  try {
    return new URL(url).hostname.slice(0, 255) || url.slice(0, 255);
  } catch {
    return url.slice(0, 255);
  }
}

export async function ensureExternalLinkResource(url: string, label = ''): Promise<ResourceItem> {
  const identityValue = url.trim();
  if (!identityValue) {
    throw new Error('resource URL required');
  }

  const types = await listResourceTypes();
  let linkType = types.find((type) => type.code === LINK_RESOURCE_TYPE_CODE);
  if (!linkType) {
    linkType = await createResourceType({
      code: LINK_RESOURCE_TYPE_CODE,
      name: '网络链接',
      icon: 'link',
      description: '由插入链接功能自动登记的外部网络链接',
      identityFieldKey: 'sourceUrl',
      identityFieldLabel: '源 URL',
    });
  }

  const existingItems = await listResourceItems({
    typeId: linkType.id,
    identityValue,
  });
  if (existingItems.length > 0) {
    return existingItems[0];
  }

  const title = getLinkTitle(label, identityValue);
  const work = await createResourceWork({
    typeId: linkType.id,
    title,
    subtitle: undefined,
    description: `自动登记的网络链接：${identityValue}`,
  });

  return createResourceItem({
    typeId: linkType.id,
    workId: work.id,
    title,
    identityValue,
    sourceUrl: identityValue,
    edition: undefined,
    note: '由插入链接功能自动登记',
  });
}
