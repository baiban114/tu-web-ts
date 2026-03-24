// 知识库 mock API（开发阶段，可无缝切换到后端接口）
// 后端建议：GET /api/kbs, POST /api/kbs, DELETE /api/kbs/:id, PATCH /api/kbs/:id

export interface KnowledgeBase {
  id: string;
  name: string;
  icon?: string;
  description?: string;
}

const mockDelay = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

let _kbs: KnowledgeBase[] = [
  { id: 'kb-1', name: '个人笔记', icon: '📓', description: '日常学习与思考记录' },
  { id: 'kb-2', name: '技术文档', icon: '💻', description: '开发规范与技术说明' },
  { id: 'kb-3', name: '项目规划', icon: '📋', description: '项目目标与进度安排' },
];

export async function listKnowledgeBases(): Promise<KnowledgeBase[]> {
  return [..._kbs];
}

export async function createKnowledgeBase(name: string): Promise<KnowledgeBase> {
  await mockDelay(100);
  const kb: KnowledgeBase = { id: `kb-${Date.now()}`, name, icon: '📄' };
  _kbs.push(kb);
  return kb;
}

export async function deleteKnowledgeBase(id: string): Promise<void> {
  await mockDelay(100);
  _kbs = _kbs.filter((kb) => kb.id !== id);
}

export async function renameKnowledgeBase(id: string, name: string): Promise<void> {
  await mockDelay(100);
  const kb = _kbs.find((k) => k.id === id);
  if (kb) kb.name = name;
}
