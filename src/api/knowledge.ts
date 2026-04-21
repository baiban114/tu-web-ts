import { request } from './http';

export interface KnowledgeBase {
  id: string;
  name: string;
  icon?: string;
  description?: string;
}

export async function listKnowledgeBases(): Promise<KnowledgeBase[]> {
  return request<KnowledgeBase[]>('/api/kbs');
}

export async function createKnowledgeBase(name: string): Promise<KnowledgeBase> {
  return request<KnowledgeBase>('/api/kbs', {
    method: 'POST',
    body: JSON.stringify({ name }),
  });
}

export async function deleteKnowledgeBase(id: string): Promise<void> {
  return request<void>(`/api/kbs/${id}`, {
    method: 'DELETE',
  });
}

export async function renameKnowledgeBase(id: string, name: string): Promise<KnowledgeBase> {
  return request<KnowledgeBase>(`/api/kbs/${id}`, {
    method: 'PATCH',
    body: JSON.stringify({ name }),
  });
}

