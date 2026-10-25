import { CapabilityState } from '../domain/alexa';
import { SmartHomeDevice } from '../domain/alexa/get-devices';
import { isTemperatureValue } from '../domain/alexa/temperature';

export type StateConfidence = 'confirmed' | 'reported' | 'inferred' | 'unknown';

export interface CommonDeviceState {
  temperatureC?: number;
  humidityPercent?: number;
  lockState?: 'locked' | 'unlocked' | 'jammed' | 'unknown';
  hvac?: {
    mode?: 'off' | 'heat' | 'cool' | 'auto' | 'eco';
    currentTemperatureC?: number;
    targetTemperatureC?: number;
    lowerTargetTemperatureC?: number;
    upperTargetTemperatureC?: number;
  };
}

export interface CommonCapability {
  id: string;
  readable: boolean;
  writable: boolean;
  values?: string[];
  unit?: string;
}

export const supportsLocalContext = (device: SmartHomeDevice): boolean =>
  device.deviceType === 'SMARTLOCK' ||
  device.deviceType === 'THERMOSTAT' ||
  device.deviceType === 'TEMPERATURE_SENSOR' ||
  device.deviceType === 'HUMIDITY_SENSOR' ||
  device.supportedOperations.some((operation) =>
    ['lock', 'unlock', 'setTargetSetpoint', 'setThermostatMode'].includes(
      operation,
    ),
  );

export const mapCapabilities = (
  device: SmartHomeDevice,
  states: CapabilityState[],
): CommonCapability[] => {
  const capabilities: CommonCapability[] = [];
  if (
    states.some(({ featureName }) => featureName === 'lock') ||
    device.supportedOperations.some((operation) =>
      ['lock', 'unlock'].includes(operation),
    )
  ) {
    capabilities.push({
      id: 'lockState',
      readable: true,
      writable: false,
      values: ['locked', 'unlocked'],
    });
  }
  if (states.some(({ featureName }) => featureName === 'temperatureSensor')) {
    capabilities.push({
      id: 'temperatureC',
      readable: true,
      writable: false,
      unit: 'celsius',
    });
  }
  if (states.some(isHumidityState)) {
    capabilities.push({
      id: 'humidityPercent',
      readable: true,
      writable: false,
      unit: 'percent',
    });
  }
  if (
    states.some(({ featureName }) => featureName === 'thermostat') ||
    device.deviceType === 'THERMOSTAT'
  ) {
    capabilities.push(
      {
        id: 'hvac.mode',
        readable: true,
        writable: device.supportedOperations.includes('setThermostatMode'),
        values: ['off', 'heat', 'cool', 'auto', 'eco'],
      },
      {
        id: 'hvac.targetTemperatureC',
        readable: true,
        writable: device.supportedOperations.includes('setTargetSetpoint'),
        unit: 'celsius',
      },
    );
  }
  return capabilities;
};

export const mapState = (states: CapabilityState[]): CommonDeviceState => {
  const result: CommonDeviceState = {};
  for (const state of states) {
    if (state.featureName === 'lock' && typeof state.value === 'string') {
      result.lockState =
        state.value === 'LOCKED'
          ? 'locked'
          : state.value === 'UNLOCKED'
          ? 'unlocked'
          : state.value === 'JAMMED'
          ? 'jammed'
          : 'unknown';
    }
    if (state.featureName === 'temperatureSensor') {
      const temperatureC = toCelsius(state.value);
      if (temperatureC !== undefined) {
        result.temperatureC = temperatureC;
        result.hvac = { ...result.hvac, currentTemperatureC: temperatureC };
      }
    }
    if (isHumidityState(state) && typeof state.value === 'number') {
      result.humidityPercent = state.value;
    }
    if (state.featureName === 'thermostat') {
      if (state.name === 'thermostatMode' && typeof state.value === 'string') {
        result.hvac = {
          ...result.hvac,
          mode: state.value.toLowerCase() as NonNullable<
            CommonDeviceState['hvac']
          >['mode'],
        };
      }
      const temperatureC = toCelsius(state.value);
      if (temperatureC !== undefined) {
        const key =
          state.name === 'lowerSetpoint'
            ? 'lowerTargetTemperatureC'
            : state.name === 'upperSetpoint'
            ? 'upperTargetTemperatureC'
            : 'targetTemperatureC';
        result.hvac = { ...result.hvac, [key]: temperatureC };
      }
    }
  }
  return result;
};

export const stateMatches = (
  actual: CommonDeviceState,
  requested: CommonDeviceState,
): boolean => {
  if (requested.lockState && actual.lockState !== requested.lockState) {
    return false;
  }
  if (requested.hvac?.mode && actual.hvac?.mode !== requested.hvac.mode) {
    return false;
  }
  if (
    requested.hvac?.targetTemperatureC !== undefined &&
    (actual.hvac?.targetTemperatureC === undefined ||
      Math.abs(
        actual.hvac.targetTemperatureC - requested.hvac.targetTemperatureC,
      ) > 0.2)
  ) {
    return false;
  }
  return true;
};

const isHumidityState = (state: CapabilityState): boolean =>
  state.featureName === 'range' &&
  (state.rangeName?.toLowerCase().includes('humidity') === true ||
    state.name?.toLowerCase().includes('humidity') === true);

const toCelsius = (value: CapabilityState['value']): number | undefined => {
  if (!isTemperatureValue(value)) {
    return undefined;
  }
  const numeric = Number(value.value);
  return value.scale.toLowerCase() === 'fahrenheit'
    ? Math.round(((numeric - 32) / 1.8) * 10) / 10
    : numeric;
};
