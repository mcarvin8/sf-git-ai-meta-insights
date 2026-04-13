import { describe, it, expect, beforeEach } from '@jest/globals';
import { resolveMetadataSummaryTeam } from '../../src/salesforce/metadataSummaryContext.js';

describe('resolveMetadataSummaryTeam', () => {
  beforeEach(() => {
    delete process.env.METADATA_AUDIT_TEAM;
    delete process.env.SF_GIT_AI_TEAM;
  });

  it('prefers the CLI team when provided', () => {
    expect(resolveMetadataSummaryTeam('  Platform  ')).toBe('Platform');
  });

  it('uses METADATA_AUDIT_TEAM when the CLI team is unset', () => {
    process.env.METADATA_AUDIT_TEAM = '  CI Team  ';
    expect(resolveMetadataSummaryTeam(undefined)).toBe('CI Team');
  });

  it('falls back to SF_GIT_AI_TEAM when other sources are unset', () => {
    process.env.SF_GIT_AI_TEAM = '  Other  ';
    expect(resolveMetadataSummaryTeam(undefined)).toBe('Other');
  });

  it('prefers METADATA_AUDIT_TEAM over SF_GIT_AI_TEAM', () => {
    process.env.METADATA_AUDIT_TEAM = 'Audit';
    process.env.SF_GIT_AI_TEAM = 'Other';
    expect(resolveMetadataSummaryTeam(undefined)).toBe('Audit');
  });

  it('returns undefined when no team is configured', () => {
    expect(resolveMetadataSummaryTeam(undefined)).toBeUndefined();
  });
});
