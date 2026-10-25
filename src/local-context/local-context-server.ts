import { timingSafeEqual } from 'crypto';
import * as E from 'fp-ts/Either';
import { createServer, IncomingMessage, Server, ServerResponse } from 'http';
import { AddressInfo } from 'net';
import type { Service } from 'homebridge';
import { SmartHomeDevice } from '../domain/alexa/get-devices';
import { AlexaPlatformConfig } from '../domain/homebridge';
import DeviceStore from '../store/device-store';
import { PluginLogger } from '../util/plugin-logger';
import { AlexaApiWrapper } from '../wrapper/alexa-api-wrapper';
import { loadOrCreateCredentials } from './local-context-credentials';
import {
  CommonDeviceState,
  mapCapabilities,
  mapState,
  stateMatches,
  supportsLocalContext,
} from './local-context-mapper';

const API_VERSION = '1';
const MAX_BODY_BYTES = 64 * 1024;
const CONFIRM_DELAYS_MS = [0, 300, 700, 1_000] as const;

interface StatePatchRequest {
  operationId?: unknown;
  controlContext?: unknown;
  changes?: unknown;
}

interface Snapshot {
  deviceId: string;
  observedAt: string;
  stale: boolean;
  stateConfidence: 'confirmed' | 'reported' | 'inferred' | 'unknown';
  state: CommonDeviceState;
}

/** Kokochi projection over the existing Alexa discovery, command and cache stack. */
export class LocalContextServer {
  private server?: Server;
  private readonly devices = new Map<string, SmartHomeDevice>();
  private readonly snapshots = new Map<string, string>();
  private readonly confirming = new Set<string>();
  private readonly suppressedChanges = new Map<string, Snapshot>();
  private readonly credentials;
  private readonly unsubscribe: () => void;

  constructor(
    private readonly config: AlexaPlatformConfig['localContext'],
    private readonly alexaApi: AlexaApiWrapper,
    private readonly deviceStore: DeviceStore,
    private readonly service: typeof Service,
    private readonly log: PluginLogger,
    credentialPath?: string,
  ) {
    this.credentials = loadOrCreateCredentials(
      config?.enabled === true ? credentialPath : undefined,
      config?.apiToken ?? config?.token,
      config?.eventToken,
    );
    this.unsubscribe = this.deviceStore.subscribeToStateUpdates(
      (deviceId) => void this.onStateUpdate(deviceId),
    );
  }

  syncDevices(devices: SmartHomeDevice[]): void {
    this.devices.clear();
    devices
      .filter(
        (device) =>
          supportsLocalContext(device) ||
          mapCapabilities(
            device,
            this.deviceStore.getCacheStatesForDevice(device.id),
          ).length > 0,
      )
      .forEach((device) => this.devices.set(device.id, device));
    this.devices.forEach((device) =>
      this.snapshots.set(
        device.id,
        JSON.stringify(this.snapshot(device).state),
      ),
    );
  }

  start(): void {
    if (this.config?.enabled !== true || this.server) {
      return;
    }
    if (
      this.config.host &&
      !['127.0.0.1', 'localhost', '::1'].includes(this.config.host)
    ) {
      this.log.warn(
        `Local Context API ignores non-loopback host "${this.config.host}".`,
      )();
    }
    const host = '127.0.0.1';
    const port = this.config.port ?? 40321;
    this.server = createServer((request, response) => {
      void this.handle(request, response).catch((reason: unknown) => {
        this.log.errorT('Local Context API request failed', reason)();
        if (!response.headersSent) {
          this.error(
            response,
            500,
            'INTERNAL_ERROR',
            'Unexpected Local Context API error.',
          );
        } else {
          response.end();
        }
      });
    });
    this.server.on('error', (error) =>
      this.log.errorT('Local Context API server error', error)(),
    );
    this.server.listen(port, host, () =>
      this.log.info(`Local Context API listening on http://${host}:${port}.`)(),
    );
  }

