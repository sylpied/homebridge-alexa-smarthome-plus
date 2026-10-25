const path = require('node:path');
const { globalPaths, createRequire } = require('node:module');

const isKokochiInstalled = (
  storagePath,
  searchRoots = [
    path.dirname(__dirname),
    path.resolve(path.dirname(process.execPath), '../lib'),
    ...globalPaths,
  ],
) =>
  [storagePath, ...searchRoots].filter(Boolean).some((root) => {
    try {
      createRequire(
        path.join(root, '__homebridge_integration_check__.js'),
      ).resolve('homebridge-kokochi-pilot/package.json');
      return true;
    } catch {
      return false;
    }
  });

module.exports = { isKokochiInstalled };
