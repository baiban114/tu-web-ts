import type { Block, BlockWithMeta, KnowledgeBase, PageContent, PageItem } from '@/api/types';

interface MockState {
  knowledgeBases: KnowledgeBase[];
  pages: Array<Omit<PageItem, 'children'>>;
  contents: Record<string, Block[]>;
}

const STORAGE_KEY = 'tu:mock-state';

const initialState: MockState = {
  knowledgeBases: [
    {
      id: 'kb-demo-1',
      name: '个人笔记',
      icon: '📌',
      description: '用于离线演示和本地调试的 mock 知识库',
    },
    {
      id: 'kb-demo-2',
      name: '技术文档',
      icon: '📋',
      description: '配合开发者模式验证页面树和块同步',
    },
  ],
  pages: [
    { id: 'p-demo-1', kbId: 'kb-demo-1', parentId: null, title: '快速入门', order: 0 },
    { id: 'p-demo-2', kbId: 'kb-demo-1', parentId: null, title: '基础概念', order: 1 },
    { id: 'p-demo-3', kbId: 'kb-demo-1', parentId: 'p-demo-2', title: '数据结构', order: 0 },
    { id: 'p-demo-4', kbId: 'kb-demo-2', parentId: null, title: 'API 文档', order: 0 },
  ],
  contents: {
    'p-demo-1': [
      {
        id: 'b-demo-1',
        type: 'richtext',
        content: '# 快速入门\n\n当前正在使用前端本地 mock 数据源，可以随时切回后端。',
      },
      {
        id: 'b-demo-x6-1',
        type: 'x6',
        title: '示例画板',
        graphData: {
          nodes: [
            { id: 'demo-node-1', x: 120, y: 100, width: 120, height: 56, label: '开始' },
            { id: 'demo-node-2', x: 340, y: 100, width: 140, height: 56, label: '切换到 mock' },
          ],
          edges: [
            { id: 'demo-edge-1', source: 'demo-node-1', target: 'demo-node-2' },
          ],
        },
      },
    ],
    'p-demo-2': [
      {
        id: 'b-demo-2',
        type: 'richtext',
        content: '# 基础概念\n\n页面、块内容和引用块都可以在 mock 模式下独立运行。',
      },
      {
        id: 'b-demo-ref-1',
        type: 'ref',
        refId: 'b-demo-1',
      },
    ],
    'p-demo-3': [
      {
        id: 'b-demo-3',
        type: 'richtext',
        content: '这里可以继续补充子页面内容。',
      },
    ],
    'p-demo-4': [
      {
        id: 'b-demo-4',
        type: 'richtext',
        content: '# API 文档\n\n开发者模式允许在 mock 和后端之间切换，而不改业务代码。',
      },
    ],
  },
};

function cloneState<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T;
}

function loadState(): MockState {
  if (typeof window === 'undefined') {
    return cloneState(initialState);
  }

  const raw = window.localStorage.getItem(STORAGE_KEY);
  if (!raw) {
    return cloneState(initialState);
  }

  try {
    const parsed = JSON.parse(raw) as MockState;
    if (!parsed || !Array.isArray(parsed.knowledgeBases) || !Array.isArray(parsed.pages) || !parsed.contents) {
      return cloneState(initialState);
    }
    return parsed;
  } catch {
    return cloneState(initialState);
  }
}

let state: MockState = loadState();

function persistState(): void {
  if (typeof window !== 'undefined') {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
  }
}