  stop(): void {
    this.server?.close();
    this.server = undefined;
    this.unsubscribe();
  }

  get address(): AddressInfo | undefined {
    const address = this.server?.address();
    return address && typeof address !== 'string' ? address : undefined;
  }

  async handle(
    request: IncomingMessage,
    response: ServerResponse,
  ): Promise<void> {
    response.setHeader('Cache-Control', 'no-store');
    response.setHeader('X-Content-Type-Options', 'nosniff');
    if (!this.authorized(request)) {
      response.setHeader('WWW-Authenticate', 'Bearer');
      this.error(response, 401, 'UNAUTHORIZED', 'Bearer token is invalid.');
      return;
    }
    const url = new URL(request.url ?? '/', 'http://local-context.invalid');
    const segments = url.pathname.split('/').filter(Boolean);
    if (request.method === 'GET' && url.pathname === '/health') {
      this.json(response, 200, { status: 'ok', apiVersion: API_VERSION });
      return;
    }
    if (request.method === 'GET' && url.pathname === '/v1/info') {
      this.json(response, 200, {
        apiVersion: API_VERSION,
        implementation: 'homebridge-alexa-smarthome-plus',
        implementationVersion: '1.2.0-rc.1',
        scope: ['lock', 'hvac', 'temperature', 'humidity'],
        patchFormat: 'changes',
      });
      return;
    }
    if (request.method === 'GET' && url.pathname === '/v1/context') {
      this.json(response, 200, {
        apiVersion: API_VERSION,
        source: 'homebridge-alexa-smarthome-plus',
        devices: [...this.devices.values()].map((device) =>
          this.serializeDevice(device),
        ),
      });
      return;
    }
    if (request.method === 'GET' && url.pathname === '/v1/devices') {
      this.json(
        response,
        200,
        [...this.devices.values()].map((device) =>
          this.serializeDevice(device),
        ),
      );
      return;
    }
    if (segments[0] === 'v1' && segments[1] === 'devices' && segments[2]) {
      const device = this.devices.get(decodeURIComponent(segments[2]));
      if (!device) {
        this.error(response, 404, 'DEVICE_NOT_FOUND', 'Device not found.');
        return;
      }
      if (request.method === 'GET' && segments.length === 3) {
        this.json(response, 200, this.serializeDevice(device));
        return;
      }
      if (request.method === 'GET' && segments[3] === 'state') {
        this.json(response, 200, this.snapshot(device));
        return;
      }
      if (request.method === 'GET' && segments[3] === 'capabilities') {
        this.json(response, 200, {
          deviceId: device.id,
          capabilities: mapCapabilities(
            device,
            this.deviceStore.getCacheStatesForDevice(device.id),
          ),
        });
        return;
      }
      if (request.method === 'PATCH' && segments[3] === 'state') {
        await this.patchState(device, request, response);
        return;
      }
    }
    this.error(response, 404, 'NOT_FOUND', 'Route not found.');
  }

