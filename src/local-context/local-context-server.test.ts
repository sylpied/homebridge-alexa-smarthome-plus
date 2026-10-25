import * as hapNodeJs from '@homebridge/hap-nodejs';
import * as E from 'fp-ts/Either';
import * as O from 'fp-ts/Option';
import * as TE from 'fp-ts/TaskEither';
import { IncomingMessage, ServerResponse } from 'http';
import { Readable } from 'stream';
import DeviceStore from '../store/device-store';
import { PluginLogger } from '../util/plugin-logger';
import { AlexaApiWrapper } from '../wrapper/alexa-api-wrapper';
import { LocalContextServer } from './local-context-server';

const apiToken = 'api-token-for-tests';

describe('LocalContextServer', () => {
  let server: LocalContextServer;
  let store: DeviceStore;
  let setDeviceStateGraphQl: jest.Mock;
  let getDeviceStateGraphQl: jest.Mock;
  const device = global.createSmartHomeDevice({
    deviceType: 'THERMOSTAT',
    supportedOperations: ['setThermostatMode', 'setTargetSetpoint'],
  });
  const lock = global.createSmartHomeDevice({
    id: 'entity:test-lock',
    endpointId: 'endpoint:test-lock',
    deviceType: 'SMARTLOCK',
    supportedOperations: ['lock', 'unlock'],
  });

  beforeEach(() => {
    store = new DeviceStore();
    setDeviceStateGraphQl = jest.fn(() => TE.right(undefined));
    getDeviceStateGraphQl = jest.fn(() => {
      setMode('COOL');
      return TE.right([false, store.getCacheStatesForDevice(device.id)]);
    });
    server = new LocalContextServer(
      {
        enabled: true,
        host: '127.0.0.1',
        port: 0,
        apiToken,
        eventToken: 'event-token-for-tests',
        eventUrl: undefined,
        token: undefined,
      },
      {
        setDeviceStateGraphQl,
        getDeviceStateGraphQl,
      } as unknown as AlexaApiWrapper,
      store,
      hapNodeJs.Service,
      {
        info: () => () => undefined,
        warn: () => () => undefined,
        error: () => () => undefined,
        errorT: () => () => undefined,
      } as unknown as PluginLogger,
    );
    server.syncDevices([device, lock]);
  });

  afterEach(() => server.stop());

  test('provides info and common unauthorized errors', async () => {
    const unauthorized = await request('GET', '/v1/info');
    expect(JSON.parse(unauthorized.body).error.code).toBe('UNAUTHORIZED');

    const info = await request('GET', '/v1/info', undefined, apiToken);
    expect(JSON.parse(info.body)).toMatchObject({
      apiVersion: '1',
      patchFormat: 'changes',
    });
  });

  test('reports lock as read-only and Alexa state as reported', async () => {
    store.updateCache([lock.id], {
      [lock.id]: O.of([E.right({ featureName: 'lock', value: 'UNLOCKED' })]),
    });
    const response = await request(
      'GET',
      `/v1/devices/${lock.id}`,
      undefined,
      apiToken,
    );
    const body = JSON.parse(response.body);
    expect(body.capabilities).toContainEqual(
      expect.objectContaining({ id: 'lockState', writable: false }),
    );
    expect(body.snapshot).toMatchObject({
      stateConfidence: 'reported',
      state: { lockState: 'unlocked' },
    });
  });

  test('requires operationId and the common changes envelope', async () => {
    const response = await request(
      'PATCH',
      `/v1/devices/${device.id}/state`,
      JSON.stringify({ changes: { hvac: { mode: 'cool' } } }),
      apiToken,
    );
    expect(JSON.parse(response.body).error.code).toBe('OPERATION_ID_REQUIRED');
  });

  test('applies HVAC changes and confirms them from Alexa', async () => {
    const response = await request(
      'PATCH',
      `/v1/devices/${device.id}/state`,
      JSON.stringify({
        operationId: 'operation-1',
        controlContext: { source: 'kokochi-pilot' },
        changes: { hvac: { mode: 'cool' } },
      }),
      apiToken,
    );
    const body = JSON.parse(response.body);
    expect(response.statusCode).toBe(200);
    expect(setDeviceStateGraphQl).toHaveBeenCalledWith(
      device.endpointId,
      'thermostat',
      'setThermostatMode',
      { thermostatMode: 'COOL' },
    );
    expect(body).toMatchObject({
      operationId: 'operation-1',
      applied: true,
      confirmed: true,
      results: [{ field: 'hvac.mode', applied: true, confirmed: true }],
      snapshot: { stateConfidence: 'confirmed' },
    });
  });

  test('does not emit an external event when an unconfirmed state stayed unchanged', async () => {
    setMode('HEAT');
    const fetchMock = jest
      .spyOn(global, 'fetch')
      .mockResolvedValue({ ok: true, status: 200 } as Response);
    (server as unknown as { config: { eventUrl: string } }).config.eventUrl =
      'http://127.0.0.1:17890/v1/events';
    getDeviceStateGraphQl.mockImplementation(() => {
      setMode('HEAT');
      return TE.right([false, store.getCacheStatesForDevice(device.id)]);
    });
    const response = await request(
      'PATCH',
      `/v1/devices/${device.id}/state`,
      JSON.stringify({
        operationId: 'operation-2',
        changes: { hvac: { mode: 'cool' } },
      }),
      apiToken,
    );
    const body = JSON.parse(response.body);
    expect(response.statusCode).toBe(202);
    expect(body.error.code).toBe('APPLIED_BUT_UNCONFIRMED');
    expect(body.snapshot.state.hvac.mode).toBe('heat');
    expect(fetchMock).not.toHaveBeenCalled();
  });

  test('rejects lock writes', async () => {
    const response = await request(
      'PATCH',
      `/v1/devices/${lock.id}/state`,
      JSON.stringify({
        operationId: 'operation-lock',
        changes: { lockState: 'unlocked' },
      }),
      apiToken,
    );
    expect(JSON.parse(response.body).results[0]).toMatchObject({
      field: 'lockState',
      applied: false,
      error: { code: 'READ_ONLY_CAPABILITY' },
    });
  });

  function setMode(mode: string): void {
    store.updateCache([device.id], {
      [device.id]: O.of([
        E.right({
          featureName: 'thermostat',
          name: 'thermostatMode',
          value: mode,
        }),
      ]),
    });
  }

  async function request(
    method: string,
    url: string,
    body?: string,
    bearer?: string,
  ): Promise<{ statusCode: number; body: string }> {
    const incoming = Readable.from(
      body ? [Buffer.from(body)] : [],
    ) as IncomingMessage;
    incoming.method = method;
    incoming.url = url;
    incoming.headers = bearer ? { authorization: `Bearer ${bearer}` } : {};
    let responseBody = '';
    const response = {
      statusCode: 200,
      headersSent: false,
      setHeader: jest.fn(),
      end: (chunk?: string) => (responseBody = chunk ?? ''),
    } as unknown as ServerResponse;
    await server.handle(incoming, response);
    return { statusCode: response.statusCode, body: responseBody };
  }
});