function nextId(prefix: string): string {
  return `${prefix}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}

function sortPages(pages: Array<Omit<PageItem, 'children'>>): Array<Omit<PageItem, 'children'>> {
  return [...pages].sort((a, b) => a.order - b.order || a.title.localeCompare(b.title));
}

function buildPageTree(kbId: string): PageItem[] {
  const pages = sortPages(state.pages.filter((page) => page.kbId === kbId));
  const byParent = new Map<string | null, Array<Omit<PageItem, 'children'>>>();

  for (const page of pages) {
    const siblings = byParent.get(page.parentId) ?? [];
    siblings.push(page);
    byParent.set(page.parentId, siblings);
  }

  const build = (parentId: string | null): PageItem[] => {
    const siblings = byParent.get(parentId) ?? [];
    return siblings.map((page) => ({
      ...page,
      children: build(page.id),
    }));
  };

  return build(null);
}

function collectPageIds(pageId: string): string[] {
  const result = [pageId];
  const children = state.pages.filter((page) => page.parentId === pageId);
  for (const child of children) {
    result.push(...collectPageIds(child.id));
  }
  return result;
}

function getPageOrThrow(pageId: string): Omit<PageItem, 'children'> {
  const page = state.pages.find((item) => item.id === pageId);
  if (!page) {
    throw new Error(`Page not found: ${pageId}`);
  }
  return page;
}

function visitBlocks(blocks: Block[], visitor: (block: Block) => void): void {
  for (const block of blocks) {
    visitor(block);
    if (block.children?.length) {
      visitBlocks(block.children, visitor);
    }
  }
}

function updateBlockInPage(
  pageId: string,
  blockId: string,
  updater: (block: Block) => void,
): boolean {
  const blocks = state.contents[pageId] ?? [];
  let updated = false;

  visitBlocks(blocks, (block) => {
    if (block.id !== blockId || updated) return;
    updater(block);
    updated = true;
  });

  if (updated) {
    state.contents[pageId] = cloneState(blocks);
    persistState();
  }

  return updated;
}

export function resetMockState(): void {
  state = cloneState(initialState);
  persistState();
}

export function listKnowledgeBasesMock(): KnowledgeBase[] {
  return cloneState(state.knowledgeBases);
}

export function createKnowledgeBaseMock(name: string): KnowledgeBase {
  const kb: KnowledgeBase = {
    id: nextId('kb'),
    name,
    icon: '🧪',
    description: '本地 mock 新建知识库',
  };
  state.knowledgeBases.push(kb);
  persistState();
  return cloneState(kb);
}

export function deleteKnowledgeBaseMock(id: string): void {
  const pageIds = state.pages.filter((page) => page.kbId === id).map((page) => page.id);
  state.knowledgeBases = state.knowledgeBases.filter((kb) => kb.id !== id);
  state.pages = state.pages.filter((page) => page.kbId !== id);
  for (const pageId of pageIds) {
    delete state.contents[pageId];
  }
  persistState();
}

export function renameKnowledgeBaseMock(id: string, name: string): KnowledgeBase {
  const kb = state.knowledgeBases.find((item) => item.id === id);
  if (!kb) {
    throw new Error(`Knowledge base not found: ${id}`);
  }
  kb.name = name;
  persistState();
  return cloneState(kb);
}

export function getPageTreeMock(kbId: string): PageItem[] {
  return cloneState(buildPageTree(kbId));
}

export function getPageContentMock(pageId: string): PageContent {
  getPageOrThrow(pageId);
  return {
    pageId,
    blocks: cloneState(state.contents[pageId] ?? []),
  };
}

export function savePageContentMock(pageId: string, blocks: Block[]): void {
  getPageOrThrow(pageId);
  state.contents[pageId] = cloneState(blocks);
  persistState();
}

export function createPageMock(
  kbId: string,
  parentId: string | null,
  title: string,
): PageItem {
  const siblings = state.pages.filter((page) => page.kbId === kbId && page.parentId === parentId);
  const page: Omit<PageItem, 'children'> = {
    id: nextId('p'),
    kbId,
    parentId,
    title,
    order: siblings.length,
  };
  state.pages.push(page);
  state.contents[page.id] = [];
  persistState();
  return { ...cloneState(page), children: [] };
}

export function deletePageMock(id: string): void {
  const pageIds = collectPageIds(id);
  state.pages = state.pages.filter((page) => !pageIds.includes(page.id));
  for (const pageId of pageIds) {
    delete state.contents[pageId];
  }
  persistState();
}

export function movePageMock(
  id: string,
  newParentId: string | null,
  newOrder: number,
): void {
  const page = getPageOrThrow(id);
  page.parentId = newParentId;
  page.order = Math.max(0, newOrder);
  persistState();
}

export function renamePageMock(id: string, title: string): void {
  const page = getPageOrThrow(id);
  page.title = title;
  persistState();
}

export function listAllBlocksMock(): BlockWithMeta[] {
  const items: BlockWithMeta[] = [];

  for (const page of state.pages) {
    const blocks = state.contents[page.id] ?? [];
    visitBlocks(blocks, (block) => {
      if (block.type === 'ref' || block.type === 'spacer') return;
      items.push({
        block: cloneState(block),
        pageId: page.id,
        pageTitle: page.title,
      });
    });
  }

  return items;
}

export function updateBlockContentMock(pageId: string, blockId: string, content: string): void {
  const updated = updateBlockInPage(pageId, blockId, (block) => {
    block.content = content;
  });

  if (!updated) {
    throw new Error(`Block not found: ${blockId}`);
  }
}

export function updateBlockGraphDataMock(pageId: string, blockId: string, graphData: Block['graphData']): void {
  const updated = updateBlockInPage(pageId, blockId, (block) => {
    block.graphData = cloneState(graphData);
  });

  if (!updated) {
    throw new Error(`Block not found: ${blockId}`);
  }
}

export function syncBlocksMock(pageId: string, blocks: Block[]): void {
  savePageContentMock(pageId, blocks);
}
