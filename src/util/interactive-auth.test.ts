const cookie = require('../../vendor/alexa-cookie2/alexa-cookie');

test('non-interactive cookie recovery returns an authentication error without starting a proxy', () => {
  const callback = jest.fn();
  cookie.generateAlexaCookie(undefined, undefined, { allowInteractiveLogin: false }, callback);
  expect(callback).toHaveBeenCalledTimes(1);
  expect(callback.mock.calls[0][0].message).toContain('authentication invalid');
});
