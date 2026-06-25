import { describe, expect, it } from 'vitest';
import {
  anchorLabel,
  annotationAnchor,
  pageAnchor,
  parseLocator,
  resourceExcerptAnchor,
} from './knowledgeAnchor';

describe('knowledgeAnchor', () => {
  it('builds page locator', () => {
    expect(pageAnchor('p1', 'Hello').locator).toBe('page:p1');
    expect(pageAnchor('p1', 'Hello').snapshot?.title).toBe('Hello');
  });

  it('parses resource excerpt locator', () => {
    const parsed = parseLocator('resource:item1:excerpt:ex1');
    expect(parsed.kind).toBe('resourceExcerpt');
    expect(parsed.resourceItemId).toBe('item1');
    expect(parsed.excerptId).toBe('ex1');
  });

  it('uses snapshot title for label', () => {
    expect(anchorLabel(annotationAnchor('p1', 'a1', '选中文本'))).toBe('选中文本');
  });

  it('builds excerpt anchor', () => {
    expect(resourceExcerptAnchor('i1', 'e1').locator).toBe('resource:i1:excerpt:e1');
  });

  it('parses selection locator', () => {
    const parsed = parseLocator('page:p1:selection:12:34');
    expect(parsed.kind).toBe('annotation');
    expect(parsed.pageId).toBe('p1');
    expect(parsed.from).toBe(12);
    expect(parsed.to).toBe(34);
  });
});
