import { detectMatterCapability } from './capability';

test('detects light capabilities from Alexa operations', () => {
  expect(
    detectMatterCapability(
      global.createSmartHomeDevice({
        deviceType: 'LIGHT',
        supportedOperations: [
          'turnOn',
          'turnOff',
          'setBrightness',
          'setColorTemperature',
        ],
      }),
    ),
  ).toStrictEqual({
    kind: 'light',
    brightness: true,
    color: false,
    colorTemperature: true,
  });
});

test('detects locks and outlets', () => {
  expect(
    detectMatterCapability(
      global.createSmartHomeDevice({
        deviceType: 'SMARTLOCK',
        supportedOperations: ['lock', 'unlock'],
      }),
    )?.kind,
  ).toBe('lock');
  expect(
    detectMatterCapability(
      global.createSmartHomeDevice({ deviceType: 'SMARTPLUG' }),
    )?.kind,
  ).toBe('outlet');
});

test('falls back unknown Alexa categories with power controls to a switch', () => {
  expect(
    detectMatterCapability(
      global.createSmartHomeDevice({ deviceType: 'COFFEE_MAKER' }),
    )?.kind,
  ).toBe('switch');
});

test('does not expose devices without a safe writable mapping', () => {
  expect(
    detectMatterCapability(
      global.createSmartHomeDevice({
        deviceType: 'CAMERA',
        supportedOperations: [],
      }),
    ),
  ).toBeUndefined();
});
