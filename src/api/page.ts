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
  updateBlockMock,
  updateBlockContentMock,
  updateBlockGraphDataMock,
} from '@/mock/store';
import { request } from './http';
import type { Block, BlockWithMeta, EmbeddedObject, PageBlocks, PageContent, PageItem } from './types';

export type { Block, BlockWithMeta, PageBlocks, PageContent, PageItem } from './types';

export async function getPageTree(kbId: string): Promise<PageItem[]> {
  if (isMockDataSource()) {
    return getPageTreeMock(kbId);
  }
  return request<PageItem[]>(`/api/kbs/${kbId}/pages/tree`);
}

/** Backend still returns the old { pageId, blocks } format — convert to PageContent */
function legacyBlocksToPageContent(data: { pageId: string; blocks: Block[] }): PageContent {
  const parts: string[] = []
  const embeds: EmbeddedObject[] = []
  const referencedEmbedIds = new Set<string>()

  const allAnnotations: PageContent['annotations'] = []

  for (const block of data.blocks) {
    if (block.type === 'richtext' || block.type === 'richText') {
      for (const embedId of collectEmbedIdsFromContent(block.content || '')) {
        referencedEmbedIds.add(embedId)
      }
    }
  }

  for (const block of data.blocks) {
    if (block.type === 'richtext' || block.type === 'richText') {
      if (block.content) parts.push(block.content)
      const blockAnnotations = (block.metadata?.annotations ?? []) as unknown as PageContent['annotations']
      for (const a of blockAnnotations) {
        if (!allAnnotations.find(ex => ex.id === a.id)) {
          allAnnotations.push(a)
        }
      }
      continue
    }

    if (!embeds.find((embed) => embed.id === block.id)) {
      const embedId = block.id
      embeds.push({
        id: embedId,
        type: block.type as EmbeddedObject['type'],
        title: block.title,
        graphData: block.graphData,
        tableData: block.tableData,
        timelineData: block.timelineData,
        refId: block.refId,
        refType: block.refType as EmbeddedObject['refType'],
        spacerHeight: block.spacerHeight,
        width: block.width,
        height: block.height,
        metadata: block.metadata,
      })
      if (!referencedEmbedIds.has(embedId)) {
        parts.push(`\n\n<!--tu:embed id="${embedId}" type="${block.type}"-->\n\n`)
      }
    }
  }

  return {
    content: parts.join('\n\n').replace(/\n{3,}/g, '\n\n').trim(),
    embeds,
    annotations: allAnnotations,
  }
}

function collectEmbedIdsFromContent(content: string): Set<string> {
  const ids = new Set<string>()
  const embedRe = /<!--tu:embed\s+id="([^"]+)"\s+type="([^"]+)"\s*-->/g
  let match: RegExpExecArray | null

  while ((match = embedRe.exec(content)) !== null) {
    ids.add(match[1])
  }

  return ids
}

export async function getPageContent(pageId: string): Promise<PageContent> {
  if (isMockDataSource()) {
    return getPageContentMock(pageId);
  }
  const data = await request<{ pageId: string; blocks: Block[] }>(`/api/pages/${pageId}/content`);
  return legacyBlocksToPageContent(data);
}

/** Convert PageContent back to the old { blocks } format the backend expects */
function pageContentToLegacyBlocks(pc: PageContent): { blocks: Block[] } {
  const blocks: Block[] = []

  if (pc.content) {
    const annotationMap: Record<string, PageContent['annotations']> = {}
    for (const a of pc.annotations || []) {
      const key = a.blockId || 'page-content'
      if (!annotationMap[key]) annotationMap[key] = []
      annotationMap[key].push(a)
    }

    const richtextBlock: Block = {
      id: 'page-content-' + Date.now(),
      type: 'richtext',
      content: pc.content,
      metadata: { annotations: annotationMap['page-content'] || annotationMap[''] || [] },
    }
    blocks.push(richtextBlock)

    for (const embed of pc.embeds || []) {
      const block: Block = {
        id: embed.id,
        type: embed.type,
        title: embed.title,
        graphData: embed.graphData,
        tableData: embed.tableData,
        timelineData: embed.timelineData,
        refId: embed.refId,
        refType: embed.refType,
        spacerHeight: embed.spacerHeight,
        width: embed.width,
        height: embed.height,
        metadata: { ...embed.metadata },
      }
      blocks.push(block)

      const embedAnnotations = annotationMap[embed.id]
      if (embedAnnotations?.length) {
        block.metadata = { ...block.metadata, annotations: embedAnnotations }
      }
    }
  }

  return { blocks }
}

export async function savePageContent(pageId: string, content: PageContent): Promise<void> {
  if (isMockDataSource()) {
    return savePageContentMock(pageId, content);
  }
  const legacy = pageContentToLegacyBlocks(content);
  await request(`/api/pages/${pageId}/content`, {
    method: 'PUT',
    body: JSON.stringify(legacy),
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

export async function updateBlock(
  pageId: string,
  blockId: string,
  block: Block,
): Promise<void> {
  if (isMockDataSource()) {
    return updateBlockMock(pageId, blockId, block);
  }
  await request<void>(`/api/blocks/${blockId}`, {
    method: 'PATCH',
    body: JSON.stringify({ pageId, block }),
  });
}
