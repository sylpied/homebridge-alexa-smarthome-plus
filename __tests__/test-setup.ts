/* eslint-disable no-var */
import { constant } from 'fp-ts/lib/function';
import { HomebridgeAPI } from 'homebridge/lib/api';
import { Logger } from 'homebridge/lib/logger';
import { AlexaPlatformConfig } from '../src/domain/homebridge';
import { AlexaSmartHomePlatform } from '../src/platform';
import { SmartHomeDevice } from '../src/domain/alexa/get-devices';
import DeviceStore from '../src/store/device-store';

jest.mock('homebridge/lib/logger', () => ({
  Logger: jest.fn().mockImplementation(() => ({
    log: jest.fn(),
    debug: jest.fn(),
    info: jest.fn(),
    warn: jest.fn(),
    error: jest.fn(),
    errorT: jest.fn(),
  })),
}));

afterEach(() => {
  jest.clearAllMocks();
});

global.MockLogger = new Logger();

global.TEST_UUID = 'd3588548-bbbb-4c95-b60d-57fea062ca5b';

global.createPlatform = (): AlexaSmartHomePlatform => {
  const api = new HomebridgeAPI();
  api.hap.uuid.generate = constant(TEST_UUID);
  const config = global.createPlatformConfig();
  const platform = new AlexaSmartHomePlatform(
    global.MockLogger,
    config,
    api,
  );
  if (!(platform as any).deviceStore) {
    (platform as any).deviceStore = new DeviceStore(config.performance);
  }
  return platform;
};

global.createPlatformConfig = (): AlexaPlatformConfig => ({
  platform: 'AlexaSmartHomePlus',
  uiLanguage: 'auto',
  deviceFilterMode: 'all',
  devices: [],
  excludeDevices: [],
  deviceAliases: [],
  routines: {
    names: [],
    executionDevice: undefined,
    resetDelayMs: 500,
  },
  amazonDomain: 'amazon.com',
  language: 'en-US',
  auth: {
    refreshInterval: 0,
    reauthenticateOnFailure: true,
    proxy: {
      clientHost: 'localhost',
      port: 2345,
    },
  },
  performance: {
    cacheTTL: 30,
  },
  disabledOperations: [],
  debug: true,
});

global.createSmartHomeDevice = (
  overrides: Partial<SmartHomeDevice> = {},
): SmartHomeDevice => ({
  id: 'entity:test-device',
  endpointId: 'endpoint:test-device',
  displayName: 'Test device',
  supportedOperations: ['turnOn', 'turnOff'],
  enabled: true,
  deviceType: 'SWITCH',
  serialNumber: 'TEST-SERIAL',
  model: 'Test Model',
  manufacturer: 'Test Manufacturer',
  ...overrides,
});

declare global {
  var MockLogger: Logger;
  var TEST_UUID: string;
  var createPlatform: () => AlexaSmartHomePlatform;
  var createPlatformConfig: () => AlexaPlatformConfig;
  var createSmartHomeDevice: (
    overrides?: Partial<SmartHomeDevice>,
  ) => SmartHomeDevice;
}
