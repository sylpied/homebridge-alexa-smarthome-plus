import * as TE from 'fp-ts/TaskEither';
import LockAccessory from './lock-accessory';

const createAccessory = () => {
  const platform = global.createPlatform();
  const device = global.createSmartHomeDevice({
    id: 'entity:lock',
    endpointId: 'endpoint:lock',
    displayName: 'test lock',
    deviceType: 'SMARTLOCK',
    supportedOperations: ['lock', 'unlock'],
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
  const accessory = new LockAccessory(platform, device, platAcc);
  accessory.configureServices();
  return { accessory, alexaApi, platform };
};

describe('LockAccessory state confirmation', () => {
  afterEach(() => jest.useRealTimers());

  test('refreshes Alexa state after a lock command and updates HomeKit', async () => {
    jest.useFakeTimers();
    const { accessory, alexaApi, platform } = createAccessory();
    alexaApi.setDeviceStateGraphQl.mockReturnValue(TE.right(undefined));
    alexaApi.getDeviceStateGraphQl.mockReturnValue(
      TE.right([
        false,
        [{ featureName: 'lock', name: 'lockState', value: 'LOCKED' }],
      ]),
    );

    await accessory.handleTargetStateSet(
      platform.Characteristic.LockTargetState.SECURED,
    );
    await jest.advanceTimersByTimeAsync(300);

    expect(alexaApi.getDeviceStateGraphQl).toHaveBeenCalledWith(
      accessory.device,
      accessory.service,
      false,
    );
    expect(
      accessory.service.getCharacteristic(
        platform.Characteristic.LockCurrentState,
      ).value,
    ).toBe(platform.Characteristic.LockCurrentState.SECURED);
  });
});
