// 页面 mock API（开发阶段，可无缝切换到后端接口）
// 后端建议：
//   GET    /api/kbs/:kbId/pages/tree    获取树结构
//   POST   /api/pages                   创建页面
//   DELETE /api/pages/:id               删除页面（级联删除子页面）
//   PATCH  /api/pages/:id               重命名或移动页面

import type { Block } from '@/components/Page.vue';

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

// 读操作不加延迟（内存数据，模拟后端时替换为真实请求）
// 写操作保留小延迟以模拟网络 round-trip
const mockDelay = (ms = 0) => ms > 0 ? new Promise<void>((r) => setTimeout(r, ms)) : Promise.resolve();

// 页面扁平列表（所有知识库）
let _pages: Omit<PageItem, 'children'>[] = [
  { id: 'p-1', kbId: 'kb-1', parentId: null,  title: '快速入门',  order: 0 },
  { id: 'p-2', kbId: 'kb-1', parentId: null,  title: '基础概念',  order: 1 },
  { id: 'p-3', kbId: 'kb-1', parentId: 'p-2', title: '数据结构',  order: 0 },
  { id: 'p-4', kbId: 'kb-1', parentId: 'p-2', title: '算法基础',  order: 1 },
  { id: 'p-5', kbId: 'kb-2', parentId: null,  title: 'API 文档',  order: 0 },
  { id: 'p-6', kbId: 'kb-2', parentId: null,  title: '架构设计',  order: 1 },
  { id: 'p-7', kbId: 'kb-2', parentId: 'p-6', title: '前端架构',  order: 0 },
  { id: 'p-8', kbId: 'kb-3', parentId: null,  title: '需求分析',  order: 0 },
  { id: 'p-9', kbId: 'kb-3', parentId: null,  title: '里程碑',    order: 1 },
];

// 页面内容存储（pageId -> blocks）
const _contents: Record<string, Block[]> = {
  'p-1': [{ id: 'b-1', type: 'richtext', content: '# 快速入门\n\n欢迎使用本知识库！' }],
  'p-2': [{ id: 'b-2', type: 'richtext', content: '# 基础概念\n\n本章介绍核心概念。' }],
};

function buildTree(items: Omit<PageItem, 'children'>[], parentId: string | null): PageItem[] {
  return items
    .filter((p) => p.parentId === parentId)
    .sort((a, b) => a.order - b.order)
    .map((p) => ({
      ...p,
      children: buildTree(items, p.id),
    }));
}

export async function getPageTree(kbId: string): Promise<PageItem[]> {
  const kbPages = _pages.filter((p) => p.kbId === kbId);
  return buildTree(kbPages, null);
}

export async function getPageContent(pageId: string): Promise<Block[]> {
  return _contents[pageId] ? [..._contents[pageId]] : [];
}

export async function savePageContent(pageId: string, blocks: Block[]): Promise<void> {
  await mockDelay(100);
  _contents[pageId] = blocks;
}

export async function createPage(
  kbId: string,
  parentId: string | null,
  title = '新页面',
): Promise<PageItem> {
  await mockDelay();
  const siblings = _pages.filter((p) => p.kbId === kbId && p.parentId === parentId);
  const page: Omit<PageItem, 'children'> = {
    id: `p-${Date.now()}`,
    kbId,
    parentId,
    title,
    order: siblings.length,
  };
  _pages.push(page);
  return { ...page, children: [] };
}

export async function deletePage(id: string): Promise<void> {
  await mockDelay();
  const toDelete = new Set<string>();
  const collect = (pid: string) => {
    toDelete.add(pid);
    _pages.filter((p) => p.parentId === pid).forEach((p) => collect(p.id));
  };
  collect(id);
  _pages = _pages.filter((p) => !toDelete.has(p.id));
  toDelete.forEach((pid) => delete _contents[pid]);
}

export async function movePage(
  id: string,
  newParentId: string | null,
  newOrder: number,
): Promise<void> {
  await mockDelay();
  const page = _pages.find((p) => p.id === id);
  if (!page) return;
  page.parentId = newParentId;
  page.order = newOrder;
}

export async function renamePage(id: string, title: string): Promise<void> {
  await mockDelay();
  const page = _pages.find((p) => p.id === id);
  if (page) page.title = title;
}

// ─── 引用块相关 ───────────────────────────────────────────────────────────────
// 后端建议：GET /api/blocks  返回全部可引用块（含来源页信息）
//           PATCH /api/blocks/:id  更新块内容（影响所有引用方）

export interface BlockWithMeta {
  block: Block;
  pageId: string;
  pageTitle: string;
}

/** 列出所有可被引用的块（跨知识库、跨页面） */
export async function listAllBlocks(): Promise<BlockWithMeta[]> {
  await mockDelay();
  const result: BlockWithMeta[] = [];
  for (const [pageId, blocks] of Object.entries(_contents)) {
    const page = _pages.find((p) => p.id === pageId);
    const pageTitle = page?.title ?? pageId;
    for (const block of blocks) {
      if (block.type !== 'ref') {
        result.push({ block: { ...block }, pageId, pageTitle });
      }
    }
  }
  return result;
}

/** 更新某页面中指定块的内容（供引用块同步回写原始块） */
export async function updateBlockContent(
  pageId: string,
  blockId: string,
  content: string,
): Promise<void> {
  await mockDelay(50);
  const blocks = _contents[pageId];
  if (!blocks) return;
  const block = blocks.find((b) => b.id === blockId);
  if (block) block.content = content;
}
