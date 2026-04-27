import type { Block } from '@/api/types';

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
  return title || '导入的 Markdown';
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

  return chunks.map((chunk, index) => ({
    id: createBlockId(sourceKey, chunk, index),
    type: 'richtext',
    content: chunk,
    source: 'markdown-import',
    sourceChunkIndex: index,
  }));
}

