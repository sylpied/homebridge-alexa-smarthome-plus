import fs from 'fs';
import path from 'path';

const app = fs.readFileSync(
  path.join(process.cwd(), 'homebridge-ui/public/app.js'),
  'utf8',
);

test('uses the Mitsubishi token generation, copy and regeneration controls', () => {
  expect(app).toContain('crypto.getRandomValues(bytes)');
  expect(app).toContain('copy-context-token');
  expect(app).toContain('regenerate-context-token');
  expect(app).toContain('navigator.clipboard.writeText');
  expect(app).toContain('ensureContextTokens');
});

test('keeps API and event tokens as separate settings', () => {
  expect(app).toContain("'apiToken'");
  expect(app).toContain("'eventToken'");
  expect(app).toContain('context-api-token');
  expect(app).toContain('context-event-token');
});
