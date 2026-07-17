import * as TE from 'fp-ts/TaskEither';
import LightAccessory from './light-accessory';

const createAccessory = (
  periodicStateRefresh = true,
  periodicStateRefreshIntervalMinutes = 5,
) => {
  const platform = global.createPlatform();
  platform.config.performance = {
    cacheTTL: platform.config.performance?.cacheTTL ?? 30,
    periodicStateRefresh,
    periodicStateRefreshIntervalMinutes,
  };
  const device = global.createSmartHomeDevice({
    id: 'entity:periodic-light',
    endpointId: 'endpoint:periodic-light',
    displayName: 'periodic light',
    deviceType: 'LIGHT',
    supportedOperations: ['turnOn', 'turnOff'],
  });
  const alexaApi = {
    getDeviceStateGraphQl: jest
      .fn()
      .mockReturnValue(
        TE.right([false, [{ featureName: 'power', value: 'ON' }]]),
      ),
    setDeviceStateGraphQl: jest.fn().mockReturnValue(TE.right(undefined)),
  };
  (platform as any).alexaApi = alexaApi;
  const platAcc = new platform.api.platformAccessory(
    device.displayName,
    global.TEST_UUID,
  );
  const accessory = new LightAccessory(platform, device, platAcc);
  accessory.configureServices();
  return { accessory, alexaApi, platform };
};

describe('BaseAccessory periodic state refresh', () => {
  afterEach(() => jest.useRealTimers());

  test('refreshes after 10 seconds and updates the HomeKit characteristic', async () => {
    jest.useFakeTimers();
    const { accessory, alexaApi, platform } = createAccessory();

    accessory.startPeriodicStateRefresh();
    await jest.advanceTimersByTimeAsync(10_000);

    expect(alexaApi.getDeviceStateGraphQl).toHaveBeenCalledWith(
      accessory.device,
      accessory.service,
      false,
    );
    expect(
      accessory.service.getCharacteristic(platform.Characteristic.On).value,
    ).toBe(true);
    accessory.stopPeriodicStateRefresh();
  });

  test('does not schedule refreshes when disabled', async () => {
    jest.useFakeTimers();
    const { accessory, alexaApi } = createAccessory(false);

    accessory.startPeriodicStateRefresh();
    await jest.advanceTimersByTimeAsync(30 * 60 * 1000);

    expect(alexaApi.getDeviceStateGraphQl).not.toHaveBeenCalled();
  });

  test('restarts the schedule after a HomeKit write', async () => {
    jest.useFakeTimers();
    const { accessory, alexaApi, platform } = createAccessory();
    const on = accessory.service.getCharacteristic(platform.Characteristic.On);

    accessory.startPeriodicStateRefresh();
    await jest.advanceTimersByTimeAsync(9_000);
    await new Promise<void>((resolve, reject) =>
      on.setValue(true, (error) => (error ? reject(error) : resolve())),
    );
    await jest.advanceTimersByTimeAsync(1_000);
    expect(alexaApi.getDeviceStateGraphQl).not.toHaveBeenCalled();

    await jest.advanceTimersByTimeAsync(9_000);
    expect(alexaApi.getDeviceStateGraphQl).toHaveBeenCalled();
    accessory.stopPeriodicStateRefresh();
  });

  test('uses the complete refresh schedule and then the configured interval', async () => {
    jest.useFakeTimers();
    const { accessory } = createAccessory();
    const refreshState = jest
      .spyOn(accessory as any, 'refreshStateFromAlexa')
      .mockResolvedValue(true);
    const absoluteRefreshTimes = [
      10_000, 15_000, 30_000, 60_000, 180_000, 300_000, 600_000, 900_000,
      1_200_000, 1_500_000,
    ];

    accessory.startPeriodicStateRefresh();

    let previousTime = 0;
    for (const [index, refreshTime] of absoluteRefreshTimes.entries()) {
      await jest.advanceTimersByTimeAsync(refreshTime - previousTime - 1);
      expect(refreshState).toHaveBeenCalledTimes(index);
      await jest.advanceTimersByTimeAsync(1);
      expect(refreshState).toHaveBeenCalledTimes(index + 1);
      previousTime = refreshTime;
    }

    accessory.stopPeriodicStateRefresh();
  });

  test('stopping periodic refresh clears the pending timer', async () => {
    jest.useFakeTimers();
    const { accessory } = createAccessory();
    const refreshState = jest
      .spyOn(accessory as any, 'refreshStateFromAlexa')
      .mockResolvedValue(true);

    accessory.startPeriodicStateRefresh();
    await jest.advanceTimersByTimeAsync(9_000);
    accessory.stopPeriodicStateRefresh();
    await jest.advanceTimersByTimeAsync(30 * 60 * 1000);

    expect(refreshState).not.toHaveBeenCalled();
  });

  test('continues scheduling after an unexpected refresh error', async () => {
    jest.useFakeTimers();
    const { accessory } = createAccessory();
    const refreshState = jest
      .spyOn(accessory as any, 'refreshStateFromAlexa')
      .mockRejectedValueOnce(new Error('temporary failure'))
      .mockResolvedValue(true);

    accessory.startPeriodicStateRefresh();
    await jest.advanceTimersByTimeAsync(10_000);
    await jest.advanceTimersByTimeAsync(10 * 60_000 - 1);
    expect(refreshState).toHaveBeenCalledTimes(1);
    await jest.advanceTimersByTimeAsync(1);

    expect(refreshState).toHaveBeenCalledTimes(2);
    accessory.stopPeriodicStateRefresh();
  });

  test('does not reschedule an in-flight refresh after being stopped', async () => {
    jest.useFakeTimers();
    const { accessory } = createAccessory();
    let finishRefresh: (() => void) | undefined;
    const refreshState = jest
      .spyOn(accessory as any, 'refreshStateFromAlexa')
      .mockImplementation(
        () =>
          new Promise<void>((resolve) => {
            finishRefresh = resolve;
          }),
      );

    accessory.startPeriodicStateRefresh();
    await jest.advanceTimersByTimeAsync(10_000);
    expect(refreshState).toHaveBeenCalledTimes(1);

    accessory.stopPeriodicStateRefresh();
    finishRefresh?.();
    await Promise.resolve();
    await jest.advanceTimersByTimeAsync(30 * 60 * 1000);

    expect(refreshState).toHaveBeenCalledTimes(1);
  });

  test('stagger delays the first request for additional accessories', async () => {
    jest.useFakeTimers();
    const { accessory } = createAccessory();
    const refreshState = jest
      .spyOn(accessory as any, 'refreshStateFromAlexa')
      .mockResolvedValue(true);

    accessory.startPeriodicStateRefresh(2_000);
    await jest.advanceTimersByTimeAsync(11_999);
    expect(refreshState).not.toHaveBeenCalled();
    await jest.advanceTimersByTimeAsync(1);
    expect(refreshState).toHaveBeenCalledTimes(1);
    accessory.stopPeriodicStateRefresh();
  });

  test('supports a one-minute steady refresh interval', async () => {
    jest.useFakeTimers();
    const { accessory } = createAccessory(true, 1);
    const refreshState = jest
      .spyOn(accessory as any, 'refreshStateFromAlexa')
      .mockResolvedValue(true);

    accessory.startPeriodicStateRefresh();
    await jest.advanceTimersByTimeAsync(15 * 60_000);
    expect(refreshState).toHaveBeenCalledTimes(8);
    await jest.advanceTimersByTimeAsync(60_000);
    expect(refreshState).toHaveBeenCalledTimes(9);
    accessory.stopPeriodicStateRefresh();
  });
});
