import { describe, it, expect } from 'vitest';
import { makeFilename, parseMetadata, extractSummary } from '../agents/lib/base-agent.js';

describe('makeFilename', () => {
  it('creates a slugified filename with date, type, and topic', () => {
    const filename = makeFilename('research', 'AI Agent Frameworks 2026');
    const date = new Date().toISOString().slice(0, 10);
    expect(filename).toBe(`${date}-research-ai-agent-frameworks-2026.md`);
  });

  it('strips special characters from topic', () => {
    const filename = makeFilename('critic', 'Should we build a SaaS? (Yes/No)');
    expect(filename).toMatch(/^[\d-]+-critic-should-we-build-a-saas-yesno\.md$/);
  });

  it('truncates long topics to 60 chars', () => {
    const longTopic = 'a'.repeat(100);
    const filename = makeFilename('analyst', longTopic);
    const slug = filename.replace(/^\d{4}-\d{2}-\d{2}-analyst-/, '').replace('.md', '');
    expect(slug.length).toBeLessThanOrEqual(60);
  });

  it('handles empty topic', () => {
    const filename = makeFilename('discovery', '');
    const date = new Date().toISOString().slice(0, 10);
    expect(filename).toBe(`${date}-discovery-.md`);
  });

  it('converts to lowercase', () => {
    const filename = makeFilename('cto', 'Fix TypeScript Errors');
    expect(filename).toMatch(/fix-typescript-errors/);
  });
});

describe('parseMetadata', () => {
  it('parses json-metadata block', () => {
    const content = `Some report text

\`\`\`json-metadata
{
  "total_sources": 15,
  "research_type": "tech",
  "topic": "MCP servers"
}
\`\`\``;
    const meta = parseMetadata(content);
    expect(meta).toEqual({
      total_sources: 15,
      research_type: 'tech',
      topic: 'MCP servers',
    });
  });

  it('parses json block with total_sources', () => {
    const content = `Report text

\`\`\`json
{
  "total_sources": 8,
  "extracted_pages": 3
}
\`\`\``;
    const meta = parseMetadata(content);
    expect(meta).toEqual({
      total_sources: 8,
      extracted_pages: 3,
    });
  });

  it('returns empty object for no metadata', () => {
    const meta = parseMetadata('Just a plain report with no metadata.');
    expect(meta).toEqual({});
  });

  it('returns empty object for malformed JSON', () => {
    const content = `\`\`\`json-metadata
{ this is not valid json }
\`\`\``;
    const meta = parseMetadata(content);
    expect(meta).toEqual({});
  });

  it('returns first matching metadata block', () => {
    const content = `\`\`\`json-metadata
{"total_sources": 5}
\`\`\`

\`\`\`json-metadata
{"total_sources": 10}
\`\`\``;
    const meta = parseMetadata(content);
    expect(meta).toEqual({ total_sources: 5 });
  });
});

describe('extractSummary', () => {
  it('extracts Executive Summary section', () => {
    const content = `# Report

## Executive Summary
This is the executive summary with important findings.

## Details
More stuff here.`;
    const summary = extractSummary(content);
    expect(summary).toBe('This is the executive summary with important findings.');
  });

  it('extracts Summary section (case-insensitive)', () => {
    const content = `## summary
Key takeaway from this analysis.

## Next Steps
Do something.`;
    const summary = extractSummary(content);
    expect(summary).toBe('Key takeaway from this analysis.');
  });

  it('extracts TL;DR section', () => {
    const content = `## TL;DR
Short version of the report.

## Full Report
Long text.`;
    const summary = extractSummary(content);
    expect(summary).toBe('Short version of the report.');
  });

  it('falls back to first paragraph >50 chars', () => {
    const content = `Short intro.

This is a longer paragraph that contains more than fifty characters and should be used as the summary when no explicit summary section exists.

Another paragraph.`;
    const summary = extractSummary(content);
    expect(summary).toContain('This is a longer paragraph');
  });

  it('truncates to maxLength', () => {
    const longSummary = `## Executive Summary
${'A'.repeat(600)}

## Details`;
    const summary = extractSummary(longSummary, 100);
    expect(summary.length).toBeLessThanOrEqual(100);
  });

  it('handles content with no paragraphs >50 chars', () => {
    const content = 'Short.';
    const summary = extractSummary(content);
    expect(summary).toBe('Short.');
  });
});
