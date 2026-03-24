// 统一的块内容同步 API（当前为开发阶段 mock，实现可无缝切换到 Spring Boot 2 后端）
// 后端真实接口建议：POST /api/blocks/sync  接收完整 contentList 或单个 block。

export interface BlockSyncPayload {
  id: string;
  type: string;
  title?: string;
  content?: string;
  graphData?: unknown;
  timelineData?: unknown;
  // 预留扩展字段，保持与前端 Block 结构兼容
  [key: string]: unknown;
}

// 模拟与后端的网络延时
const mockDelay = (ms: number) =>
  new Promise<void>((resolve) => setTimeout(resolve, ms));

/**
 * 同步整页所有块内容到后端（推荐使用该方法，保持服务端数据完整一致）
 */
export async function syncBlocks(
  blocks: BlockSyncPayload[],
): Promise<void> {
  // TODO: 接入真实 Spring Boot 2 接口：
  // await fetch('/api/blocks/sync', {
  //   method: 'POST',
  //   headers: { 'Content-Type': 'application/json' },
  //   body: JSON.stringify(blocks),
  // });

  // 开发阶段：仅做 mock，打印到控制台并模拟网络请求
  console.info('[BlockSync] 同步块列表到后端（mock）：', blocks);
  await mockDelay(200);
}

/**
 * 同步单个块内容到后端
 */
export async function syncBlock(block: BlockSyncPayload): Promise<void> {
  return syncBlocks([block]);
}

