export interface GraphData {
  cells?: Array<Record<string, unknown>>;
  nodes: Array<{
    id: string;
    x?: number;
    y?: number;
    position?: {
      x?: number;
      y?: number;
      [key: string]: unknown;
    };
    width?: number;
    height?: number;
    size?: {
      width?: number;
      height?: number;
      [key: string]: unknown;
    };
    label?: string;
    shape?: string;
    style?: {
      x?: number;
      y?: number;
      [key: string]: unknown;
    };
    attrs?: Record<string, unknown>;
    ports?: Record<string, unknown>;
    data?: {
      label?: string;
      time?: string;
      done?: boolean;
      [key: string]: unknown;
    };
    [key: string]: unknown;
  }>;
  edges: Array<{
    id?: string;
    source: string | Record<string, unknown>;
    target: string | Record<string, unknown>;
    attrs?: Record<string, unknown>;
    router?: string | Record<string, unknown>;
    connector?: string | Record<string, unknown>;
    labels?: Array<Record<string, unknown>>;
    data?: {
      done?: boolean;
      [key: string]: unknown;
    };
    [key: string]: unknown;
  }>;
  blueprintMeta?: {
    anchor: {
      x: number;
      y: number;
    };
    extractedCenter?: {
      x: number;
      y: number;
    };
    extractedCount?: number;
    kind?: string;
  };
}

export interface BlockTag {
  id: string;
  label: string;
  color?: string;
}

export interface SpannedBlockInfo {
  blockId: string;
  blockType: string;
  title?: string;
}

export interface TextAnnotation {
  id: string;
  selectedText: string;
  contextBefore: string;
  contextAfter: string;
  note: string;
  color: string;
  createdAt: number;
  updatedAt: number;
  from?: number;
  to?: number;
  blockId?: string;
  anchorVersion?: number;
  lastResolvedAt?: number;
  unresolved?: boolean;
  scope?: 'text' | 'block' | 'compound';
  spannedBlockIds?: string[];
  spannedBlockMetadata?: SpannedBlockInfo[];
}

export interface BlockMetadata {
  tags?: BlockTag[];
  [key: string]: unknown;
}

export interface TableBlockData {
  textMode?: 'plain' | 'rich';
  headers: string[];
  rows: string[][];
  columnWidths?: number[];
  rowHeights?: number[];
}

export type MultiTableFieldType =
  | 'text'
  | 'number'
  | 'date'
  | 'singleSelect'
  | 'checkbox'
  | 'url'
  | 'estimatedHours'
  | 'lifecycle';

export interface MultiTableFieldOption {
  id: string;
  label: string;
  color?: string;
}

export interface MultiTableField {
  id: string;
  name: string;
  type: MultiTableFieldType;
  options?: MultiTableFieldOption[];
  required?: boolean;
  lifecyclePreset?: boolean;
}

export interface MultiTableRecord {
  id: string;
  values: Record<string, string | number | boolean | null>;
  subtasks?: MultiTableSubtask[];
}

export interface MultiTableSubtask {
  id: string;
  title: string;
  estimatedHours: number;
  done?: boolean;
}

export interface MultiTableView {
  id: string;
  name: string;
  type: 'table' | 'kanban';
  groupByFieldId?: string;
}

export interface MultiTableData {
  fields: MultiTableField[];
  records: MultiTableRecord[];
  views: MultiTableView[];
  activeViewId?: string;
}

/**
 * 嵌入对象 — 非文本类型的内容，在 markdown content 中用占位符标记位置。
 * 占位符格式: <!--tu:embed id="..." type="..."-->
 */
export interface EmbeddedObject {
  id: string
  type: 'x6' | 'table' | 'multiTable' | 'timeline' | 'ref' | 'spacer'
  title?: string
  graphData?: GraphData
  tableData?: TableBlockData
  multiTableData?: MultiTableData
  timelineData?: Array<{
    id: string
    title: string
    content: string
    date: string
    color: string
    lightColor: string
    type: 'normal' | 'milestone'
  }>
  refId?: string
  refType?: 'block' | 'page'
  spacerHeight?: number
  width?: number | string
  height?: number
  metadata?: Record<string, unknown>
}

/**
 * 页面级内容模型 — 取代 Block[]。
 * - content: 整页富文本，一段连续 markdown，嵌入对象用占位符标记位置
 * - embeds: 非文本嵌入对象
 * - annotations: 页面级别划选标注
 */
export interface PageContent {
  content: string
  embeds: EmbeddedObject[]
  annotations: TextAnnotation[]
  metadata?: Record<string, unknown>
}

/** @deprecated 使用 EmbeddedObject + PageContent 替代 */
export interface Block {
  id: string;
  type: 'richtext' | 'richText' | 'line' | 'x6' | 'ref' | 'container' | 'spacer' | 'table' | string;
  title?: string;
  content?: string;
  metadata?: BlockMetadata;
  refId?: string;
  refType?: 'block' | 'page';
  graphData?: GraphData;
  tableData?: TableBlockData;
  multiTableData?: MultiTableData;
  timelineData?: Array<{
    id: string;
    title: string;
    content: string;
    date: string;
    color: string;
    lightColor: string;
    type: 'normal' | 'milestone';
  }>;
  blockHeight?: number;
  spacerHeight?: number;
  width?: number | string;
  height?: number;
  layout?: 'horizontal' | 'vertical' | 'free';
  containerPosition?: {
    x: number;
    y: number;
    z?: number;
  };
  children?: Block[];
  [key: string]: unknown;
}

export interface PageItem {
  id: string;
  kbId: string;
  parentId: string | null;
  title: string;
  order: number;
  children?: PageItem[];
}

/** @deprecated 使用新 PageContent 替代 */
export interface PageBlocks {
  pageId: string;
  blocks: Block[];
}

export interface BlockWithMeta {
  block: Block;
  pageId: string;
  pageTitle: string;
}

export interface KnowledgeBase {
  id: string;
  name: string;
  icon?: string;
  description?: string;
}

export interface RoadmapNode {
  title?: string;
  name?: string;
  description?: string;
  content?: string;
  children?: RoadmapNode[];
}

export interface ImportRoadmapPayload {
  name?: string;
  icon?: string;
  description?: string;
  root?: RoadmapNode;
  pages?: RoadmapNode[];
  roadmap?: RoadmapNode | RoadmapNode[] | unknown;
}

export interface ImportRoadmapResult {
  knowledgeBase: KnowledgeBase;
  pages: PageItem[];
  pageCount: number;
}
