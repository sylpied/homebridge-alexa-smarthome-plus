import * as E from 'fp-ts/Either';
import type { API, MatterAccessory, MatterAPI, Service } from 'homebridge';
import { CapabilityState } from '../domain/alexa';
import { SmartHomeDevice } from '../domain/alexa/get-devices';
import * as lightMapper from '../mapper/light-mapper';
import * as settings from '../settings';
import DeviceStore from '../store/device-store';
import { PluginLogger } from '../util/plugin-logger';
import { AlexaApiWrapper } from '../wrapper/alexa-api-wrapper';
import {
  detectMatterCapability,
  MatterCapability,
  MatterCapabilityKind,
} from './capability';

interface AlexaMatterContext {
  deviceId: string;
  deviceType: string;
  capabilityKind: MatterCapabilityKind;
}

type AlexaMatterAccessory = MatterAccessory<AlexaMatterContext>;

/**
 * Optional Matter projection of the already-discovered Alexa devices.
 * Authentication, discovery, commands and polling stay in the existing Alexa
 * stack; this class only translates those capabilities to Matter.
 */
export class AlexaMatterBridge {
  private readonly cachedAccessories = new Map<string, AlexaMatterAccessory>();
  private readonly activeAccessories = new Map<
    string,
    {
      accessory: AlexaMatterAccessory;
      device: SmartHomeDevice;
      capability: MatterCapability;
    }
  >();
  private readonly commandsInFlight = new Set<string>();
  private readonly unsubscribeFromStateUpdates: () => void;

  constructor(
    private readonly api: API,
    private readonly alexaApi: AlexaApiWrapper,
    private readonly deviceStore: DeviceStore,
    private readonly service: typeof Service,
    private readonly log: PluginLogger,
  ) {
    this.unsubscribeFromStateUpdates = this.deviceStore.subscribeToStateUpdates(
      (deviceId, states) => {
        if (!this.commandsInFlight.has(deviceId)) {
          void this.updateMatterState(deviceId, states);
        }
      },
    );
  }

  configureAccessory(accessory: MatterAccessory): void {
    const context = accessory.context as Partial<AlexaMatterContext>;
    if (context.deviceId && context.capabilityKind) {
      this.cachedAccessories.set(
        accessory.UUID,
        accessory as AlexaMatterAccessory,
      );
    }
  }

  async syncDevices(devices: SmartHomeDevice[]): Promise<void> {
    const matter = this.api.matter;
    if (!matter) {
      return;
    }

    const activeUuids = new Set<string>();
    for (const device of devices) {
      const capability = detectMatterCapability(device);
      if (!capability) {
        this.log.debug(
          `Matter mapping unavailable for "${device.displayName}" (${device.deviceType}).`,
        )();
        continue;
      }

      const uuid = this.api.hap.uuid.generate(
        `alexa-matter:${device.id}:${capability.kind}`,
      );
      activeUuids.add(uuid);
      const configured = this.createAccessory(matter, device, capability, uuid);
      const cached = this.cachedAccessories.get(uuid);
      const accessory = cached ? Object.assign(cached, configured) : configured;

      this.activeAccessories.set(device.id, {
        accessory,
        device,
        capability,
      });
      if (cached) {
        await matter.updatePlatformAccessories([accessory]);
        this.log.debug(`Restored Matter accessory: ${device.displayName}`)();
      } else {
        await matter.registerPlatformAccessories(
          settings.PLUGIN_NAME,
          settings.PLATFORM_NAME,
          [accessory],
        );
        this.cachedAccessories.set(uuid, accessory);
        this.log.info(
          `Mapped "${device.displayName}": Alexa ${device.deviceType} → Matter ${capability.kind}.`,
        )();
      }

      await this.updateMatterState(
        device.id,
        this.deviceStore.getCacheStatesForDevice(device.id),
      );
    }

    const stale = [...this.cachedAccessories.values()].filter(
      ({ UUID }) => !activeUuids.has(UUID),
    );
    if (stale.length) {
      await matter.unregisterPlatformAccessories(
        settings.PLUGIN_NAME,
        settings.PLATFORM_NAME,
        stale,
      );
      stale.forEach(({ UUID, context }) => {
        this.cachedAccessories.delete(UUID);
        const active = this.activeAccessories.get(context.deviceId);
        if (active?.accessory.UUID === UUID) {
          this.activeAccessories.delete(context.deviceId);
        }
      });
      this.log.info(`Removed ${stale.length} stale Matter accessories.`)();
    }
  }

