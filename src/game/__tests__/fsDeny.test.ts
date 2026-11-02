// The dev server's fs.deny (server/fsDeny.ts) through Vite's own check: isFileServingAllowed is what the static server asks
// before it sends a file. The config is resolved without vite.config.ts and without any .env file (envFile: false), so no
// secret is read here.
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { isFileServingAllowed, resolveConfig } from 'vite';
import { FS_DENY } from '../../../server/fsDeny.ts';

const root = fileURLToPath(new URL('../../../', import.meta.url)).replace(/\\/g, '/').replace(/\/$/, '');

async function servedBy(deny: string[]) {
  const config = await resolveConfig(
    { configFile: false, envFile: false, root, logLevel: 'silent', server: { fs: { deny } } },
    'serve',
  );
  // a served file is an absolute path under the root, as the static server computes it
  return (url: string) => isFileServingAllowed(config, `${root}${url}`);
}

describe('fs.deny: this project\'s folders are not served', () => {
  it('refuses the usage counts, the speech cache and the kept audio', async () => {
    const served = await servedBy(FS_DENY);
    expect(served('/.usage/usage.json')).toBe(false);
    expect(served('/.usage/usage.json.bad-1700000000000')).toBe(false);
    expect(served('/.tts-cache/test.txt')).toBe(false);
    expect(served('/.tts-cache/deep/0a1b.mp3')).toBe(false);
    expect(served('/.tts-keep/voice.wav')).toBe(false);
  });

  it('refuses the Claude Code folder and any log file, wherever it is', async () => {
    const served = await servedBy(FS_DENY);
    expect(served('/.claude/settings.local.json')).toBe(false);
    expect(served('/.claude/projects/x/memory/MEMORY.md')).toBe(false);
    expect(served('/debug.log')).toBe(false);
    expect(served('/server/logs/tts-2026-10-28.log')).toBe(false);
    expect(served('/src/logger.ts')).toBe(true);
  });

  it('keeps Vite\'s defaults: env files, keys and the git folder stay refused', async () => {
    const served = await servedBy(FS_DENY);
    expect(served('/.env')).toBe(false);
    expect(served('/.env.local')).toBe(false);
    expect(served('/.env.example')).toBe(false);
    expect(served('/server.key')).toBe(false);
    expect(served('/.npmrc')).toBe(false);
    expect(served('/.git/config')).toBe(false);
  });

  it('still serves the app source and the package file', async () => {
    const served = await servedBy(FS_DENY);
    expect(served('/src/main.tsx')).toBe(true);
    expect(served('/package.json')).toBe(true);
    expect(served('/public/favicon.svg')).toBe(true);
  });

  it('the old pattern (".usage/**" without the leading "**/") does not refuse the folder: why the list changed', async () => {
    const old = await servedBy(['.env', '.env.*', '**/.git/**', '.usage/**', '.tts-cache/**']);
    expect(old('/.usage/usage.json')).toBe(true);
    expect(old('/.tts-cache/test.txt')).toBe(true);
  });
});
