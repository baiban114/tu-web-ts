import type {
  Block,
  BlockWithMeta,
  EmbeddedObject,
  ImportRoadmapPayload,
  ImportRoadmapResult,
  KnowledgeBase,
  PageContent,
  PageItem,
  RoadmapNode,
  TextAnnotation,
} from '@/api/types';
import type { ReferenceItem, ListReferencesParams, ListReferencesResult } from '@/api/reference';

interface MockState {
  knowledgeBases: KnowledgeBase[];
  pages: Array<Omit<PageItem, 'children'>>;
  contents: Record<string, PageContent>;
}

const STORAGE_KEY = 'tu:mock-state';

function blocksToPageContent(blocks: Block[]): PageContent {
  const parts: string[] = []
  const embeds: EmbeddedObject[] = []
  const referencedEmbedIds = collectEmbedIdsFromBlocks(blocks)
  const seenEmbedIds = new Set<string>()

  for (const block of blocks) {
    if (block.type === 'richtext' || block.type === 'richText') {
      if (block.content) parts.push(block.content)
      continue
    }
    if (seenEmbedIds.has(block.id)) continue
    seenEmbedIds.add(block.id)

    const embedId = block.id
    const embed: EmbeddedObject = {
      id: embedId,
      type: block.type as EmbeddedObject['type'],
      title: block.title,
      graphData: block.graphData,
      tableData: block.tableData,
      multiTableData: block.multiTableData,
      timelineData: block.timelineData,
      refId: block.refId,
      refType: block.refType,
      spacerHeight: block.spacerHeight,
      width: block.width,
      height: block.height,
      metadata: block.metadata,
    }
    embeds.push(embed)
    if (!referencedEmbedIds.has(embedId)) {
      parts.push(`\n\n<!--tu:embed id="${embedId}" type="${embed.type}"-->\n\n`)
    }
  }

  return {
    content: parts.join('\n\n').replace(/\n{3,}/g, '\n\n').trim(),
    embeds,
    annotations: [],
  }
}

