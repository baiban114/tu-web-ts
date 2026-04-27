import { isMockDataSource } from '@/dev/dataSource';
import { syncBlocksMock } from '@/mock/store';
import { request } from './http';
import type { Block } from './types';

export interface BlockSyncPayload {
  id: string;
  type: string;
  title?: string;
  content?: string;
  graphData?: unknown;
  timelineData?: unknown;
  [key: string]: unknown;
}

export async function syncBlocks(
  pageId: string,
  blocks: BlockSyncPayload[],
): Promise<void> {
  if (isMockDataSource()) {
    return syncBlocksMock(pageId, blocks as Block[]);
  }
  await request<void>('/api/blocks/sync', {
    method: 'POST',
    body: JSON.stringify({ pageId, blocks }),
  });
}

export async function syncBlock(
  pageId: string,
  block: BlockSyncPayload,
): Promise<void> {
  return syncBlocks(pageId, [block]);
}
