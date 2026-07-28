/** @type {import('ts-jest').JestConfigWithTsJest} */
module.exports = {
  preset: 'ts-jest',
  testEnvironment: 'node',
  roots: ['<rootDir>/src'],
  setupFiles: ['dotenv/config'],
  setupFilesAfterEnv: ['<rootDir>/__tests__/test-setup.ts'],
  testMatch: ['**/?(*.)+(spec|test).ts?(x)'],
};