  private async patchState(
    device: SmartHomeDevice,
    request: IncomingMessage,
    response: ServerResponse,
  ): Promise<void> {
    let body: StatePatchRequest;
    try {
      body = JSON.parse(await this.readBody(request)) as StatePatchRequest;
    } catch (reason) {
      this.error(
        response,
        400,
        'INVALID_JSON',
        'Request body is invalid JSON.',
      );
      return;
    }
    if (typeof body.operationId !== 'string' || !body.operationId.trim()) {
      this.error(
        response,
        400,
        'OPERATION_ID_REQUIRED',
        'operationId is required.',
      );
      return;
    }
    const operationId = body.operationId;
    const controlContext =
      body.controlContext &&
      typeof body.controlContext === 'object' &&
      !Array.isArray(body.controlContext)
        ? body.controlContext
        : {};
    if (!isCommonState(body.changes)) {
      this.error(response, 400, 'INVALID_CHANGES', 'changes is invalid.');
      return;
    }
    const confirmationBaseline = JSON.stringify(this.snapshot(device).state);
    const command = await this.applyState(device, body.changes);
    if (!command.applied) {
      this.json(response, command.status, {
        operationId,
        controlContext,
        applied: false,
        confirmed: false,
        results: command.results,
        error: {
          code: command.error ?? 'NO_CHANGES_APPLIED',
          message: 'No requested field was applied.',
        },
      });
      return;
    }

    this.confirming.add(device.id);
    const appliedChanges: CommonDeviceState = {
      ...(command.results.some(
        ({ field, applied }) => field === 'lockState' && applied,
      )
        ? { lockState: body.changes.lockState }
        : {}),
      ...(command.results.some(
        ({ field, applied }) => field.startsWith('hvac.') && applied,
      )
        ? {
            hvac: {
              ...(command.results.some(
                ({ field, applied }) => field === 'hvac.mode' && applied,
              )
                ? { mode: body.changes.hvac?.mode }
                : {}),
              ...(command.results.some(
                ({ field, applied }) =>
                  field === 'hvac.targetTemperatureC' && applied,
              )
                ? {
                    targetTemperatureC: body.changes.hvac?.targetTemperatureC,
                  }
                : {}),
            },
          }
        : {}),
    };
    const confirmedSnapshot = await this.confirmState(device, appliedChanges);
    this.confirming.delete(device.id);
    const confirmed = confirmedSnapshot !== undefined;
    const partiallyApplied = command.results.some((field) => !field.applied);
    const result = {
      operationId,
      controlContext,
      applied: true,
      confirmed,
      results: command.results.map((field) => ({
        ...field,
        confirmed: field.applied ? confirmed : false,
      })),
      snapshot: confirmedSnapshot ?? this.snapshot(device),
      ...(!confirmed
        ? {
            error: {
              code: 'APPLIED_BUT_UNCONFIRMED',
              message: 'Alexa accepted the change but did not report it back.',
            },
          }
        : partiallyApplied
        ? {
            error: {
              code: 'PARTIALLY_APPLIED',
              message: 'Only some requested fields were applied.',
            },
          }
        : {}),
    };
    if (confirmed) {
      this.suppressedChanges.delete(device.id);
      this.snapshots.set(device.id, JSON.stringify(confirmedSnapshot.state));
      await this.emitEvent(
        device,
        'operation',
        result,
        operationId,
        controlContext,
      );
    } else {
      const externalSnapshot = this.suppressedChanges.get(device.id);
      this.suppressedChanges.delete(device.id);
      const externalState = externalSnapshot
        ? JSON.stringify(externalSnapshot.state)
        : undefined;
      if (
        externalSnapshot &&
        externalState !== undefined &&
        externalState !== confirmationBaseline
      ) {
        this.snapshots.set(device.id, externalState);
        await this.emitEvent(device, 'external-or-unknown', {
          snapshot: externalSnapshot,
        });
      }
    }
    this.json(
      response,
      !confirmed ? 202 : partiallyApplied ? 207 : 200,
      result,
    );
  }

