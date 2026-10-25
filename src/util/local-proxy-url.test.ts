const {
  normalizeLocalProxyScheme,
  resolveLocalProxyProtocol,
} = require('../../vendor/alexa-cookie2/lib/local-proxy-url');

describe('Alexa local authentication proxy protocol', () => {
  test('keeps an explicitly configured HTTP session on HTTP', () => {
    expect(resolveLocalProxyProtocol('http', 'https', true)).toBe('http');
  });

  test('keeps an explicitly configured HTTPS session on HTTPS', () => {
    expect(resolveLocalProxyProtocol('https', 'http', false)).toBe('https');
  });

  test('infers the protocol when it is not configured', () => {
    expect(resolveLocalProxyProtocol(undefined, 'https', false)).toBe('https');
    expect(resolveLocalProxyProtocol(undefined, undefined, false)).toBe('http');
  });
});

describe('Alexa local authentication proxy URL', () => {
  test('keeps an HTTP session on HTTP', () => {
    const callback =
      'https://192.168.100.203:9000/ax/claim?openid.return_to=https%3A%2F%2Fwww.amazon.com%2Fap%2Fmaplanding';

    expect(
      normalizeLocalProxyScheme(callback, '192.168.100.203', 9000, 'http'),
    ).toBe(
      'http://192.168.100.203:9000/ax/claim?openid.return_to=https%3A%2F%2Fwww.amazon.com%2Fap%2Fmaplanding',
    );
    expect(
      normalizeLocalProxyScheme(
        'http://192.168.100.203:9000/ax/claim',
        '192.168.100.203',
        9000,
        'http',
      ),
    ).toBe('http://192.168.100.203:9000/ax/claim');
  });

  test('keeps an HTTPS session on HTTPS', () => {
    expect(
      normalizeLocalProxyScheme(
        'http://192.168.100.203:9000/ax/claim',
        '192.168.100.203',
        9000,
        'https',
      ),
    ).toBe('https://192.168.100.203:9000/ax/claim');
  });

  test('normalizes an encoded local callback to the session protocol', () => {
    expect(
      normalizeLocalProxyScheme(
        'openid.return_to=https%3A%2F%2F192.168.100.203%3A9000%2Fax%2Fclaim',
        '192.168.100.203',
        9000,
        'http',
      ),
    ).toBe(
      'openid.return_to=http%3A%2F%2F192.168.100.203%3A9000%2Fax%2Fclaim',
    );
  });

  test('normalizes a JSON-escaped local callback to the session protocol', () => {
    expect(
      normalizeLocalProxyScheme(
        'https:\\/\\/192.168.100.203:9000\\/ax\\/claim',
        '192.168.100.203',
        9000,
        'http',
      ),
    ).toBe('http:\\/\\/192.168.100.203:9000\\/ax\\/claim');
  });

  test('does not change an Amazon HTTPS URL', () => {
    const url = 'https://www.amazon.com/ap/maplanding';

    expect(
      normalizeLocalProxyScheme(url, '192.168.100.203', 9000, 'http'),
    ).toBe(url);
  });

  test('supports a configured hostname', () => {
    expect(
      normalizeLocalProxyScheme(
        'https://homebridge.local:9000/ap/signin',
        'homebridge.local',
        9000,
        'http',
      ),
    ).toBe('http://homebridge.local:9000/ap/signin');
  });
});
