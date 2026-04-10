/**
 * 全局 Block 注册表
 *
 * 职责：
 *  - 存储所有已加载页面的 block（非 ref 类型）的"活跃内容"
 *  - ref 块通过 refId 从这里读取并回写内容，实现跨页面实时同步
 *  - 更新时同步回写 mock 存储（可无缝替换为真实 API）
 */

import { reactive } from 'vue';
import { defineStore } from 'pinia';
import {
  listAllBlocks,
  updateBlockContent,
  type BlockWithMeta,
} from '@/api/page';
import type { Block } from '@/components/Page.vue';

export const useBlockRegistryStore = defineStore('blockRegistry', () => {
  // blockId → { block, pageId, pageTitle }
  // 使用 reactive Map：.set() 会触发依赖该 key 的所有 template/computed 更新
  const registry = reactive(new Map<string, BlockWithMeta>());

  /** 从 API 拉取全量可引用块，供 BlockPicker 使用 */
  async function loadAll() {
    const items = await listAllBlocks();
    for (const item of items) {
      // 只在 key 不存在时写入，不覆盖运行中已被编辑的内容
      if (!registry.has(item.block.id)) {
        registry.set(item.block.id, { ...item, block: { ...item.block } });
      }
    }
  }

  /** 页面加载时批量注册该页所有原始块 */
  function registerBlocks(blocks: Block[], pageId: string, pageTitle: string) {
    for (const block of blocks) {
      if (block.type === 'ref' || block.type === 'spacer') continue;
      registry.set(block.id, { block: { ...block }, pageId, pageTitle });
    }
  }

  /** 读取块（供 ref 块渲染时使用） */
  function getBlock(id: string): Block | undefined {
    return registry.get(id)?.block;
  }

  /** 读取块元信息（来源页标题等） */
  function getMeta(id: string): BlockWithMeta | undefined {
    return registry.get(id);
  }

  /**
   * 更新块内容。
   * 1. 立即更新 registry（响应式，所有引用该块的组件同步刷新）
   * 2. 异步回写原始页的 mock 存储
   */
  async function updateContent(blockId: string, content: string) {
    const entry = registry.get(blockId);
    if (!entry) return;
    // 替换为新对象以确保 Vue 响应式追踪到变化
    registry.set(blockId, { ...entry, block: { ...entry.block, content } });
    await updateBlockContent(entry.pageId, blockId, content);
  }

  /** 获取全部可引用块列表（供 BlockPicker 展示） */
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
    getAllBlocks,
  };
});
