import { reactive } from 'vue';
import { defineStore } from 'pinia';
import {
  listAllBlocks,
  updateBlockContent,
  updateBlockGraphData,
  type BlockWithMeta,
} from '@/api/page';
import type { Block } from '@/components/Page.vue';

export const useBlockRegistryStore = defineStore('blockRegistry', () => {
  const registry = reactive(new Map<string, BlockWithMeta>());

  async function loadAll() {
    const items = await listAllBlocks();
    registry.clear();
    for (const item of items) {
      registry.set(item.block.id, { ...item, block: { ...item.block } });
    }
  }

  function registerBlocks(blocks: Block[], pageId: string, pageTitle: string) {
    for (const block of blocks) {
      if (block.type === 'ref' || block.type === 'spacer') continue;
      registry.set(block.id, { block: { ...block }, pageId, pageTitle });
    }
  }

  function getBlock(id: string): Block | undefined {
    return registry.get(id)?.block;
  }

  function getMeta(id: string): BlockWithMeta | undefined {
    return registry.get(id);
  }

  async function updateContent(blockId: string, content: string) {
    const entry = registry.get(blockId);
    if (!entry) return;
    registry.set(blockId, { ...entry, block: { ...entry.block, content } });
    await updateBlockContent(entry.pageId, blockId, content);
  }

  async function updateGraphData(blockId: string, graphData: Block['graphData']) {
    const entry = registry.get(blockId);
    if (!entry) return;
    registry.set(blockId, { ...entry, block: { ...entry.block, graphData } });
    await updateBlockGraphData(entry.pageId, blockId, graphData);
  }

  function getAllBlocks(): BlockWithMeta[] {
    return Array.from(registry.values());
  }

  return {
    registry,
    loadAll,
    registerBlocks,
    getBlock,
    getMeta,
    updateContent,
    updateGraphData,
    getAllBlocks,
  };
});

