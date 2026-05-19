import { computed, ref } from 'vue';
import { defineStore } from 'pinia';
import {
  listKnowledgeBases,
  createKnowledgeBase,
  deleteKnowledgeBase,
  importRoadmap,
  type KnowledgeBase,
} from '@/api/knowledge';
import {
  getPageTree,
  getPageContent,
  savePageContent,
  createPage,
  deletePage,
  movePage,
  renamePage,
} from '@/api/page';
import type { Block, GraphData, PageItem } from '@/api/types';
import type { ImportRoadmapPayload } from '@/api/types';
import { useBlockRegistryStore } from '@/stores/blockRegistry';
import { blockSyncManager } from '@/utils/blockSyncManager';
import {
  deriveMarkdownPageTitle,
  parseMarkdownToBlocks,
  serializeBlocksToMarkdown,
} from '@/utils/markdownImport';
import { parseKnowledgeRoadmapGraphData } from '@/utils/roadmapGraph';

type LocalFileSaveStatus = 'idle' | 'pending' | 'saving' | 'saved' | 'error' | 'unsupported';

interface LocalFileBinding {
  fileName: string;
  fileHandle: FileSystemFileHandle | null;
  directSaveSupported: boolean;
  status: LocalFileSaveStatus;
  error: string | null;
  lastSavedAt: number | null;
  lastSavedContent: string;
  pendingContent: string | null;
  saveTimer: number | null;
  isWriting: boolean;
}

interface ImportMarkdownFileOptions {
  fileHandle?: FileSystemFileHandle | null;
  directSaveSupported?: boolean;
}

const LOCAL_FILE_SAVE_DELAY = 800;
const UNSUPPORTED_SAVE_MESSAGE = 'Current browser can import the file, but it cannot auto-save changes back to the original local file.';

