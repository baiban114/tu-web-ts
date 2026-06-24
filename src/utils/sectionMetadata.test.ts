import { describe, expect, it } from 'vitest'
import type { FlatTocEntry } from '@/utils/toc/headings'
import {
  buildSectionTagsByEntryId,
  collectSectionTagsFromMetadata,
  getSectionTagKey,
  getSectionTags,
  pruneOrphanSectionTags,
  setSectionTagsInMetadata,
} from './sectionMetadata'

describe('sectionMetadata', () => {
  const localEntry: FlatTocEntry = {
    id: 'h-10',
    blockId: 'hs-abc',
    level: 2,
    text: '第二节',
    pos: 10,
    sortIndex: 0,
    sourceType: 'local',
  }

  it('builds stable keys per source type', () => {
    expect(getSectionTagKey(localEntry)).toBe('local:hs-abc')
    expect(getSectionTagKey({
      ...localEntry,
      id: 'ref-group-b1',
      blockId: 'b1',
      sourceType: 'ref-group',
    })).toBe('ref-group:b1')
    expect(getSectionTagKey({
      ...localEntry,
      id: 'ref-child-b1-0',
      blockId: 'b1',
      sourceType: 'ref-child',
      contentTreeNodeId: 'ctn-1',
    })).toBe('ref-child:b1:ctn-1')
    expect(getSectionTagKey({
      ...localEntry,
      id: 'ref-child-b1-0',
      blockId: 'b1',
      sourceType: 'ref-child',
    })).toBe('ref-child-b1-0')
  })

  it('sets and reads section tags in metadata', () => {
    const metadata = setSectionTagsInMetadata({}, 'local:hs-abc', ['设计'])
    expect(getSectionTags(metadata, 'local:hs-abc')).toEqual([
      expect.objectContaining({ label: '设计' }),
    ])
  })

  it('removes empty section tag keys', () => {
    const withTag = setSectionTagsInMetadata({}, 'local:hs-abc', ['a'])
    const cleared = setSectionTagsInMetadata(withTag, 'local:hs-abc', [])
    expect(cleared.sectionTags).toBeUndefined()
  })

  it('collects all section tags from metadata', () => {
    let metadata: Record<string, unknown> = {}
    metadata = setSectionTagsInMetadata(metadata, 'local:a', ['x'])
    metadata = setSectionTagsInMetadata(metadata, 'ref-group:b', ['Y'])
    const collected = collectSectionTagsFromMetadata(metadata)
    expect(collected.map((tag) => tag.label).sort()).toEqual(['Y', 'x'])
  })

  it('prunes orphan section tag keys', () => {
    const metadata = setSectionTagsInMetadata(
      setSectionTagsInMetadata({}, 'local:keep', ['a']),
      'local:drop',
      ['b'],
    )
    const pruned = pruneOrphanSectionTags(metadata, ['local:keep'])
    expect(getSectionTags(pruned, 'local:keep')).toHaveLength(1)
    expect(getSectionTags(pruned, 'local:drop')).toHaveLength(0)
  })

  it('maps section tags by flat toc entry id', () => {
    const metadata = setSectionTagsInMetadata({}, 'local:hs-abc', ['节标签'])
    const byId = buildSectionTagsByEntryId([localEntry], metadata)
    expect(byId['h-10']).toEqual([
      expect.objectContaining({ label: '节标签' }),
    ])
  })
})
