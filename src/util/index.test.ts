import * as util from './index';

describe('validateConfig', () => {
  test('should return true given minimal config', () => {
    // given
    const config = {
      platform: 'AlexaSmartHomePlus',
      auth: {
        proxy: { clientHost: '127.0.0.1', port: 1111 },
      },
    };

    // when
    const actual = util.validateConfig(config);

    // then
    expect(actual).toBe(true);
  });

  test('should return true given full config', () => {
    // given
    const config = {
      platform: 'AlexaSmartHomePlus',
      amazonDomain: 'amazon.com',
      auth: {
        refreshInterval: 4,
        reauthenticateOnFailure: true,
        proxy: { clientHost: '127.0.0.1', port: 1111 },
      },
      language: 'en-US',
      devices: ['test'],
      deviceAliases: [
        { alexaName: 'test', homeKitName: 'Test HomeKit Device' },
      ],
      debug: true,
    };

    // when
    const actual = util.validateConfig(config);

    // then
    expect(actual).toBe(true);
  });

  test('should return false given invalid config', () => {
    // given
    const config = { platform: 'platform' };

    // when
    const actual = util.validateConfig(config);

    // then
    expect(actual).toBe(false);
  });
});

describe('isValidAuthentication', () => {
  test('should return true given valid cookie data', () => {
    // given
    const maybeCookieData = {
      loginCookie: 'some_login_cookie',
      frc: 'some_frc',
      'map-md': 'some_val',
      deviceId: '1',
      deviceAppName: 'ioBroker Alexa2',
      deviceSerial: 'abcd',
      refreshToken: 'a_refresh_token',
      tokenDate: 0,
      macDms: {
        device_private_key: 'test_private_key',
        adp_token: 'test_adp',
      },
      amazonPage: 'amazon.com',
      localCookie: 'session-id=123',
      csrf: '111',
    };

    // when
    const actual = util.isValidAuthentication(maybeCookieData);

    // then
    expect(actual).toBe(true);
  });

  test('should return false given empty', () => {
    // given
    const maybeCookieData = {};

    // when
    const actual = util.isValidAuthentication(maybeCookieData);

    // then
    expect(actual).toBe(false);
  });

  test('should return false given string', () => {
    // given
    const maybeCookieData = '';

    // when
    const actual = util.isValidAuthentication(maybeCookieData);

    // then
    expect(actual).toBe(false);
  });
});

describe('isAuthenticationFailure', () => {
  test.each([
    '401 Unauthorized',
    'Cookie invalid, Renew unsuccessful',
    'Authentication invalid',
    'Register App failed: InvalidToken',
  ])('returns true for an Alexa authentication failure: %s', (message) => {
    expect(util.isAuthenticationFailure(new Error(message))).toBe(true);
  });

  test.each(['connect ETIMEDOUT', 'getaddrinfo ENOTFOUND', 'socket hang up'])(
    'returns false for a network failure: %s',
    (message) => {
      expect(util.isAuthenticationFailure(new Error(message))).toBe(false);
    },
  );
});

describe('resolveHomeKitDeviceName', () => {
  test('uses the configured alias', () => {
    expect(
      util.resolveHomeKitDeviceName('Living Room', 'Living Room', [
        { alexaName: 'Living Room', homeKitName: 'Lounge' },
      ]),
    ).toBe('Lounge');
  });

  test('preserves generated sensor suffixes', () => {
    expect(
      util.resolveHomeKitDeviceName('Living Room', 'Living Room temperature', [
        { alexaName: 'Living Room', homeKitName: 'Lounge' },
      ]),
    ).toBe('Lounge temperature');
  });
});
