import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const { withTimeout, writePrivateJson } = require('./server-core');

describe('settings server core', () => {
  test('rejects an operation that exceeds its timeout and runs cleanup', async () => {
    const cleanup = jest.fn();
    const pending = new Promise(() => undefined);

    await expect(withTimeout(pending, 5, 'timed out', cleanup)).rejects.toThrow(
      'timed out',
    );
    expect(cleanup).toHaveBeenCalledTimes(1);
  });

  test('writes authentication JSON with owner-only permissions', () => {
    const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'asmp-auth-'));
    const filePath = path.join(directory, 'authentication.json');

    try {
      writePrivateJson(filePath, { cookieData: { token: 'secret' } });

      expect(JSON.parse(fs.readFileSync(filePath, 'utf8'))).toEqual({
        cookieData: { token: 'secret' },
      });
      expect(fs.statSync(filePath).mode & 0o777).toBe(0o600);
    } finally {
      fs.rmSync(directory, { recursive: true, force: true });
    }
  });
});
