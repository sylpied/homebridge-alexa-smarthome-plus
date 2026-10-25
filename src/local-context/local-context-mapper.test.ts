import {
  mapCapabilities,
  mapState,
  stateMatches,
} from './local-context-mapper';

test('normalizes thermostat, temperature and humidity state', () => {
  const state = mapState([
    {
      featureName: 'temperatureSensor',
      value: { value: 77, scale: 'FAHRENHEIT' },
    },
    {
      featureName: 'range',
      rangeName: 'Indoor Humidity',
      value: 45,
    },
    {
      featureName: 'thermostat',
      name: 'thermostatMode',
      value: 'COOL',
    },
    {
      featureName: 'thermostat',
      name: 'targetSetpoint',
      value: { value: 24, scale: 'CELSIUS' },
    },
  ]);

  expect(state).toEqual({
    temperatureC: 25,
    humidityPercent: 45,
    hvac: {
      currentTemperatureC: 25,
      mode: 'cool',
      targetTemperatureC: 24,
    },
  });
  expect(
    stateMatches(state, { hvac: { mode: 'cool', targetTemperatureC: 24 } }),
  ).toBe(true);
});

test('declares common thermostat capabilities', () => {
  const device = global.createSmartHomeDevice({
    deviceType: 'THERMOSTAT',
    supportedOperations: ['setThermostatMode', 'setTargetSetpoint'],
  });

  expect(mapCapabilities(device, [])).toEqual([
    expect.objectContaining({ id: 'hvac.mode', writable: true }),
    expect.objectContaining({
      id: 'hvac.targetTemperatureC',
      writable: true,
    }),
  ]);
});