export const useWorkspaceStore = defineStore('workspace', () => {
  const kbList = ref<KnowledgeBase[]>([]);
  const currentKbId = ref<string | null>(null);
  const pageTree = ref<PageItem[]>([]);
  const currentPageId = ref<string | null>(null);
  const currentBlocks = ref<Block[]>([]);
  const focusedBlockId = ref<string | null>(null);
  const loading = ref(false);
  const localFileBindings = ref<Record<string, LocalFileBinding>>({});
  const registryStore = useBlockRegistryStore();

  const currentLocalFileBinding = computed(() => {
    const pageId = currentPageId.value;
    if (!pageId) return null;
    return localFileBindings.value[pageId] ?? null;
  });

  const currentPageTitle = computed(() => {
    const pageId = currentPageId.value;
    return pageId ? findPageTitle(pageId) : '';
  });

  function clearBindingTimer(binding: LocalFileBinding | undefined) {
    if (!binding?.saveTimer) return;
    window.clearTimeout(binding.saveTimer);
    binding.saveTimer = null;
  }

  function clearLocalFileBinding(pageId: string) {
    const binding = localFileBindings.value[pageId];
    clearBindingTimer(binding);
    if (!binding) return;

    const nextBindings = { ...localFileBindings.value };
    delete nextBindings[pageId];
    localFileBindings.value = nextBindings;
  }

  function resetWorkspaceState() {
    currentKbId.value = null;
    currentPageId.value = null;
    focusedBlockId.value = null;
    pageTree.value = [];
    currentBlocks.value = [];
    blockSyncManager.setPageId(null);
    registryStore.clear();
  }

  async function loadKbList() {
    kbList.value = await listKnowledgeBases();
    if (kbList.value.length === 0) {
      resetWorkspaceState();
      return;
    }

    const nextKbId = currentKbId.value && kbList.value.some((kb) => kb.id === currentKbId.value)
      ? currentKbId.value
      : kbList.value[0].id;

    if (nextKbId) {
      await selectKb(nextKbId);
    }
  }

  function findFirstPage(nodes: PageItem[]): PageItem | undefined {
    if (!nodes || nodes.length === 0) return undefined;
    return nodes[0];
  }

  async function selectKb(kbId: string) {
    currentKbId.value = kbId;
    currentPageId.value = null;
    blockSyncManager.setPageId(null);
    currentBlocks.value = [];
    registryStore.clear();
    pageTree.value = await getPageTree(kbId);
    const firstPage = findFirstPage(pageTree.value);
    if (firstPage) await selectPage(firstPage.id);
  }

  async function selectPage(pageId: string) {
    currentPageId.value = pageId;
    focusedBlockId.value = null;
    blockSyncManager.setPageId(pageId);
    loading.value = true;
    try {
      currentBlocks.value = await getPageContent(pageId);
      const pageTitle = findPageTitle(pageId);
      registryStore.registerBlocks(currentBlocks.value, pageId, pageTitle);
    } finally {
      loading.value = false;
    }
  }

  function findPageTitle(pageId: string): string {
    const walk = (nodes: PageItem[]): string | undefined => {
      for (const n of nodes) {
        if (n.id === pageId) return n.title;
        if (n.children?.length) {
          const found = walk(n.children);
          if (found) return found;
        }
      }
    };
    return walk(pageTree.value) ?? pageId;
  }

  function flattenPages(nodes: PageItem[]): PageItem[] {
    const result: PageItem[] = [];
    const visit = (items: PageItem[]) => {
      items.forEach((item) => {
        result.push(item);
        if (item.children?.length) visit(item.children);
      });
    };
    visit(nodes);
    return result;
  }

  function bindLocalFileToPage(
    pageId: string,
    fileName: string,
    initialMarkdown: string,
    options?: ImportMarkdownFileOptions,
  ) {
    const directSaveSupported = options?.directSaveSupported ?? Boolean(options?.fileHandle);

    localFileBindings.value = {
      ...localFileBindings.value,
      [pageId]: {
        fileName,
        fileHandle: options?.fileHandle ?? null,
        directSaveSupported,
        status: directSaveSupported ? 'saved' : 'unsupported',
        error: directSaveSupported ? null : UNSUPPORTED_SAVE_MESSAGE,
        lastSavedAt: directSaveSupported ? Date.now() : null,
        lastSavedContent: initialMarkdown,
        pendingContent: null,
        saveTimer: null,
        isWriting: false,
      },
    };
  }

  async function ensureReadWritePermission(fileHandle: FileSystemFileHandle) {
    const descriptor = { mode: 'readwrite' as const };
    const currentPermission = await fileHandle.queryPermission?.(descriptor);
    if (currentPermission === 'granted') return;

    const requestedPermission = await fileHandle.requestPermission?.(descriptor);
    if (requestedPermission === 'granted') return;

    throw new Error('Local file write permission was not granted.');
  }

  async function flushLocalFileSave(pageId: string) {
    const binding = localFileBindings.value[pageId];
    if (!binding || binding.isWriting) return;

    const nextContent = binding.pendingContent;
    if (nextContent == null || nextContent === binding.lastSavedContent) {
      binding.pendingContent = null;
      if (binding.directSaveSupported) {
        binding.status = binding.lastSavedAt ? 'saved' : 'idle';
      }
      return;
    }

    if (!binding.directSaveSupported || !binding.fileHandle) {
      binding.status = 'unsupported';
      binding.error = UNSUPPORTED_SAVE_MESSAGE;
      return;
    }

    binding.isWriting = true;
    binding.status = 'saving';
    binding.error = null;

    try {
      await ensureReadWritePermission(binding.fileHandle);
      const writable = await binding.fileHandle.createWritable();
      await writable.write(nextContent);
      await writable.close();

      binding.lastSavedContent = nextContent;
      binding.pendingContent = null;
      binding.lastSavedAt = Date.now();
      binding.status = 'saved';
    } catch (error) {
      binding.status = 'error';
      binding.error = error instanceof Error ? error.message : 'Failed to save local file.';
    } finally {
      binding.isWriting = false;
      if (binding.pendingContent && binding.pendingContent !== binding.lastSavedContent) {
        clearBindingTimer(binding);
        binding.status = 'pending';
        binding.saveTimer = window.setTimeout(() => {
          binding.saveTimer = null;
          void flushLocalFileSave(pageId);
        }, LOCAL_FILE_SAVE_DELAY);
      }
    }
  }

  function scheduleLocalFileSave(pageId: string, blocks: Block[]) {
    const binding = localFileBindings.value[pageId];
    if (!binding) return;

    const markdown = serializeBlocksToMarkdown(blocks);
    binding.pendingContent = markdown;

    if (!binding.directSaveSupported || !binding.fileHandle) {
      binding.status = 'unsupported';
      binding.error = UNSUPPORTED_SAVE_MESSAGE;
      return;
    }

    if (markdown === binding.lastSavedContent) {
      binding.pendingContent = null;
      binding.status = binding.lastSavedAt ? 'saved' : 'idle';
      return;
    }

    if (binding.isWriting) {
      binding.status = 'pending';
      return;
    }

    clearBindingTimer(binding);
    binding.status = 'pending';
    binding.saveTimer = window.setTimeout(() => {
      binding.saveTimer = null;
      void flushLocalFileSave(pageId);
    }, LOCAL_FILE_SAVE_DELAY);
  }

  async function saveCurrentPage(blocks: Block[]) {
    if (!currentPageId.value) return;

    const pageId = currentPageId.value;
    currentBlocks.value = blocks;

    try {
      await savePageContent(pageId, blocks);
    } finally {
      scheduleLocalFileSave(pageId, blocks);
    }
  }

  async function openPageAtBlock(pageId: string, blockId: string | null) {
    await selectPage(pageId);
    focusedBlockId.value = blockId;
  }

  function consumeFocusedBlockId(): string | null {
    const value = focusedBlockId.value;
    focusedBlockId.value = null;
    return value;
  }

  async function reloadWorkspace() {
    resetWorkspaceState();
    await loadKbList();
  }

  async function addKb(name: string) {
    const kb = await createKnowledgeBase(name);
    kbList.value.push(kb);
    return kb;
  }

  async function removeKb(id: string) {
    await deleteKnowledgeBase(id);
    kbList.value = kbList.value.filter((kb) => kb.id !== id);
    if (currentKbId.value === id) {
      if (kbList.value.length > 0) {
        await selectKb(kbList.value[0].id);
      } else {
        resetWorkspaceState();
      }
    }
  }

  async function addPage(parentId: string | null, title?: string) {
    if (!currentKbId.value) return;
    await createPage(currentKbId.value, parentId, title);
    pageTree.value = await getPageTree(currentKbId.value);
  }

  async function importMarkdownFile(file: File, options?: ImportMarkdownFileOptions) {
    if (!currentKbId.value) {
      throw new Error('Please select a knowledge base first.');
    }

    const markdown = await file.text();
    const pageTitle = deriveMarkdownPageTitle(file.name);
    const page = await createPage(currentKbId.value, null, pageTitle);
    const blocks = parseMarkdownToBlocks(markdown, `${page.id}-${Date.now().toString(36)}`);

    await savePageContent(page.id, blocks);
    bindLocalFileToPage(page.id, file.name, markdown, options);
    pageTree.value = await getPageTree(currentKbId.value);
    await selectPage(page.id);
  }

  async function importRoadmapJson(payload: ImportRoadmapPayload) {
    const result = await importRoadmap(payload);
    kbList.value = await listKnowledgeBases();
    if (!kbList.value.some((kb) => kb.id === result.knowledgeBase.id)) {
      kbList.value.push(result.knowledgeBase);
    }
    await selectKb(result.knowledgeBase.id);
    return result;
  }

  async function syncKnowledgeRoadmapToSource(graphData: GraphData) {
    if (!currentKbId.value) {
      throw new Error('Please select a knowledge base first.');
    }

    const parsed = parseKnowledgeRoadmapGraphData(graphData);
    const pageById = new Map(flattenPages(pageTree.value).map((page) => [page.id, page]));
    const createdPageIdByNodeId = new Map<string, string>();

    for (const node of parsed.nodes) {
      if (node.pageId) continue;
      const parentId = node.parentNodeId
        ? createdPageIdByNodeId.get(node.parentNodeId) ?? node.parentPageId
        : null;
      const page = await createPage(currentKbId.value, parentId, node.title);
      createdPageIdByNodeId.set(node.nodeId, page.id);
    }

    for (const node of parsed.nodes) {
      const pageId = node.pageId ?? createdPageIdByNodeId.get(node.nodeId);
      if (!pageId) continue;
      const existing = pageById.get(pageId);
      if (existing && existing.title !== node.title) {
        await renamePage(pageId, node.title);
      }
    }

    for (const node of parsed.nodes) {
      const pageId = node.pageId ?? createdPageIdByNodeId.get(node.nodeId);
      if (!pageId) continue;
      const parentId = node.parentNodeId
        ? createdPageIdByNodeId.get(node.parentNodeId) ?? node.parentPageId
        : null;
      await movePage(pageId, parentId, node.order);
    }

    pageTree.value = await getPageTree(currentKbId.value);
    return {
      createdCount: createdPageIdByNodeId.size,
      changedCount: parsed.nodes.length,
      warnings: parsed.warnings,
    };
  }

  async function removePage(id: string) {
    await deletePage(id);
    clearLocalFileBinding(id);
    if (currentKbId.value) {
      pageTree.value = await getPageTree(currentKbId.value);
    }
    if (currentPageId.value === id) {
      currentPageId.value = null;
      blockSyncManager.setPageId(null);
      currentBlocks.value = [];
    }
  }

  async function reorderPage(
    id: string,
    newParentId: string | null,
    newOrder: number,
  ) {
    await movePage(id, newParentId, newOrder);
    if (currentKbId.value) {
      pageTree.value = await getPageTree(currentKbId.value);
    }
  }

  async function renameCurrentPage(id: string, title: string) {
    await renamePage(id, title);
    if (currentKbId.value) {
      pageTree.value = await getPageTree(currentKbId.value);
    }
    if (currentPageId.value === id) {
      registryStore.registerBlocks(currentBlocks.value, id, title);
    }
  }

  return {
    kbList,
    currentKbId,
    pageTree,
    currentPageId,
    currentBlocks,
    currentPageTitle,
    focusedBlockId,
    loading,
    currentLocalFileBinding,
    loadKbList,
    reloadWorkspace,
    selectKb,
    selectPage,
    openPageAtBlock,
    consumeFocusedBlockId,
    saveCurrentPage,
    addKb,
    removeKb,
    addPage,
    importMarkdownFile,
    importRoadmapJson,
    syncKnowledgeRoadmapToSource,
    removePage,
    reorderPage,
    renameCurrentPage,
  };
});
