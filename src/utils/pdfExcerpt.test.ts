import { describe, expect, it } from 'vitest'
import {
  normalizePdfPageRange,
  parsePdfExcerptComment,
  serializePdfExcerptComment,
} from './pdfExcerpt'

describe('pdfExcerpt serialization', () => {
  it('roundtrips comment attrs', () => {
    const attrs = {
      blockId: 'pe-test1',
      fileId: 'file-abc',
      fileName: 'book.pdf',
      startPage: 3,
      endPage: 7,
      height: 480,
    }
    const comment = serializePdfExcerptComment(attrs)
    const match = comment.match(/<!--tu:pdf-excerpt\s+([^>]+)-->/)
    expect(match).not.toBeNull()
    const parsed = parsePdfExcerptComment(match![1]!)
    expect(parsed).toEqual(attrs)
  })

  it('clamps page range to total pages', () => {
    expect(normalizePdfPageRange(0, 99, 10)).toEqual({ startPage: 1, endPage: 10 })
    expect(normalizePdfPageRange(8, 3, 10)).toEqual({ startPage: 8, endPage: 8 })
  })
})
