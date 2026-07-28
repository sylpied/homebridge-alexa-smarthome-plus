import * as E from 'fp-ts/Either';
import * as O from 'fp-ts/Option';
import type { API, MatterAccessory, MatterAPI, Service } from 'homebridge';
import DeviceStore from '../store/device-store';
import { PluginLogger } from '../util/plugin-logger';
import type { AlexaApiWrapper } from '../wrapper/alexa-api-wrapper';
import { AlexaMatterBridge } from './matter-bridge';

const matterDeviceType = {} as MatterAPI['deviceTypes']['OnOffLight'];

const createMatterApi = (): MatterAPI =>
  ({
    deviceTypes: {
      OnOffLight: matterDeviceType,
      DimmableLight: matterDeviceType,
      ColorTemperatureLight: matterDeviceType,
      ExtendedColorLight: matterDeviceType,
      OnOffSwitch: matterDeviceType,
      OnOffOutlet: matterDeviceType,
      DoorLock: matterDeviceType,
    },
    registerPlatformAccessories: jest.fn().mockResolvedValue(undefined),
    updatePlatformAccessories: jest.fn().mockResolvedValue(undefined),
    unregisterPlatformAccessories: jest.fn().mockResolvedValue(undefined),
    updateAccessoryState: jest.fn().mockResolvedValue(undefined),
  } as unknown as MatterAPI);

const createBridge = (
  matter?: MatterAPI,
  generateUuid: (source: string) => string = () => global.TEST_UUID,
) => {
  const store = new DeviceStore();
  const setDeviceStateGraphQl = jest
    .fn()
    .mockReturnValue(async () => E.right(undefined));
  const api = {
    hap: { uuid: { generate: jest.fn(generateUuid) } },
    matter,
  } as unknown as API;
  const service = {
    LockMechanism: { UUID: 'lock-mechanism' },
  } as unknown as typeof Service;
  const logger = new PluginLogger(
    global.MockLogger,
    global.createPlatformConfig(),
  );
  const bridge = new AlexaMatterBridge(
    api,
    { setDeviceStateGraphQl } as unknown as AlexaApiWrapper,
    store,
    service,
    logger,
  );
  return { bridge, setDeviceStateGraphQl, store };
};

test('reuses Alexa commands and cached state for a Matter switch', async () => {
  const matter = createMatterApi();
  const { bridge, setDeviceStateGraphQl, store } = createBridge(matter);
  const device = global.createSmartHomeDevice();

  await bridge.syncDevices([device]);

  expect(matter.registerPlatformAccessories).toHaveBeenCalledTimes(1);
  const accessory = (matter.registerPlatformAccessories as jest.Mock).mock
    .calls[0][2][0] as MatterAccessory;
  await accessory.handlers?.onOff?.on?.({}, undefined);
  expect(setDeviceStateGraphQl).toHaveBeenCalledWith(
    device.endpointId,
    'power',
    'turnOn',
  );

  store.updateCache([device.id], {
    [device.id]: O.some([
      E.right({
        featureName: 'power',
        value: 'OFF',
      }),
    ]),
  });
  await Promise.resolve();
  expect(matter.updateAccessoryState).toHaveBeenCalledWith(
    global.TEST_UUID,
    'onOff',
    { onOff: false },
  );
  bridge.stop();
});

test('does not register anything when Matter is unavailable', async () => {
  const { bridge } = createBridge();

  await expect(
    bridge.syncDevices([global.createSmartHomeDevice()]),
  ).resolves.toBeUndefined();
  bridge.stop();
});

test('keeps the replacement active when a device changes Matter type', async () => {
  const matter = createMatterApi();
  const { bridge, store } = createBridge(matter, (source) =>
    source.endsWith(':light') ? 'new-light-uuid' : 'old-switch-uuid',
  );
  const device = global.createSmartHomeDevice({
    deviceType: 'LIGHT',
    supportedOperations: ['turnOn', 'turnOff', 'setBrightness'],
  });
  bridge.configureAccessory({
    UUID: 'old-switch-uuid',
    displayName: device.displayName,
    context: {
      deviceId: device.id,
      deviceType: 'SWITCH',
      capabilityKind: 'switch',
    },
  } as unknown as MatterAccessory);

  await bridge.syncDevices([device]);
  expect(matter.unregisterPlatformAccessories).toHaveBeenCalledWith(
    expect.any(String),
    expect.any(String),
    [expect.objectContaining({ UUID: 'old-switch-uuid' })],
  );

  store.updateCache([device.id], {
    [device.id]: O.some([E.right({ featureName: 'power', value: 'ON' })]),
  });
  await Promise.resolve();
  expect(matter.updateAccessoryState).toHaveBeenLastCalledWith(
    'new-light-uuid',
    'onOff',
    { onOff: true },
  );
  bridge.stop();
});
