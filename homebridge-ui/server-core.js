const fs = require('node:fs');
const path = require('node:path');

const isAuthenticationFailure = (error) => {
  const message = error instanceof Error ? error.message : String(error || '');
  return /401 Unauthorized|Cookie invalid, Renew unsuccessful|authentication invalid|InvalidToken/i.test(
    message,
  );
};

const withTimeout = (promise, timeoutMs, message, onTimeout = () => {}) =>
  new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      onTimeout();
      reject(new Error(message));
    }, timeoutMs);

    promise.then(
      (value) => {
        clearTimeout(timer);
        resolve(value);
      },
      (error) => {
        clearTimeout(timer);
        reject(error);
      },
    );
  });

const writePrivateJson = (filePath, value) => {
  const directory = path.dirname(filePath);
  const temporaryPath = `${filePath}.${process.pid}.tmp`;
  fs.mkdirSync(directory, { recursive: true });
  try {
    fs.writeFileSync(temporaryPath, JSON.stringify(value), { mode: 0o600 });
    fs.renameSync(temporaryPath, filePath);
    fs.chmodSync(filePath, 0o600);
  } finally {
    fs.rmSync(temporaryPath, { force: true });
  }
};

module.exports = { isAuthenticationFailure, withTimeout, writePrivateJson };