function collectEmbedIdsFromBlocks(blocks: Block[]): Set<string> {
  const ids = new Set<string>()
  for (const block of blocks) {
    if (block.type !== 'richtext' && block.type !== 'richText') continue
    for (const id of collectEmbedIdsFromContent(block.content || '')) {
      ids.add(id)
    }
  }
  return ids
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
    'p-demo-1': blocksToPageContent([
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
    ]),
    'p-demo-2': blocksToPageContent([
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
    ]),
    'p-demo-3': blocksToPageContent([
      {
        id: 'b-demo-3',
        type: 'richtext',
        content: '这里可以继续补充子页面内容。',
      },
    ]),
    'p-demo-4': blocksToPageContent([
      {
        id: 'b-demo-4',
        type: 'richtext',
        content: '# API 文档\n\n开发者模式允许在 mock 和后端之间切换，而不改业务代码。',
      },
    ]),
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

function firstText(...values: Array<string | undefined>): string | null {
  for (const value of values) {
    if (value && value.trim()) return value.trim();
  }
  return null;
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

/** @deprecated embeds no longer have children */
function visitBlocks(_blocks: PageContent | Block[], _visitor: (block: Block) => void): void {
  // no-op in new model
}

function updateEmbedInPage(
  pageId: string,
  blockId: string,
  updater: (embed: EmbeddedObject) => void,
): boolean {
  const pageContent = state.contents[pageId];
  if (!pageContent) return false;
  let updated = false;

  for (const embed of pageContent.embeds) {
    if (embed.id === blockId) {
      updater(embed);
      updated = true;
      break
    }
  }

  if (updated) {
    state.contents[pageId] = cloneState(pageContent);
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

function convertUnknownRoadmapNode(value: unknown): RoadmapNode {
  if (!value || typeof value !== 'object') {
    throw new Error('Roadmap node must be an object.');
  }
  return value as RoadmapNode;
}

function resolveRoadmapRoots(payload: ImportRoadmapPayload): RoadmapNode[] {
  if (payload.root) return [payload.root];
  if (payload.pages?.length) return payload.pages;
  if (Array.isArray(payload.roadmap)) return payload.roadmap.map(convertUnknownRoadmapNode);
  if (payload.roadmap) return [convertUnknownRoadmapNode(payload.roadmap)];
  throw new Error('Roadmap JSON is required.');
}

function countRoadmapNodes(nodes: RoadmapNode[]): number {
  return nodes.reduce((total, node) => total + 1 + countRoadmapNodes(node.children ?? []), 0);
}

function createRoadmapPageMock(kbId: string, parentId: string | null, node: RoadmapNode, order: number): PageItem {
  const title = firstText(node.title, node.name);
  if (!title) {
    throw new Error('Roadmap node title is required.');
  }

  const page: Omit<PageItem, 'children'> = {
    id: nextId('p'),
    kbId,
    parentId,
    title: title.slice(0, 128),
    order,
  };
  state.pages.push(page);

  const body = firstText(node.content, node.description);
  state.contents[page.id] = {
    content: `# ${page.title}${body ? `\n\n${body}` : ''}`,
    embeds: [],
    annotations: [],
  };

  (node.children ?? []).forEach((child, index) => createRoadmapPageMock(kbId, page.id, child, index));
  return { ...cloneState(page), children: [] };
}

export function importRoadmapMock(payload: ImportRoadmapPayload): ImportRoadmapResult {
  const roots = resolveRoadmapRoots(payload);
  const pageCount = countRoadmapNodes(roots);
  if (pageCount === 0) {
    throw new Error('Roadmap contains no pages.');
  }
  if (pageCount > 500) {
    throw new Error('Roadmap page count exceeds 500.');
  }

  const kbName = firstText(payload.name, roots.length === 1 ? firstText(roots[0].title, roots[0].name) ?? undefined : undefined)
    ?? `Roadmap ${Date.now()}`;
  const kb: KnowledgeBase = {
    id: nextId('kb'),
    name: kbName,
    icon: payload.icon || '📚',
    description: payload.description,
  };
  state.knowledgeBases.push(kb);

  roots.forEach((root, index) => createRoadmapPageMock(kb.id, null, root, index));
  persistState();

  return {
    knowledgeBase: cloneState(kb),
    pages: cloneState(buildPageTree(kb.id)),
    pageCount,
  };
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
  return cloneState(state.contents[pageId] ?? { content: '', embeds: [], annotations: [] });
}

export function savePageContentMock(pageId: string, content: PageContent): void {
  getPageOrThrow(pageId);
  state.contents[pageId] = cloneState(content);
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
  state.contents[page.id] = { content: '', embeds: [], annotations: [] };
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
    const pc = state.contents[page.id];
    if (!pc) continue;
    for (const embed of pc.embeds) {
      if (embed.type === 'ref' || embed.type === 'spacer') continue;
      const block: Block = {
        id: embed.id,
        type: embed.type,
        title: embed.title,
        graphData: embed.graphData,
        tableData: embed.tableData,
        multiTableData: embed.multiTableData,
        timelineData: embed.timelineData,
        refId: embed.refId,
        refType: embed.refType,
        spacerHeight: embed.spacerHeight,
        width: embed.width,
        height: embed.height,
        metadata: embed.metadata,
      }
      items.push({ block, pageId: page.id, pageTitle: page.title });
    }
  }

  return items;
}

export function updateBlockContentMock(pageId: string, blockId: string, content: string): void {
  const updated = updateEmbedInPage(pageId, blockId, (embed) => {
    if (embed.type === 'x6') embed.graphData = undefined
  });

  if (!updated) {
    throw new Error(`Block not found: ${blockId}`);
  }
}

export function updateBlockGraphDataMock(pageId: string, blockId: string, graphData: Block['graphData']): void {
  const updated = updateEmbedInPage(pageId, blockId, (embed) => {
    if (embed.type === 'x6') embed.graphData = cloneState(graphData) as EmbeddedObject['graphData'];
  });

  if (!updated) {
    throw new Error(`Block not found: ${blockId}`);
  }
}

export function updateBlockMock(pageId: string, blockId: string, nextBlock: Block): void {
  const updated = updateEmbedInPage(pageId, blockId, (embed) => {
    if (nextBlock.graphData) embed.graphData = cloneState(nextBlock.graphData) as EmbeddedObject['graphData'];
    if (nextBlock.tableData) embed.tableData = cloneState(nextBlock.tableData);
    if (nextBlock.multiTableData) embed.multiTableData = cloneState(nextBlock.multiTableData) as EmbeddedObject['multiTableData'];
    if (nextBlock.content) embed.type = 'x6';
  });

  if (!updated) {
    throw new Error(`Block not found: ${blockId}`);
  }
}

/** @deprecated Use savePageContentMock directly */
export function syncBlocksMock(pageId: string, _blocks: Block[]): void {
  const pc = getPageContentMock(pageId);
  savePageContentMock(pageId, pc);
}

export function deleteAnnotationReferenceMock(pageId: string, _blockId: string, annotationId: string): void {
  const pc = state.contents[pageId];
  if (!pc) throw new Error(`Page not found: ${pageId}`);
  const filtered = pc.annotations.filter((a) => a.id !== annotationId);
  if (filtered.length === pc.annotations.length) throw new Error(`Annotation not found: ${annotationId}`);
  pc.annotations = filtered;
  persistState();
}

function findPageTitle(pageId: string): string {
  const page = state.pages.find((p) => p.id === pageId);
  return page?.title || pageId;
}

export function listReferencesMock(params: ListReferencesParams = {}): ListReferencesResult {
  const results: ReferenceItem[] = [];
  const now = Date.now();

  const targetPages = params.pageId
    ? [params.pageId]
    : Object.keys(state.contents);

  for (const pageId of targetPages) {
    const pc = state.contents[pageId];
    if (!pc) continue;
    const pageTitle = findPageTitle(pageId);

    for (const ann of (pc.annotations || [])) {
      if (params.q) {
        const q = params.q.toLowerCase();
        const text = `${ann.selectedText} ${ann.note} ${ann.contextBefore} ${ann.contextAfter}`.toLowerCase();
        if (!text.includes(q)) continue;
      }

      results.push({
        id: ann.id,
        category: 'annotation',
        editable: true,
        source: {
          pageId,
          pageTitle,
          blockId: '',
          blockType: 'richtext',
          sourceKind: 'annotation',
          sourceLocator: ann.id,
        },
        target: {
          kind: 'annotation',
          blockPreview: ann.selectedText,
          resourceItemTitle: ann.note || '(无备注)',
        },
        status: 'ok',
        citation: {
          displayText: ann.selectedText,
          note: ann.note,
        },
      });
    }
  }

  let filtered = results;
  if (params.category && params.category !== 'all' && params.category !== 'annotation') {
    filtered = results.filter((r) => r.category === params.category);
  }
  if (params.category === 'annotation') {
    filtered = results;
  }

  const total = filtered.length;
  const page = params.page ?? 0;
  const pageSize = params.pageSize ?? 50;
  const from = page * pageSize;
  const items = from >= total ? [] : filtered.slice(from, from + pageSize);

  return { items, total, page, pageSize };
}
