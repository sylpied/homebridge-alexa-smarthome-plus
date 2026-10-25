import * as E from 'fp-ts/Either';
import * as O from 'fp-ts/Option';
import * as TE from 'fp-ts/TaskEither';
import * as hapNodeJs from '@homebridge/hap-nodejs';
import fs from 'fs';
import type { API } from 'homebridge';
import os from 'os';
import path from 'path';
import { ValidationError } from './domain/homebridge/errors';
import { AlexaSmartHomePlatform } from './platform';

test('should not initialize devices with invalid ids', async () => {
  // given
  const platform = getPlatform();
  const device = global.createSmartHomeDevice({
    id: '123',
    displayName: 'test light',
    supportedOperations: ['turnOff', 'turnOn', 'setBrightness'],
    deviceType: 'LIGHT',
  });

  // when
  const actual = platform.initAccessories(device)();

  // then
  expect(actual).toStrictEqual(
    E.left(
      new ValidationError("id: '123' is not a valid Smart Home device id"),
    ),
  );
});

test('filters duplicate device names by Alexa endpoint id', async () => {
  const config = global.createPlatformConfig();
  config.deviceFilterMode = 'include';
  config.devices = ['Same name'];
  config.deviceIds = ['22222222-2222-2222-2222-222222222222'];
  const platform = new AlexaSmartHomePlatform(
    global.MockLogger,
    config,
    getApi(),
  );
  const devices = [
    global.createSmartHomeDevice({
      id: '11111111-1111-1111-1111-111111111111',
      displayName: 'Same name',
    }),
    global.createSmartHomeDevice({
      id: '22222222-2222-2222-2222-222222222222',
      displayName: 'Same name',
    }),
  ];
  Object.defineProperty(platform, 'alexaApi', {
    value: { getDevices: () => TE.right(devices) },
  });

  const result = await platform.findDevices()();

  expect(result).toStrictEqual(E.right([devices[1]]));
});

test('does not start Alexa browser authentication when stored authentication is missing', () => {
  const persistPath = fs.mkdtempSync(
    path.join(os.tmpdir(), 'alexa-plus-platform-'),
  );
  try {
    const platform = new AlexaSmartHomePlatform(
      global.MockLogger,
      global.createPlatformConfig(),
      getApi(persistPath),
    );
    const init = jest.fn();
    Object.defineProperty(platform, 'alexaRemote', {
      value: { init, on: jest.fn(), stop: jest.fn() },
    });

    let result: O.Option<Error> = O.none;
    platform.initAlexaRemote((error) => {
      result = error;
    });

    expect(init).not.toHaveBeenCalled();
    expect(O.isSome(result)).toBe(true);
    if (O.isSome(result)) {
      expect(result.value.message).toContain('authentication is required');
    }
  } finally {
    fs.rmSync(persistPath, { recursive: true, force: true });
  }
});

test('removes rejected stored authentication without starting a second authentication attempt', () => {
  const persistPath = fs.mkdtempSync(
    path.join(os.tmpdir(), 'alexa-plus-platform-'),
  );
  const authenticationPath = path.join(
    persistPath,
    '.homebridge-alexa-smarthome-plus',
  );
  fs.writeFileSync(
    authenticationPath,
    JSON.stringify({
      cookieData: {
        localCookie: 'csrf=test;',
        refreshToken: 'refresh',
        macDms: {
          device_private_key: 'key',
          adp_token: 'token',
        },
        amazonPage: 'amazon.co.jp',
        tokenDate: Date.now(),
      },
    }),
  );

  try {
    const platform = new AlexaSmartHomePlatform(
      global.MockLogger,
      global.createPlatformConfig(),
      getApi(persistPath),
    );
    const rejected = new Error('Cookie invalid, Renew unsuccessful');
    const init = jest.fn((_options, callback) => callback(rejected));
    Object.defineProperty(platform, 'alexaRemote', {
      value: { init, on: jest.fn(), stop: jest.fn() },
    });

    let result: O.Option<Error> = O.none;
    platform.initAlexaRemote((error) => {
      result = error;
    });

    expect(init).toHaveBeenCalledTimes(1);
    expect(fs.existsSync(authenticationPath)).toBe(false);
    expect(result).toStrictEqual(O.some(rejected));
  } finally {
    fs.rmSync(persistPath, { recursive: true, force: true });
  }
});

test('resumes once after authentication is saved and stops watching at shutdown', async () => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'alexa-resume-'));
  const events: Record<string, () => void> = {};
  let changed: () => void = () => undefined;
  const watch = jest.spyOn(fs, 'watchFile').mockImplementation(((
    _path: unknown,
    _options: unknown,
    listener: () => void,
  ) => {
    changed = listener;
  }) as typeof fs.watchFile);
  const unwatch = jest
    .spyOn(fs, 'unwatchFile')
    .mockImplementation(() => undefined);
  try {
    const api = getApi(directory);
    api.on = ((name: string, listener: () => void) => {
      events[name] = listener;
      return api;
    }) as API['on'];
    const platform = new AlexaSmartHomePlatform(
      global.MockLogger,
      global.createPlatformConfig(),
      api,
    );
    const init = jest.fn((_options, callback) => callback(null));
    const on = jest.fn();
    Object.defineProperty(platform, 'alexaRemote', {
      value: { init, on, stop: jest.fn() },
    });
    const find = jest
      .spyOn(platform, 'findDevices')
      .mockReturnValue(TE.left(new Error('bounded discovery stop') as never));
    events.didFinishLaunching();
    expect(init).not.toHaveBeenCalled();
    expect(find).not.toHaveBeenCalled();
    fs.writeFileSync(
      path.join(directory, '.homebridge-alexa-smarthome-plus'),
      JSON.stringify({
        cookieData: {
          localCookie: 'csrf=test;',
          refreshToken: 'test',
          macDms: { device_private_key: 'test', adp_token: 'test' },
          amazonPage: 'amazon.co.jp',
          tokenDate: Date.now(),
        },
      }),
    );
    changed();
    changed();
    await Promise.resolve();
    expect(init).toHaveBeenCalledTimes(1);
    expect(init.mock.calls[0][0].allowInteractiveLogin).toBe(false);
    expect(on).toHaveBeenCalledTimes(1);
    events.shutdown();
    expect(unwatch).toHaveBeenCalled();
    changed();
    expect(init).toHaveBeenCalledTimes(1);
  } finally {
    watch.mockRestore();
    unwatch.mockRestore();
    fs.rmSync(directory, { recursive: true, force: true });
  }
});

function getPlatform(): AlexaSmartHomePlatform {
  return new AlexaSmartHomePlatform(
    global.MockLogger,
    global.createPlatformConfig(),
    getApi(),
  );
}

function getApi(persistPath = '.'): API {
  return {
    hap: {
      Service: hapNodeJs.Service,
      Characteristic: hapNodeJs.Characteristic,
    },
    on: () => ({}),
    user: { persistPath: () => persistPath },
  } as unknown as API;
}
