import { isMockDataSource } from '@/dev/dataSource';
import {
  createPageMock,
  deletePageMock,
  getPageContentMock,
  getPageTreeMock,
  listAllBlocksMock,
  movePageMock,
  renamePageMock,
  savePageContentMock,
  updateBlockContentMock,
  updateBlockGraphDataMock,
} from '@/mock/store';
import { request } from './http';
import type { Block, BlockWithMeta, PageContent, PageItem } from './types';

export type { Block, BlockWithMeta, PageContent, PageItem } from './types';

export async function getPageTree(kbId: string): Promise<PageItem[]> {
  if (isMockDataSource()) {
    return getPageTreeMock(kbId);
  }
  return request<PageItem[]>(`/api/kbs/${kbId}/pages/tree`);
}

export async function getPageContent(pageId: string): Promise<Block[]> {
  if (isMockDataSource()) {
    const data = getPageContentMock(pageId);
    return data.blocks ?? [];
  }
  const data = await request<PageContent>(`/api/pages/${pageId}/content`);
  return data.blocks ?? [];
}

export async function savePageContent(pageId: string, blocks: Block[]): Promise<void> {
  if (isMockDataSource()) {
    return savePageContentMock(pageId, blocks);
  }
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
  if (isMockDataSource()) {
    return createPageMock(kbId, parentId, title);
  }
  return request<PageItem>('/api/pages', {
    method: 'POST',
    body: JSON.stringify({ kbId, parentId, title }),
  });
}

export async function deletePage(id: string): Promise<void> {
  if (isMockDataSource()) {
    return deletePageMock(id);
  }
  await request<void>(`/api/pages/${id}`, {
    method: 'DELETE',
  });
}

export async function movePage(
  id: string,
  newParentId: string | null,
  newOrder: number,
): Promise<void> {
  if (isMockDataSource()) {
    return movePageMock(id, newParentId, newOrder);
  }
  await request<PageItem>(`/api/pages/${id}`, {
    method: 'PATCH',
    body: JSON.stringify({ parentId: newParentId, order: newOrder }),
  });
}

export async function renamePage(id: string, title: string): Promise<void> {
  if (isMockDataSource()) {
    return renamePageMock(id, title);
  }
  await request<PageItem>(`/api/pages/${id}`, {
    method: 'PATCH',
    body: JSON.stringify({ title }),
  });
}

export async function listAllBlocks(): Promise<BlockWithMeta[]> {
  if (isMockDataSource()) {
    return listAllBlocksMock();
  }
  return request<BlockWithMeta[]>('/api/blocks');
}

export async function updateBlockContent(
  pageId: string,
  blockId: string,
  content: string,
): Promise<void> {
  if (isMockDataSource()) {
    return updateBlockContentMock(pageId, blockId, content);
  }
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
  if (isMockDataSource()) {
    return updateBlockGraphDataMock(pageId, blockId, graphData);
  }
  await request<void>(`/api/blocks/${blockId}/graph`, {
    method: 'PATCH',
    body: JSON.stringify({ pageId, graphData }),
  });
}
