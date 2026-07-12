import * as E from 'fp-ts/Either';
import AlexaRemote from 'alexa-remote2';
import { HttpError, RequestUnsuccessful } from '../domain/alexa/errors';
import DeviceStore from '../store/device-store';
import { AlexaApiWrapper } from './alexa-api-wrapper';

const createWrapper = () => {
  const platform = global.createPlatform();
  const remote = new AlexaRemote();
  const wrapper = new AlexaApiWrapper(
    platform.Service,
    remote,
    platform.log,
    new DeviceStore({ cacheTTL: 30 }),
  );
  return { wrapper, remote };
};

describe('AlexaApiWrapper.setDeviceState', () => {
  test('sets a smart-home action successfully', async () => {
    const { wrapper, remote } = createWrapper();
    jest
      .spyOn(remote, 'executeSmarthomeDeviceAction')
      .mockImplementation((_id, _params, _type, callback) =>
        callback(undefined, { controlResponses: [{ code: 'SUCCESS' }] }),
      );

    await expect(wrapper.setDeviceState('device', 'turnOn')()).resolves.toEqual(
      E.right(undefined),
    );
  });

  test('maps transport failures to HttpError', async () => {
    const { wrapper, remote } = createWrapper();
    jest
      .spyOn(remote, 'executeSmarthomeDeviceAction')
      .mockImplementation((_id, _params, _type, callback) =>
        callback(new Error('offline')),
      );

    const result = await wrapper.setDeviceState('device', 'turnOff')();
    expect(E.isLeft(result)).toBe(true);
    if (E.isLeft(result)) expect(result.left).toBeInstanceOf(HttpError);
  });

  test('rejects unsuccessful Alexa responses', async () => {
    const { wrapper, remote } = createWrapper();
    jest
      .spyOn(remote, 'executeSmarthomeDeviceAction')
      .mockImplementation((_id, _params, _type, callback) =>
        callback(undefined, { errors: [{ code: 'DENIED' }] }),
      );

    const result = await wrapper.setDeviceState('device', 'turnOff')();
    expect(E.isLeft(result)).toBe(true);
    if (E.isLeft(result)) {
      expect(result.left).toBeInstanceOf(RequestUnsuccessful);
    }
  });
});
