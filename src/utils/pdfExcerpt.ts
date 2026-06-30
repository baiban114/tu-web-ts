export const PDF_EXCERPT_COMMENT_RE = /<!--tu:pdf-excerpt\s+([^>]+)-->/
export const PDF_EXCERPT_DEFAULT_HEIGHT = 480
export const PDF_EXCERPT_MIN_HEIGHT = 160
export const PDF_EXCERPT_MAX_HEIGHT = 2000

function escapeAttr(value: string): string {
  return value.replace(/"/g, '&quot;')
}

function parseAttrString(attrsStr: string): Record<string, string> {
  const attrs: Record<string, string> = {}
  const re = /([\w-]+)="([^"]*)"/g
  let match: RegExpExecArray | null
  while ((match = re.exec(attrsStr)) !== null) {
    attrs[match[1]] = match[2]
  }
  return attrs
}

export function createPdfExcerptBlockId(): string {
  return `pe-${crypto.randomUUID().replace(/-/g, '')}`
}

export interface PdfExcerptAttrs {
  blockId: string
  fileId: string
  fileName: string
  startPage: number
  endPage: number
  height: number
}

export function parsePdfExcerptComment(attrsStr: string): PdfExcerptAttrs | null {
  const attrs = parseAttrString(attrsStr)
  const blockId = attrs.id
  const fileId = attrs.fileId
  if (!blockId || !fileId) return null
  const startPage = Math.max(1, Number(attrs.start) || 1)
  const endPage = Math.max(startPage, Number(attrs.end) || startPage)
  const height = Number(attrs.height) || PDF_EXCERPT_DEFAULT_HEIGHT
  return {
    blockId,
    fileId,
    fileName: attrs.fileName || '',
    startPage,
    endPage,
    height: Number.isFinite(height) && height > 0 ? height : PDF_EXCERPT_DEFAULT_HEIGHT,
  }
}

export function serializePdfExcerptComment(attrs: PdfExcerptAttrs): string {
  return `<!--tu:pdf-excerpt id="${escapeAttr(attrs.blockId)}" fileId="${escapeAttr(attrs.fileId)}" fileName="${escapeAttr(attrs.fileName)}" start="${attrs.startPage}" end="${attrs.endPage}" height="${attrs.height}"-->`
}

export function normalizePdfPageRange(
  startPage: number,
  endPage: number,
  totalPages: number,
): { startPage: number; endPage: number } {
  const safeTotal = Math.max(1, totalPages)
  const start = Math.min(Math.max(1, Math.floor(startPage)), safeTotal)
  const end = Math.min(Math.max(start, Math.floor(endPage)), safeTotal)
  return { startPage: start, endPage: end }
}