  stop(): void {
    this.unsubscribeFromStateUpdates();
  }

  private createAccessory(
    matter: MatterAPI,
    device: SmartHomeDevice,
    capability: MatterCapability,
    uuid: string,
  ): AlexaMatterAccessory {
    const accessory: AlexaMatterAccessory = {
      UUID: uuid,
      displayName: device.displayName,
      deviceType: this.deviceType(matter, capability),
      manufacturer: device.manufacturer,
      model: device.model.length > 1 ? device.model : 'Unknown',
      serialNumber: device.serialNumber,
      context: {
        deviceId: device.id,
        deviceType: device.deviceType,
        capabilityKind: capability.kind,
      },
      clusters: this.initialClusters(capability),
      handlers: this.handlers(device, capability),
    };
    return accessory;
  }

  private deviceType(matter: MatterAPI, capability: MatterCapability) {
    if (capability.kind === 'lock') {
      return matter.deviceTypes.DoorLock;
    }
    if (capability.kind === 'outlet') {
      return matter.deviceTypes.OnOffOutlet;
    }
    if (capability.kind === 'switch') {
      return matter.deviceTypes.OnOffSwitch;
    }
    if (capability.color) {
      return matter.deviceTypes.ExtendedColorLight;
    }
    if (capability.colorTemperature) {
      return matter.deviceTypes.ColorTemperatureLight;
    }
    if (capability.brightness) {
      return matter.deviceTypes.DimmableLight;
    }
    return matter.deviceTypes.OnOffLight;
  }

  private initialClusters(
    capability: MatterCapability,
  ): NonNullable<MatterAccessory['clusters']> {
    if (capability.kind === 'lock') {
      return {
        doorLock: { lockState: null, lockType: 0, actuatorEnabled: true },
      };
    }

    const clusters: NonNullable<MatterAccessory['clusters']> = {
      onOff: { onOff: false },
    };
    if (capability.brightness) {
      clusters.levelControl = { currentLevel: 1, minLevel: 1, maxLevel: 254 };
    }
    if (capability.color || capability.colorTemperature) {
      clusters.colorControl = {
        ...(capability.color
          ? {
              currentHue: 0,
              currentSaturation: 0,
              colorMode: 0,
              enhancedColorMode: 0,
            }
          : {}),
        ...(capability.colorTemperature
          ? {
              colorTemperatureMireds: 250,
              colorTempPhysicalMinMireds: 140,
              colorTempPhysicalMaxMireds: 500,
              colorMode: capability.color ? 0 : 2,
              enhancedColorMode: capability.color ? 0 : 2,
            }
          : {}),
      };
    }
    return clusters;
  }

  private handlers(
    device: SmartHomeDevice,
    capability: MatterCapability,
  ): NonNullable<MatterAccessory['handlers']> {
    if (capability.kind === 'lock') {
      return {
        doorLock: {
          lockDoor: () => this.runLockCommand(device, true),
          unlockDoor: () => this.runLockCommand(device, false),
        },
      };
    }

    const handlers: NonNullable<MatterAccessory['handlers']> = {
      onOff: {
        on: () => this.runPowerCommand(device, true),
        off: () => this.runPowerCommand(device, false),
      },
    };
    if (capability.brightness) {
      handlers.levelControl = {
        moveToLevel: ({ level }) =>
          this.runBrightnessCommand(device, Number(level)),
        moveToLevelWithOnOff: ({ level }) =>
          this.runBrightnessCommand(device, Number(level)),
      };
    }
    if (capability.color || capability.colorTemperature) {
      handlers.colorControl = {
        ...(capability.color
          ? {
              moveToHueAndSaturationLogic: ({ hue, saturation }) =>
                this.runColorCommand(device, Number(hue), Number(saturation)),
              moveToHueLogic: ({ targetHue }) =>
                this.runColorCommand(device, Number(targetHue), 254),
            }
          : {}),
        ...(capability.colorTemperature
          ? {
              moveToColorTemperatureLogic: ({ colorTemperatureMireds }) =>
                this.runColorTemperatureCommand(
                  device,
                  Number(colorTemperatureMireds),
                ),
            }
          : {}),
      };
    }
    return handlers;
  }

