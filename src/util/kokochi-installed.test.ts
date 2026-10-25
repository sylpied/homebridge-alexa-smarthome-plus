import fs from 'fs';
import os from 'os';
import path from 'path';
import { execFileSync } from 'child_process';

// eslint-disable-next-line @typescript-eslint/no-var-requires
const isKokochiInstalled = (root: string, _searchRoots: string[]) =>
  execFileSync(
    process.execPath,
    [
      '-e',
      'console.log(require(process.argv[1]).isKokochiInstalled(process.argv[2], []))',
      path.join(process.cwd(), 'integrations.js'),
      root,
    ],
    { encoding: 'utf8' },
  ).trim() === 'true';

test('uses installed package presence rather than saved configuration', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'alexa-integration-'));
  try {
    fs.writeFileSync(
      path.join(root, 'config.json'),
      JSON.stringify({ platforms: [{ platform: 'KokochiPilot' }] }),
    );
    expect(isKokochiInstalled(root, [])).toBe(false);
    const plugin = path.join(root, 'node_modules', 'homebridge-kokochi-pilot');
    fs.mkdirSync(plugin, { recursive: true });
    fs.writeFileSync(
      path.join(plugin, 'package.json'),
      JSON.stringify({ name: 'homebridge-kokochi-pilot', version: '0.0.0' }),
    );
    expect(isKokochiInstalled(root, [])).toBe(true);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});
