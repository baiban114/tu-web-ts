import { ref } from 'vue';
import { defineStore } from 'pinia';
import {
  listKnowledgeBases,
  createKnowledgeBase,
  deleteKnowledgeBase,
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
  type PageItem,
} from '@/api/page';
import type { Block } from '@/api/types';
import { useBlockRegistryStore } from '@/stores/blockRegistry';
import { blockSyncManager } from '@/utils/blockSyncManager';
import { deriveMarkdownPageTitle, parseMarkdownToBlocks } from '@/utils/markdownImport';

export const useWorkspaceStore = defineStore('workspace', () => {
  const kbList = ref<KnowledgeBase[]>([]);
  const currentKbId = ref<string | null>(null);
  const pageTree = ref<PageItem[]>([]);
  const currentPageId = ref<string | null>(null);
  const currentBlocks = ref<Block[]>([]);
  const loading = ref(false);
  const registryStore = useBlockRegistryStore();

  function resetWorkspaceState() {
    currentKbId.value = null;
    currentPageId.value = null;
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

  async function saveCurrentPage(blocks: Block[]) {
    if (!currentPageId.value) return;
    currentBlocks.value = blocks;
    await savePageContent(currentPageId.value, blocks);
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

  async function importMarkdownFile(file: File) {
    if (!currentKbId.value) {
      throw new Error('请先选择知识库');
    }

    const markdown = await file.text();
    const pageTitle = deriveMarkdownPageTitle(file.name);
    const page = await createPage(currentKbId.value, null, pageTitle);
    const blocks = parseMarkdownToBlocks(markdown, `${page.id}-${Date.now().toString(36)}`);
    await savePageContent(page.id, blocks);
    pageTree.value = await getPageTree(currentKbId.value);
    await selectPage(page.id);
  }

  async function removePage(id: string) {
    await deletePage(id);
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
  }

  return {
    kbList,
    currentKbId,
    pageTree,
    currentPageId,
    currentBlocks,
    loading,
    loadKbList,
    reloadWorkspace,
    selectKb,
    selectPage,
    saveCurrentPage,
    addKb,
    removeKb,
    addPage,
    importMarkdownFile,
    removePage,
    reorderPage,
    renameCurrentPage,
  };
});
