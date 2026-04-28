import type { Block } from '@/api/types';
import { blockHasTags } from '@/utils/blockMetadata';

const CUSTOM_BLOCK_FENCE = 'tu-block';

function sanitizeLineEndings(markdown: string): string {
  return markdown.replace(/\r\n/g, '\n').replace(/\r/g, '\n');
}

function createHash(input: string): string {
  let hash = 0;
  for (let i = 0; i < input.length; i += 1) {
    hash = ((hash << 5) - hash) + input.charCodeAt(i);
    hash |= 0;
  }
  return Math.abs(hash).toString(36);
}

function createBlockId(sourceKey: string, chunk: string, index: number): string {
  return `md-${sourceKey}-${index}-${createHash(chunk).slice(0, 8)}`;
}

function normalizeChunk(chunk: string): string {
  return chunk.trim().replace(/\n{3,}/g, '\n\n');
}

function stripTransientBlockFields(block: Block): Block {
  const { blockHeight, source, sourceChunkIndex, ...rest } = block;
  const normalizedChildren = Array.isArray(rest.children)
    ? rest.children.map((child) => stripTransientBlockFields(child))
    : rest.children;

  return {
    ...rest,
    ...(normalizedChildren ? { children: normalizedChildren } : {}),
  };
}

function parseCustomBlockChunk(chunk: string, sourceKey: string, index: number): Block | null {
  const match = chunk.match(/^```tu-block\s*\n([\s\S]*?)\n```$/);
  if (!match) return null;

  try {
    const parsed = JSON.parse(match[1]) as Block;
    return {
      ...parsed,
      id: typeof parsed.id === 'string' && parsed.id.trim()
        ? parsed.id
        : createBlockId(sourceKey, chunk, index),
      type: parsed.type === 'richText' ? 'richtext' : parsed.type,
    };
  } catch {
    return null;
  }
}

function splitMarkdownIntoChunks(markdown: string): string[] {
  const normalized = sanitizeLineEndings(markdown);
  const lines = normalized.split('\n');
  const chunks: string[] = [];
  let buffer: string[] = [];
  let inCodeFence = false;

  const flush = () => {
    if (buffer.length === 0) return;
    const chunk = normalizeChunk(buffer.join('\n'));
    if (chunk) {
      chunks.push(chunk);
    }
    buffer = [];
  };

  for (const line of lines) {
    const trimmed = line.trim();

    if (trimmed.startsWith('```')) {
      if (!inCodeFence && buffer.length > 0) {
        flush();
      }
      buffer.push(line);
      inCodeFence = !inCodeFence;
      if (!inCodeFence) {
        flush();
      }
      continue;
    }

    if (inCodeFence) {
      buffer.push(line);
      continue;
    }

    if (!trimmed) {
      flush();
      continue;
    }

    if (/^#{1,6}\s+/.test(trimmed) && buffer.length > 0) {
      flush();
    }

    buffer.push(line);
  }

  flush();
  return chunks;
}

export function deriveMarkdownPageTitle(fileName: string): string {
  const title = fileName.replace(/\.(md|markdown)$/i, '').trim();
  return title || 'Imported Markdown';
}

function serializeRichTextBlock(block: Block): string {
  if (blockHasTags(block)) {
    return serializeStructuredBlock({
      ...block,
      type: 'richtext',
    });
  }

  return sanitizeLineEndings(String(block.content ?? '')).trim();
}

function serializeStructuredBlock(block: Block): string {
  const normalizedBlock = stripTransientBlockFields(block);
  return [
    `\`\`\`${CUSTOM_BLOCK_FENCE}`,
    JSON.stringify(normalizedBlock, null, 2),
    '```',
  ].join('\n');
}

export function serializeBlocksToMarkdown(blocks: Block[]): string {
  const chunks = blocks
    .map((block) => {
      const normalizedType = block.type === 'richText' ? 'richtext' : block.type;
      if (normalizedType === 'spacer') return '';
      if (normalizedType === 'richtext') {
        return serializeRichTextBlock(block);
      }
      return serializeStructuredBlock({
        ...block,
        type: normalizedType,
      });
    })
    .filter((chunk) => chunk.trim().length > 0);

  return chunks.join('\n\n');
}

export function parseMarkdownToBlocks(markdown: string, sourceKey = Date.now().toString(36)): Block[] {
  const chunks = splitMarkdownIntoChunks(markdown);
  if (chunks.length === 0) {
    return [
      {
        id: createBlockId(sourceKey, 'empty', 0),
        type: 'richtext',
        content: '',
      },
    ];
  }

  return chunks.map((chunk, index) => {
    const customBlock = parseCustomBlockChunk(chunk, sourceKey, index);
    if (customBlock) {
      return customBlock;
    }

    return {
      id: createBlockId(sourceKey, chunk, index),
      type: 'richtext',
      content: chunk,
      source: 'markdown-import',
      sourceChunkIndex: index,
    };
  });
}
