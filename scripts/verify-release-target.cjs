#!/usr/bin/env node

const { execFileSync } = require('node:child_process');
const packageJson = require('../package.json');

const EXPECTED_REPOSITORY = 'sylpied/homebridge-alexa-smarthome-plus';
const EXPECTED_PACKAGE = 'homebridge-alexa-smarthome-plus';
const EXPECTED_PACKAGE_REPOSITORY =
  `git+https://github.com/${EXPECTED_REPOSITORY}.git`;
const EXPECTED_HOMEPAGE =
  `https://github.com/${EXPECTED_REPOSITORY}#readme`;
const EXPECTED_BUGS_URL =
  `https://github.com/${EXPECTED_REPOSITORY}/issues`;
const ALLOWED_REMOTE_URLS = new Set([
  `https://github.com/${EXPECTED_REPOSITORY}.git`,
  `https://github.com/${EXPECTED_REPOSITORY}`,
  `git@github.com:${EXPECTED_REPOSITORY}.git`,
  `ssh://git@github.com/${EXPECTED_REPOSITORY}.git`,
]);

function git(...args) {
  try {
    return execFileSync('git', args, {
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'pipe'],
    }).trim();
  } catch (error) {
    const detail = error.stderr?.trim() || error.message;
    throw new Error(`git ${args.join(' ')} failed: ${detail}`);
  }
}

function optionalGit(...args) {
  try {
    return git(...args);
  } catch {
    return '';
  }
}

function fail(message) {
  console.error(`Release target safety check failed: ${message}`);
  process.exit(1);
}

if (packageJson.name !== EXPECTED_PACKAGE) {
  fail(`package name is "${packageJson.name}", expected "${EXPECTED_PACKAGE}".`);
}

const repositoryUrl =
  typeof packageJson.repository === 'string'
    ? packageJson.repository
    : packageJson.repository?.url;
if (repositoryUrl !== EXPECTED_PACKAGE_REPOSITORY) {
  fail(`package repository is "${repositoryUrl || 'missing'}".`);
}
if (packageJson.homepage !== EXPECTED_HOMEPAGE) {
  fail(`package homepage is "${packageJson.homepage || 'missing'}".`);
}
if (packageJson.bugs?.url !== EXPECTED_BUGS_URL) {
  fail(`package bugs URL is "${packageJson.bugs?.url || 'missing'}".`);
}

const originUrl = optionalGit('remote', 'get-url', '--push', 'origin');
if (!ALLOWED_REMOTE_URLS.has(originUrl)) {
  fail(`origin push URL "${originUrl || 'missing'}" is not allowed.`);
}

const currentBranch = optionalGit('branch', '--show-current');
if (currentBranch) {
  const trackingRemote = optionalGit(
    'config',
    '--get',
    `branch.${currentBranch}.remote`,
  );
  if (trackingRemote && trackingRemote !== 'origin') {
    fail(
      `branch "${currentBranch}" tracks "${trackingRemote}" instead of "origin".`,
    );
  }
}

const upstreamUrl = optionalGit('remote', 'get-url', 'upstream');
if (upstreamUrl) {
  const upstreamPushUrl = optionalGit(
    'remote',
    'get-url',
    '--push',
    'upstream',
  );
  if (upstreamPushUrl !== 'DISABLED') {
    fail('upstream exists but is not configured as fetch-only.');
  }
}

if (process.argv[2] === '--push') {
  const remoteName = process.argv[3] || '';
  const remoteUrl = process.argv[4] || '';
  if (remoteName !== 'origin') {
    fail(`push remote "${remoteName || 'missing'}" is not allowed.`);
  }
  if (!ALLOWED_REMOTE_URLS.has(remoteUrl)) {
    fail(`push destination "${remoteUrl || 'missing'}" is not allowed.`);
  }
}

console.log(`Release target verified: ${EXPECTED_REPOSITORY}`);
