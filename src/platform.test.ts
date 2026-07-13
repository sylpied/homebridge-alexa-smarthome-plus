import * as E from 'fp-ts/Either';
import * as TE from 'fp-ts/TaskEither';
import * as hapNodeJs from 'hap-nodejs';
import type { API } from 'homebridge';
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

function getPlatform(): AlexaSmartHomePlatform {
  return new AlexaSmartHomePlatform(
    global.MockLogger,
    global.createPlatformConfig(),
    getApi(),
  );
}

function getApi(): API {
  return {
    hap: {
      Service: hapNodeJs.Service,
      Characteristic: hapNodeJs.Characteristic,
    },
    on: () => ({}),
    user: { persistPath: () => '.' },
  } as unknown as API;
}