  private async applyState(
    device: SmartHomeDevice,
    state: CommonDeviceState,
  ): Promise<{
    applied: boolean;
    status: number;
    error?: string;
    results: Array<{
      field: string;
      applied: boolean;
      confirmed: boolean;
      error?: { code: string; message: string };
    }>;
  }> {
    const commands: Array<{
      field: string;
      task: ReturnType<AlexaApiWrapper['setDeviceStateGraphQl']>;
    }> = [];
    const results: Array<{
      field: string;
      applied: boolean;
      confirmed: boolean;
      error?: { code: string; message: string };
    }> = [];
    if (state.lockState) {
      results.push({
        field: 'lockState',
        applied: false,
        confirmed: false,
        error: {
          code: 'READ_ONLY_CAPABILITY',
          message: 'Lock state is read-only.',
        },
      });
    }
    if (state.hvac?.mode) {
      if (device.supportedOperations.includes('setThermostatMode')) {
        commands.push({
          field: 'hvac.mode',
          task: this.alexaApi.setDeviceStateGraphQl(
            device.endpointId,
            'thermostat',
            'setThermostatMode',
            { thermostatMode: state.hvac.mode.toUpperCase() },
          ),
        });
      } else {
        results.push({
          field: 'hvac.mode',
          applied: false,
          confirmed: false,
          error: {
            code: 'CAPABILITY_NOT_SUPPORTED',
            message: 'HVAC mode is not supported.',
          },
        });
      }
    }
    if (state.hvac?.targetTemperatureC !== undefined) {
      if (device.supportedOperations.includes('setTargetSetpoint')) {
        commands.push({
          field: 'hvac.targetTemperatureC',
          task: this.alexaApi.setDeviceStateGraphQl(
            device.endpointId,
            'thermostat',
            'setTargetSetpoint',
            {
              targetSetpoint: {
                value: state.hvac.targetTemperatureC.toString(10),
                scale: 'CELSIUS',
              },
            },
          ),
        });
      } else {
        results.push({
          field: 'hvac.targetTemperatureC',
          applied: false,
          confirmed: false,
          error: {
            code: 'CAPABILITY_NOT_SUPPORTED',
            message: 'Target temperature is not supported.',
          },
        });
      }
    }
    for (const { field, task } of commands) {
      const result = await task();
      if (E.isLeft(result)) {
        results.push({
          field,
          applied: false,
          confirmed: false,
          error: {
            code: 'ALEXA_COMMAND_FAILED',
            message: 'Alexa rejected this field change.',
          },
        });
      } else {
        results.push({ field, applied: true, confirmed: false });
      }
    }
    const applied = results.some((result) => result.applied);
    return {
      applied,
      status: applied ? 200 : commands.length > 0 ? 502 : 409,
      error: applied ? undefined : 'NO_CHANGES_APPLIED',
      results,
    };
  }

  private async confirmState(
    device: SmartHomeDevice,
    requested: CommonDeviceState,
  ): Promise<Snapshot | undefined> {
    for (const delay of CONFIRM_DELAYS_MS) {
      if (delay) {
        await new Promise((resolve) => setTimeout(resolve, delay));
      }
      const result = await this.alexaApi.getDeviceStateGraphQl(
        device,
        { UUID: this.serviceUuid(device) },
        false,
      )();
      if (E.isRight(result)) {
        const snapshot = this.snapshot(device);
        if (stateMatches(snapshot.state, requested)) {
          return { ...snapshot, stateConfidence: 'confirmed' };
        }
      }
    }
    return undefined;
  }

  private serviceUuid(device: SmartHomeDevice): string {
    if (device.deviceType === 'SMARTLOCK') {
      return this.service.LockMechanism.UUID;
    }
    if (device.deviceType === 'THERMOSTAT') {
      return this.service.Thermostat.UUID;
    }
    if (device.deviceType === 'HUMIDITY_SENSOR') {
      return this.service.HumiditySensor.UUID;
    }
    return this.service.TemperatureSensor.UUID;
  }

  private serializeDevice(device: SmartHomeDevice) {
    const states = this.deviceStore.getCacheStatesForDevice(device.id);
    return {
      id: device.id,
      name: device.displayName,
      type: device.deviceType,
      enabled: device.enabled,
      capabilities: mapCapabilities(device, states),
      snapshot: this.snapshot(device),
    };
  }

