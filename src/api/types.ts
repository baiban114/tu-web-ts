export interface GraphData {
  cells?: Array<Record<string, unknown>>;
  nodes: Array<{
    id: string;
    x?: number;
    y?: number;
    width?: number;
    height?: number;
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
}

export interface Block {
  id: string;
  type: 'richtext' | 'richText' | 'line' | 'x6' | 'ref' | 'container' | 'spacer' | string;
  title?: string;
  content?: string;
  refId?: string;
  graphData?: GraphData;
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
  layout?: 'horizontal' | 'vertical';
  children?: Block[];
  width?: string;
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

export interface PageContent {
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
