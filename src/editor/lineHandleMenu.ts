export type InsertBlockType =
  | 'richtext'
  | 'ref'
  | 'externalResource'
  | 'line'
  | 'x6'
  | 'x6-mindmap'
  | 'knowledge-roadmap'
  | 'table'
  | 'multiTable'
  | 'spacer'

export interface InsertOption {
  key: InsertBlockType
  label: string
  icon: string
  keywords: string[]
}

export interface LineHandleMenuItem {
  key: string
  label?: string
  icon?: string
  danger?: boolean
  divider?: boolean
}

export type LineHandleAction =
  | InsertBlockType
  | 'mark-excerpt'
  | 'set-basis'
  | 'add-note'
  | 'cut'
  | 'copy'
  | 'duplicate'
  | 'clear-formatting'
  | 'delete'

export const insertOptions: InsertOption[] = [
  { key: 'richtext', label: '文本', icon: '📝', keywords: ['text', 'richtext', 'wenben'] },
  { key: 'ref', label: '引用', icon: '🔖', keywords: ['ref', 'reference', 'yinyong'] },
  { key: 'externalResource', label: '外部资源', icon: '▣', keywords: ['resource', 'external', 'book', 'ziyuan', 'tushu'] },
  { key: 'line', label: '时间轴', icon: '🕒', keywords: ['timeline', 'line', 'shijianzhou'] },
  { key: 'x6', label: 'X6 画板', icon: '🧩', keywords: ['x6', 'graph', 'draw', 'huaban'] },
  { key: 'x6-mindmap', label: '思维导图', icon: '◇', keywords: ['mindmap', '思维导图', '脑图', 'tree'] },
  { key: 'knowledge-roadmap', label: '知识库路线图', icon: '🗺️', keywords: ['roadmap', 'knowledge', 'kb', 'zhishiku'] },
  { key: 'table', label: '表格', icon: '▦', keywords: ['table', 'biaoge'] },
  { key: 'multiTable', label: '多维表格', icon: '▤', keywords: ['multi', 'database', 'kanban', 'duowei'] },
  { key: 'spacer', label: '分割空白', icon: '↕', keywords: ['spacer', 'blank', 'kongbai'] },
]

export function buildEditorLineHandleItems(extraActionItems: LineHandleMenuItem[] = []): LineHandleMenuItem[] {
  return [
    { key: 'insert-divider', label: '插入', divider: true },
    ...insertOptions.map((option) => ({ key: option.key, label: option.label, icon: option.icon })),
    { key: 'action-divider', label: '操作', divider: true },
    ...extraActionItems,
    { key: 'mark-excerpt', label: '标记节选', icon: '▣' },
    { key: 'set-basis', label: '设置依据', icon: '◎' },
    { key: 'cut', label: '剪切行', icon: '✂️' },
    { key: 'copy', label: '复制', icon: '📋' },
    { key: 'duplicate', label: '复制行', icon: '📄' },
    { key: 'clear-formatting', label: '清除格式', icon: '🧹' },
    { key: 'delete', label: '删除行', icon: '🗑️', danger: true },
  ]
}

export const sectionHandleExtraItems: LineHandleMenuItem[] = [
  { key: 'add-note', label: '添加标注（本节）', icon: '📝' },
]

export function buildSectionHandleItems(): LineHandleMenuItem[] {
  return buildEditorLineHandleItems(sectionHandleExtraItems)
}

export function isInsertBlockAction(key: string): key is InsertBlockType {
  return insertOptions.some((option) => option.key === key)
}