  private snapshot(device: SmartHomeDevice): Snapshot {
    const states = this.deviceStore.getCacheStatesForDevice(device.id);
    const observedAt = this.deviceStore.getLastUpdatedForDevice(device.id);
    const stale =
      !states.length || !this.deviceStore.isDeviceCacheFresh(device.id);
    return {
      deviceId: device.id,
      observedAt: observedAt.toISOString(),
      stale,
      stateConfidence: !states.length ? 'unknown' : 'reported',
      state: mapState(states),
    };
  }

  private async onStateUpdate(deviceId: string): Promise<void> {
    const device = this.devices.get(deviceId);
    if (!device) {
      return;
    }
    const snapshot = this.snapshot(device);
    if (this.confirming.has(deviceId)) {
      this.suppressedChanges.set(deviceId, snapshot);
      return;
    }
    const serialized = JSON.stringify(snapshot.state);
    const previous = this.snapshots.get(deviceId);
    this.snapshots.set(deviceId, serialized);
    if (previous !== undefined && previous !== serialized) {
      await this.emitEvent(device, 'external-or-unknown', { snapshot });
    }
  }

  private async emitEvent(
    device: SmartHomeDevice,
    cause: 'operation' | 'external-or-unknown',
    detail: unknown,
    operationId?: string,
    controlContext?: object,
  ): Promise<void> {
    if (!this.config?.eventUrl || !this.isLoopbackUrl(this.config.eventUrl)) {
      return;
    }
    try {
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), 5_000);
      timeout.unref?.();
      try {
        const eventResponse = await fetch(this.config.eventUrl, {
          method: 'POST',
          signal: controller.signal,
          headers: {
            Authorization: `Bearer ${this.credentials.eventToken}`,
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({
            type: 'device.state.changed',
            cause,
            deviceId: device.id,
            operationId,
            controlContext,
            ...((detail ?? {}) as object),
          }),
        });
        if (!eventResponse.ok) {
          throw new Error(
            `Event endpoint returned HTTP ${eventResponse.status}.`,
          );
        }
      } finally {
        clearTimeout(timeout);
      }
    } catch (reason) {
      this.log.errorT('Local Context API event delivery failed', reason)();
    }
  }

  private isLoopbackUrl(value: string): boolean {
    try {
      const url = new URL(value);
      return (
        ['http:', 'https:'].includes(url.protocol) &&
        ['127.0.0.1', 'localhost', '::1', '[::1]'].includes(url.hostname)
      );
    } catch {
      return false;
    }
  }

  private authorized(request: IncomingMessage): boolean {
    const expected = Buffer.from(this.credentials.apiToken);
    const authorization = request.headers.authorization ?? '';
    const supplied = Buffer.from(
      authorization.startsWith('Bearer ') ? authorization.slice(7) : '',
    );
    return (
      expected.length === supplied.length && timingSafeEqual(expected, supplied)
    );
  }

  private readBody(request: IncomingMessage): Promise<string> {
    return new Promise((resolve, reject) => {
      let size = 0;
      const chunks: Buffer[] = [];
      request.on('data', (chunk: Buffer) => {
        size += chunk.length;
        if (size > MAX_BODY_BYTES) {
          reject(new Error('request_too_large'));
          request.destroy();
          return;
        }
        chunks.push(chunk);
      });
      request.on('end', () => resolve(Buffer.concat(chunks).toString('utf8')));
      request.on('error', reject);
    });
  }

  private json(response: ServerResponse, status: number, body: unknown): void {
    response.statusCode = status;
    response.setHeader('Content-Type', 'application/json; charset=utf-8');
    response.end(JSON.stringify(body));
  }

  private error(
    response: ServerResponse,
    status: number,
    code: string,
    message: string,
  ): void {
    this.json(response, status, { error: { code, message } });
  }
}

const isCommonState = (value: unknown): value is CommonDeviceState => {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    return false;
  }
  const state = value as CommonDeviceState;
  return (
    state.lockState !== undefined ||
    state.hvac?.mode !== undefined ||
    state.hvac?.targetTemperatureC !== undefined
  );
};
