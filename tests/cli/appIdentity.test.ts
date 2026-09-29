import { describe, expect, it } from 'vitest';
import { normalizeOrigin } from '../../src/cli/cloud/appIdentity.js';

describe('normalizeOrigin (R28: one App-Id per repo)', () => {
  it('collapses ssh, https and dirty forms of the same repo to one host/owner/repo', () => {
    const canonical = 'github.com/team/app';
    expect(normalizeOrigin('git@github.com:team/app.git')).toBe(canonical);
    expect(normalizeOrigin('https://github.com/team/app')).toBe(canonical);
    expect(normalizeOrigin('https://github.com/team/app.git/')).toBe(canonical);
    expect(normalizeOrigin('ssh://git@github.com:22/team/app.git')).toBe(canonical);
    expect(normalizeOrigin('https://user:token@github.com:443/team/app.git')).toBe(canonical);
  });

  it('lower-cases the host but keeps path case (owner/repo is significant on GitLab)', () => {
    expect(normalizeOrigin('https://GitHub.com/team/app')).toBe('github.com/team/app');
    expect(normalizeOrigin('git@gitlab.com:Team/App.git')).toBe('gitlab.com/Team/App');
  });

  it('handles a self-hosted host with a port', () => {
    expect(normalizeOrigin('https://git.internal:8443/group/sub/repo.git')).toBe('git.internal/group/sub/repo');
  });
});
