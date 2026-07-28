import { SmartHomeDevice } from '../domain/alexa/get-devices';

export type MatterCapabilityKind = 'light' | 'lock' | 'outlet' | 'switch';

export interface MatterCapability {
  kind: MatterCapabilityKind;
  brightness: boolean;
  color: boolean;
  colorTemperature: boolean;
}

const supports = (device: SmartHomeDevice, ...operations: string[]) =>
  operations.every((operation) =>
    device.supportedOperations.includes(operation),
  );

/**
 * Derive a protocol-neutral device capability from Alexa's category and
 * operations. Device categories are treated as hints; writable operations are
 * the source of truth so previously unseen Alexa categories can still become
 * useful switches.
 */
export const detectMatterCapability = (
  device: SmartHomeDevice,
): MatterCapability | undefined => {
  if (device.deviceType === 'SMARTLOCK' && supports(device, 'lock', 'unlock')) {
    return {
      kind: 'lock',
      brightness: false,
      color: false,
      colorTemperature: false,
    };
  }

  if (!supports(device, 'turnOn', 'turnOff')) {
    return undefined;
  }

  const lightLike =
    device.deviceType === 'LIGHT' ||
    (device.deviceType === 'SWITCH' &&
      device.supportedOperations.includes('setBrightness'));

  if (lightLike) {
    return {
      kind: 'light',
      brightness: device.supportedOperations.includes('setBrightness'),
      color: device.supportedOperations.includes('setColor'),
      colorTemperature: device.supportedOperations.includes(
        'setColorTemperature',
      ),
    };
  }

  return {
    kind: device.deviceType === 'SMARTPLUG' ? 'outlet' : 'switch',
    brightness: false,
    color: false,
    colorTemperature: false,
  };
};
