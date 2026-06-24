import type { BlockTag } from '@/api/types'
import { normalizeBlockTags, normalizeTagLabel } from '@/utils/blockMetadata'
import { mergeTagPools } from '@/utils/pageMetadata'
import type { FlatTocEntry } from '@/utils/toc/headings'

export type SectionTagsMap = Record<string, BlockTag[]>

function isSectionTagsMap(value: unknown): value is SectionTagsMap {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

/** Stable key for persisting tags on a TOC section entry. */
export function getSectionTagKey(entry: FlatTocEntry): string {
  if (entry.sourceType === 'local') {
    return `local:${entry.blockId}`
  }
  if (entry.sourceType === 'ref-group') {
    return `ref-group:${entry.blockId}`
  }
  if (entry.sourceType === 'ref-child') {
    if (entry.contentTreeNodeId) {
      return `ref-child:${entry.blockId}:${entry.contentTreeNodeId}`
    }
    return entry.id
  }
  return entry.id
}

export function getSectionTags(
  metadata: Record<string, unknown> | null | undefined,
  key: string,
): BlockTag[] {
  if (!metadata || !key) return []
  const raw = metadata.sectionTags
  if (!isSectionTagsMap(raw)) return []
  return normalizeBlockTags(raw[key])
}

export function setSectionTagsInMetadata(
  metadata: Record<string, unknown> | null | undefined,
  key: string,
  tags: Array<Partial<BlockTag> | string>,
): Record<string, unknown> {
  const next = { ...(metadata ?? {}) }
  const normalizedTags = normalizeBlockTags(tags)
  const existing = isSectionTagsMap(next.sectionTags)
    ? { ...next.sectionTags }
    : {} as SectionTagsMap

  if (normalizedTags.length > 0) {
    existing[key] = normalizedTags
  } else {
    delete existing[key]
  }

  if (Object.keys(existing).length > 0) {
    next.sectionTags = existing
  } else {
    delete next.sectionTags
  }

  return next
}

export function collectSectionTagsFromMetadata(
  metadata: Record<string, unknown> | null | undefined,
): BlockTag[] {
  if (!metadata) return []
  const raw = metadata.sectionTags
  if (!isSectionTagsMap(raw)) return []

  const pools: BlockTag[][] = []
  for (const tags of Object.values(raw)) {
    pools.push(normalizeBlockTags(tags))
  }
  return mergeTagPools(...pools)
}

export function pruneOrphanSectionTags(
  metadata: Record<string, unknown> | null | undefined,
  validKeys: Iterable<string>,
): Record<string, unknown> {
  const next = { ...(metadata ?? {}) }
  const raw = next.sectionTags
  if (!isSectionTagsMap(raw)) return next

  const valid = new Set(validKeys)
  const pruned: SectionTagsMap = {}
  for (const [key, tags] of Object.entries(raw)) {
    if (!valid.has(key)) continue
    const normalized = normalizeBlockTags(tags)
    if (normalized.length > 0) {
      pruned[key] = normalized
    }
  }

  if (Object.keys(pruned).length > 0) {
    next.sectionTags = pruned
  } else {
    delete next.sectionTags
  }

  return next
}

export function sectionTagsMapFromMetadata(
  metadata: Record<string, unknown> | null | undefined,
): SectionTagsMap {
  const raw = metadata?.sectionTags
  if (!isSectionTagsMap(raw)) return {}
  const result: SectionTagsMap = {}
  for (const [key, tags] of Object.entries(raw)) {
    const normalized = normalizeBlockTags(tags)
    if (normalized.length > 0) {
      result[key] = normalized
    }
  }
  return result
}

export function buildSectionTagsByEntryId(
  flat: FlatTocEntry[],
  metadata: Record<string, unknown> | null | undefined,
): Record<string, BlockTag[]> {
  const sectionTags = sectionTagsMapFromMetadata(metadata)
  const byEntryId: Record<string, BlockTag[]> = {}
  for (const entry of flat) {
    const key = getSectionTagKey(entry)
    const tags = sectionTags[key]
    if (tags?.length) {
      byEntryId[entry.id] = tags
    }
  }
  return byEntryId
}

export function collectSectionTagLabels(
  metadata: Record<string, unknown> | null | undefined,
): string[] {
  return collectSectionTagsFromMetadata(metadata).map((tag) => normalizeTagLabel(tag.label))
}
