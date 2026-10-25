import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const {
  isAuthenticationFailure,
  withTimeout,
  writePrivateJson,
} = require('./server-core');

describe('settings server core', () => {
  test.each([
    '401 Unauthorized',
    'Cookie invalid, Renew unsuccessful',
    'Authentication invalid',
    'Register App failed: InvalidToken',
  ])('recognizes an Alexa authentication failure: %s', (message) => {
    expect(isAuthenticationFailure(new Error(message))).toBe(true);
  });

  test.each(['connect ETIMEDOUT', 'getaddrinfo ENOTFOUND', 'socket hang up'])(
    'does not treat a network failure as expired authentication: %s',
    (message) => {
      expect(isAuthenticationFailure(new Error(message))).toBe(false);
    },
  );

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
