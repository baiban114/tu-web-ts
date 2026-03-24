import { syncBlocks, syncBlock } from '@/api/blockSync';
import type { BlockSyncPayload } from '@/api/blockSync';

type SyncStatus = 'idle' | 'syncing' | 'synced' | 'error';
type StatusChangeCallback = (status: SyncStatus, error?: string | null) => void;

/**
 * 块同步管理器
 * 负责抽象所有块的同步操作，确保在块内容变化时自动同步到后端
 */
export class BlockSyncManager {
  // 存储当前的块列表
  private blocks: BlockSyncPayload[] = [];
  // 同步状态
  private syncStatus: SyncStatus = 'idle';
  // 同步错误信息
  private syncError: string | null = null;
  // 防抖计时器
  private debounceTimer: number | null = null;
  // 防抖延迟时间（毫秒）
  private debounceDelay = 500;
  // 状态变更回调
  private statusChangeCallback: StatusChangeCallback | null = null;

  /**
   * 初始化同步管理器
   * @param initialBlocks 初始块列表
   */
  constructor(initialBlocks: BlockSyncPayload[] = []) {
    this.blocks = initialBlocks;
  }

  /**
   * 注册状态变更回调，每次同步状态变化时触发
   */
  onStatusChange(callback: StatusChangeCallback): void {
    this.statusChangeCallback = callback;
  }

  /**
   * 获取当前同步状态
   */
  getStatus(): SyncStatus {
    return this.syncStatus;
  }

  /**
   * 获取同步错误信息
   */
  getError(): string | null {
    return this.syncError;
  }

  private setStatus(status: SyncStatus, error: string | null = null): void {
    this.syncStatus = status;
    this.syncError = error;
    this.statusChangeCallback?.(status, error);
  }

  /**
   * 更新块列表并触发同步
   * @param blocks 新的块列表
   */
  updateBlocks(blocks: BlockSyncPayload[]): void {
    this.blocks = blocks;
    this.debounceSync();
  }

  /**
   * 防抖同步，避免频繁同步
   */
  private debounceSync(): void {
    if (this.debounceTimer) {
      clearTimeout(this.debounceTimer);
    }

    this.debounceTimer = window.setTimeout(async () => {
      await this.sync();
    }, this.debounceDelay);
  }

  /**
   * 同步所有块到后端
   */
  async sync(): Promise<void> {
    if (this.syncStatus === 'syncing') {
      return; // 正在同步中，避免重复同步
    }

    this.setStatus('syncing');

    try {
      await syncBlocks(this.blocks);
      this.setStatus('synced');
    } catch (error) {
      const msg = error instanceof Error ? error.message : '同步失败';
      console.error('同步块失败:', error);
      this.setStatus('error', msg);
    }
  }

  /**
   * 同步单个块到后端
   * @param block 要同步的块
   */
  async syncSingleBlock(block: BlockSyncPayload): Promise<void> {
    this.setStatus('syncing');

    try {
      await syncBlock(block);
      this.setStatus('synced');
    } catch (error) {
      const msg = error instanceof Error ? error.message : '同步失败';
      console.error('同步单个块失败:', error);
      this.setStatus('error', msg);
    }
  }

  /**
   * 手动触发同步
   */
  async forceSync(): Promise<void> {
    if (this.debounceTimer) {
      clearTimeout(this.debounceTimer);
      this.debounceTimer = null;
    }
    await this.sync();
  }

  /**
   * 销毁同步管理器，清理定时器
   */
  destroy(): void {
    if (this.debounceTimer) {
      clearTimeout(this.debounceTimer);
      this.debounceTimer = null;
    }
  }
}

// 导出单例实例
export const blockSyncManager = new BlockSyncManager();