  private async runPowerCommand(
    device: SmartHomeDevice,
    on: boolean,
  ): Promise<void> {
    await this.runCommand(device, async () => {
      await this.unwrap(
        this.alexaApi.setDeviceStateGraphQl(
          device.endpointId,
          'power',
          on ? 'turnOn' : 'turnOff',
        )(),
      );
      this.deviceStore.updateCacheValue(device.id, {
        featureName: 'power',
        value: on ? 'ON' : 'OFF',
      });
    });
  }

  private async runBrightnessCommand(
    device: SmartHomeDevice,
    matterLevel: number,
  ): Promise<void> {
    const brightness = Math.max(
      0,
      Math.min(100, Math.round((matterLevel / 254) * 100)),
    );
    await this.runCommand(device, async () => {
      await this.unwrap(
        this.alexaApi.setDeviceStateGraphQl(
          device.endpointId,
          'brightness',
          'setBrightness',
          { brightness: brightness.toString(10) },
        )(),
      );
      this.deviceStore.updateCacheValue(device.id, {
        featureName: 'brightness',
        value: brightness,
      });
    });
  }

  private async runColorCommand(
    device: SmartHomeDevice,
    matterHue: number,
    matterSaturation: number,
  ): Promise<void> {
    const hue = Math.max(0, Math.min(360, (matterHue / 254) * 360));
    const colorName = lightMapper.mapHomeKitHueToAlexaValue(hue);
    if (colorName._tag === 'None') {
      throw new Error(`Unsupported Matter hue: ${matterHue}`);
    }
    await this.runCommand(device, async () => {
      await this.unwrap(
        this.alexaApi.setDeviceState(device.id, 'setColor', {
          colorName: colorName.value,
        })(),
      );
      this.deviceStore.updateCacheValue(device.id, {
        featureName: 'color',
        value: {
          hue,
          saturation: Math.max(0, Math.min(1, matterSaturation / 254)),
          brightness: this.numericState(device.id, 'brightness') ?? 100,
        },
      });
    });
  }

  private async runColorTemperatureCommand(
    device: SmartHomeDevice,
    mireds: number,
  ): Promise<void> {
    const safeMireds = Math.max(140, Math.min(500, mireds));
    const kelvin = Math.round(1_000_000 / safeMireds);
    await this.runCommand(device, async () => {
      await this.unwrap(
        this.alexaApi.setDeviceStateGraphQl(
          device.endpointId,
          'colorTemperature',
          'setColorTemperature',
          { colorTemperatureInKelvin: kelvin },
        )(),
      );
      this.deviceStore.updateCacheValue(device.id, {
        featureName: 'colorTemperature',
        value: kelvin,
      });
    });
  }

  private async runLockCommand(
    device: SmartHomeDevice,
    locked: boolean,
  ): Promise<void> {
    await this.runCommand(device, async () => {
      await this.unwrap(
        this.alexaApi.setDeviceStateGraphQl(
          device.endpointId,
          'lock',
          locked ? 'lock' : 'unlock',
        )(),
      );

      const expected = locked ? 'LOCKED' : 'UNLOCKED';
      for (let attempt = 0; attempt < 10; attempt++) {
        await new Promise((resolve) =>
          setTimeout(resolve, attempt === 0 ? 300 : 1_000),
        );
        const result = await this.alexaApi.getDeviceStateGraphQl(
          device,
          { UUID: this.service.LockMechanism.UUID },
          false,
        )();
        if (
          E.isRight(result) &&
          result.right[1].some(
            ({ featureName, value }) =>
              featureName === 'lock' && value === expected,
          )
        ) {
          return;
        }
      }
      throw new Error(`Timed out waiting for lock state: ${expected}`);
    });
  }

