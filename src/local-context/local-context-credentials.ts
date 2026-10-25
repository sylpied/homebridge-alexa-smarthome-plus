import { randomBytes } from 'crypto';
import fs from 'fs';

export interface LocalContextCredentials {
  apiToken: string;
  eventToken: string;
}

export const loadOrCreateCredentials = (
  path: string | undefined,
  configuredApiToken?: string | null,
  configuredEventToken?: string | null,
): LocalContextCredentials => {
  if (configuredApiToken?.trim() && configuredEventToken?.trim()) {
    return {
      apiToken: configuredApiToken.trim(),
      eventToken: configuredEventToken.trim(),
    };
  }
  if (path) {
    try {
      const saved = JSON.parse(
        fs.readFileSync(path, 'utf8'),
      ) as Partial<LocalContextCredentials>;
      if (saved.apiToken && saved.eventToken) {
        return saved as LocalContextCredentials;
      }
    } catch {
      // Missing or invalid credential files are replaced atomically below.
    }
  }
  const credentials = {
    apiToken:
      configuredApiToken?.trim() || randomBytes(32).toString('base64url'),
    eventToken:
      configuredEventToken?.trim() || randomBytes(32).toString('base64url'),
  };
  if (path) {
    const temporaryPath = `${path}.${process.pid}.tmp`;
    try {
      fs.writeFileSync(temporaryPath, JSON.stringify(credentials), {
        mode: 0o600,
      });
      fs.renameSync(temporaryPath, path);
      fs.chmodSync(path, 0o600);
    } finally {
      fs.rmSync(temporaryPath, { force: true });
    }
  }
  return credentials;
};
