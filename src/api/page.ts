import type { Block } from '@/components/Page.vue';
import { request } from './http';

export interface PageItem {
  id: string;
  kbId: string;
  parentId: string | null;
  title: string;
  order: number;
  children?: PageItem[];
}

export interface PageContent {
  pageId: string;
  blocks: Block[];
}

export interface BlockWithMeta {
  block: Block;
  pageId: string;
  pageTitle: string;
}

export async function getPageTree(kbId: string): Promise<PageItem[]> {
  return request<PageItem[]>(`/api/kbs/${kbId}/pages/tree`);
}

export async function getPageContent(pageId: string): Promise<Block[]> {
  const data = await request<PageContent>(`/api/pages/${pageId}/content`);
  return data.blocks ?? [];
}

export async function savePageContent(pageId: string, blocks: Block[]): Promise<void> {
  await request<PageContent>(`/api/pages/${pageId}/content`, {
    method: 'PUT',
    body: JSON.stringify({ blocks }),
  });
}

export async function createPage(
  kbId: string,
  parentId: string | null,
  title = '新页面',
): Promise<PageItem> {
  return request<PageItem>('/api/pages', {
    method: 'POST',
    body: JSON.stringify({ kbId, parentId, title }),
  });
}

export async function deletePage(id: string): Promise<void> {
  await request<void>(`/api/pages/${id}`, {
    method: 'DELETE',
  });
}

export async function movePage(
  id: string,
  newParentId: string | null,
  newOrder: number,
): Promise<void> {
  await request<PageItem>(`/api/pages/${id}`, {
    method: 'PATCH',
    body: JSON.stringify({ parentId: newParentId, order: newOrder }),
  });
}

export async function renamePage(id: string, title: string): Promise<void> {
  await request<PageItem>(`/api/pages/${id}`, {
    method: 'PATCH',
    body: JSON.stringify({ title }),
  });
}

export async function listAllBlocks(): Promise<BlockWithMeta[]> {
  return request<BlockWithMeta[]>('/api/blocks');
}

export async function updateBlockContent(
  pageId: string,
  blockId: string,
  content: string,
): Promise<void> {
  await request<void>(`/api/blocks/${blockId}/content`, {
    method: 'PATCH',
    body: JSON.stringify({ pageId, content }),
  });
}

export async function updateBlockGraphData(
  pageId: string,
  blockId: string,
  graphData: Block['graphData'],
): Promise<void> {
  await request<void>(`/api/blocks/${blockId}/graph`, {
    method: 'PATCH',
    body: JSON.stringify({ pageId, graphData }),
  });
}