  private async runCommand(
    device: SmartHomeDevice,
    command: () => Promise<void>,
  ): Promise<void> {
    this.commandsInFlight.add(device.id);
    try {
      await command();
    } finally {
      this.commandsInFlight.delete(device.id);
      setTimeout(() => {
        void this.updateMatterState(
          device.id,
          this.deviceStore.getCacheStatesForDevice(device.id),
        );
      }, 0);
    }
  }

  private async unwrap<T>(result: Promise<E.Either<Error, T>>): Promise<T> {
    const resolved = await result;
    if (E.isLeft(resolved)) {
      throw resolved.left;
    }
    return resolved.right;
  }

  private async updateMatterState(
    deviceId: string,
    states: CapabilityState[],
  ): Promise<void> {
    const matter = this.api.matter;
    const active = this.activeAccessories.get(deviceId);
    if (!matter || !active) {
      return;
    }

    const { accessory, capability } = active;
    const updates: Promise<void>[] = [];
    const power = this.state(states, 'power');
    if (power && capability.kind !== 'lock') {
      updates.push(
        matter.updateAccessoryState(accessory.UUID, 'onOff', {
          onOff: power.value === 'ON',
        }),
      );
    }

    const brightness = this.state(states, 'brightness');
    const brightnessValue = Number(brightness?.value);
    if (
      capability.brightness &&
      brightness &&
      Number.isFinite(brightnessValue)
    ) {
      updates.push(
        matter.updateAccessoryState(accessory.UUID, 'levelControl', {
          currentLevel: Math.max(
            1,
            Math.min(254, Math.round((brightnessValue / 100) * 254)),
          ),
        }),
      );
    }

    const color = this.state(states, 'color');
    if (capability.color && color && typeof color.value === 'object') {
      const hue = Number(color.value.hue);
      const saturation = Number(color.value.saturation);
      if (Number.isFinite(hue) && Number.isFinite(saturation)) {
        updates.push(
          matter.updateAccessoryState(accessory.UUID, 'colorControl', {
            currentHue: Math.max(
              0,
              Math.min(254, Math.round((hue / 360) * 254)),
            ),
            currentSaturation: Math.max(
              0,
              Math.min(254, Math.round(saturation * 254)),
            ),
            colorMode: 0,
            enhancedColorMode: 0,
          }),
        );
      }
    }

    const colorTemperature = this.state(states, 'colorTemperature');
    const kelvin = Number(colorTemperature?.value);
    if (
      capability.colorTemperature &&
      colorTemperature &&
      Number.isFinite(kelvin) &&
      kelvin > 0
    ) {
      updates.push(
        matter.updateAccessoryState(accessory.UUID, 'colorControl', {
          colorTemperatureMireds: Math.max(
            140,
            Math.min(500, Math.round(1_000_000 / kelvin)),
          ),
          colorMode: 2,
          enhancedColorMode: 2,
        }),
      );
    }

    const lock = this.state(states, 'lock');
    if (capability.kind === 'lock' && lock) {
      updates.push(
        matter.updateAccessoryState(accessory.UUID, 'doorLock', {
          lockState:
            lock.value === 'LOCKED' ? 1 : lock.value === 'UNLOCKED' ? 2 : 0,
        }),
      );
    }

    await Promise.all(updates).catch((error: unknown) => {
      this.log.debug(
        `Matter state update failed for "${
          active.device.displayName
        }": ${String(error)}`,
      )();
    });
  }

  private state(
    states: CapabilityState[],
    featureName: CapabilityState['featureName'],
  ): CapabilityState | undefined {
    return states.find((state) => state.featureName === featureName);
  }

  private numericState(
    deviceId: string,
    featureName: CapabilityState['featureName'],
  ): number | undefined {
    const value = this.state(
      this.deviceStore.getCacheStatesForDevice(deviceId),
      featureName,
    )?.value;
    const number = Number(value);
    return Number.isFinite(number) ? number : undefined;
  }
}
