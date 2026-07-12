import * as E from 'fp-ts/Either';
import * as TE from 'fp-ts/TaskEither';
import { HttpError } from '../domain/alexa/errors';
import LightAccessory from './light-accessory';

const createAccessory = () => {
  const platform = global.createPlatform();
  const device = global.createSmartHomeDevice({
    id: 'entity:light',
    endpointId: 'endpoint:light',
    displayName: 'test light',
    deviceType: 'LIGHT',
    supportedOperations: ['turnOn', 'turnOff', 'setBrightness'],
  });
  const alexaApi = {
    getDeviceStateGraphQl: jest.fn(),
    setDeviceStateGraphQl: jest.fn(),
  };
  (platform as any).alexaApi = alexaApi;
  const platAcc = new platform.api.platformAccessory(
    device.displayName,
    global.TEST_UUID,
  );
  const accessory = new LightAccessory(platform, device, platAcc);
  accessory.configureServices();
  return { accessory, alexaApi };
};

describe('LightAccessory power', () => {
  test('reads the current power state', async () => {
    const { accessory, alexaApi } = createAccessory();
    alexaApi.getDeviceStateGraphQl.mockReturnValue(
      TE.right([false, [{ featureName: 'power', value: 'ON' }]]),
    );

    await expect(accessory.handlePowerGet()).resolves.toBe(true);
  });

  test('writes power and updates the cache', async () => {
    const { accessory, alexaApi } = createAccessory();
    alexaApi.setDeviceStateGraphQl.mockReturnValue(TE.right(undefined));

    await expect(accessory.handlePowerSet(true)).resolves.toBeUndefined();
    expect(alexaApi.setDeviceStateGraphQl).toHaveBeenCalledWith(
      'endpoint:light',
      'power',
      'turnOn',
    );
  });

  test('surfaces Alexa write failures as HomeKit communication errors', async () => {
    const { accessory, alexaApi } = createAccessory();
    alexaApi.setDeviceStateGraphQl.mockReturnValue(
      TE.left(new HttpError('write failed')),
    );

    await expect(accessory.handlePowerSet(false)).rejects.toBeDefined();
  });
});
