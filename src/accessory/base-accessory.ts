import * as A from 'fp-ts/Array';
import * as E from 'fp-ts/Either';
import * as IO from 'fp-ts/IO';
import * as O from 'fp-ts/Option';
import { Option } from 'fp-ts/Option';
import * as TE from 'fp-ts/TaskEither';
import { TaskEither } from 'fp-ts/TaskEither';
import { identity, pipe } from 'fp-ts/lib/function';
import { Characteristic, Perms, PlatformAccessory, Service } from 'homebridge';
import { match } from 'ts-pattern';
import { CapabilityState } from '../domain/alexa';
import { AlexaApiError, InvalidResponse } from '../domain/alexa/errors';
import { SmartHomeDevice } from '../domain/alexa/get-devices';
import { RangeFeatures } from '../domain/alexa/save-device-capabilities';
import { AlexaSmartHomePlatform } from '../platform';
import { PluginLogLevel, PluginLogger } from '../util/plugin-logger';

export default abstract class BaseAccessory {
  public readonly Service: typeof Service = this.platform.Service;

  public readonly Characteristic: typeof Characteristic =
    this.platform.Characteristic;

  readonly log: PluginLogger;

  _initialized = false;
  readonly rangeFeatures: RangeFeatures;

  private lastUpdated: Date;
  private consecutivePeriodicRefreshFailures = 0;
  private initialPeriodicRefreshStaggerMs = 0;
  private periodicRefreshGeneration = 0;
  private periodicRefreshStep = 0;
  private periodicRefreshTimer?: NodeJS.Timeout;
  private stateRefreshListenersInstalled = false;

  private static readonly PERIODIC_REFRESH_INITIAL_DELAYS_MS = [
    10_000, 5_000, 15_000, 30_000, 120_000, 120_000, 300_000, 300_000,
  ] as const;

  private static readonly DEFAULT_PERIODIC_REFRESH_INTERVAL_MINUTES = 5;
  private static readonly MAX_PERIODIC_REFRESH_BACKOFF_MS = 60 * 60_000;

  constructor(
    readonly platform: AlexaSmartHomePlatform,
    public readonly device: SmartHomeDevice,
    public readonly platformAcc: PlatformAccessory,
  ) {
    this.log = platform.log;
    this.addAccessoryInfoService();
    this.rangeFeatures = this.platform.deviceStore.getRangeFeaturesForDevice(
      this.device.id,
    );
    this.lastUpdated = new Date(0);
  }

  logWithContext(
    logLevel: PluginLogLevel | 'errorT',
    message: string,
    e?: unknown,
  ): void {
    return this._logWithContext(logLevel, message, e)();
  }

  private _logWithContext(
    logLevel: PluginLogLevel | 'errorT',
    message: string,
    e?: unknown,
  ): IO.IO<void> {
    const msgAndContext = `${this.device.displayName} - ${message}`;
    return match(logLevel)
      .with('errorT', () => this.log.errorT(msgAndContext, e))
      .otherwise((logLevel: PluginLogLevel) =>
        this.log[logLevel](msgAndContext),
      );
  }

  getInitialized() {
    return this._initialized;
  }

  setInitialized(initialized: boolean) {
    this._initialized = initialized;
  }

  startPeriodicStateRefresh(staggerMs = 0): void {
    if (this.platform.config.performance?.periodicStateRefresh === false) {
      return;
    }

    if (!this.stateRefreshListenersInstalled) {
      this.service.characteristics
        .filter((characteristic) =>
          characteristic.props.perms.includes(Perms.PAIRED_WRITE),
        )
        .forEach((characteristic) =>
          characteristic.on('change', ({ reason }) => {
            if (reason === 'write') {
              this.restartPeriodicStateRefresh();
            }
          }),
        );
      this.stateRefreshListenersInstalled = true;
    }

    this.initialPeriodicRefreshStaggerMs = Math.max(0, staggerMs);
    this.restartPeriodicStateRefresh(this.initialPeriodicRefreshStaggerMs);
  }

  stopPeriodicStateRefresh(): void {
    this.periodicRefreshGeneration += 1;
    if (this.periodicRefreshTimer) {
      clearTimeout(this.periodicRefreshTimer);
      this.periodicRefreshTimer = undefined;
    }
  }

  private restartPeriodicStateRefresh(staggerMs = 0): void {
    this.stopPeriodicStateRefresh();
    this.consecutivePeriodicRefreshFailures = 0;
    this.periodicRefreshStep = 0;
    this.scheduleNextPeriodicStateRefresh(staggerMs);
  }

  private scheduleNextPeriodicStateRefresh(staggerMs = 0): void {
    const generation = this.periodicRefreshGeneration;
    const initialDelay =
      BaseAccessory.PERIODIC_REFRESH_INITIAL_DELAYS_MS[
        this.periodicRefreshStep
      ];
    const steadyIntervalMs = this.getPeriodicRefreshIntervalMs();
    const baseDelay = initialDelay ?? steadyIntervalMs;
    const backoffDelay =
      this.consecutivePeriodicRefreshFailures > 0
        ? Math.min(
            steadyIntervalMs * 2 ** this.consecutivePeriodicRefreshFailures,
            BaseAccessory.MAX_PERIODIC_REFRESH_BACKOFF_MS,
          )
        : 0;
    const delay = Math.max(baseDelay, backoffDelay) + staggerMs;

    this.periodicRefreshTimer = setTimeout(() => {
      void this.refreshStateFromAlexa()
        .then((succeeded) => {
          this.consecutivePeriodicRefreshFailures = succeeded
            ? 0
            : this.consecutivePeriodicRefreshFailures + 1;
        })
        .catch((error: unknown) => {
          this.consecutivePeriodicRefreshFailures += 1;
          this.logWithContext(
            'debug',
            `Unexpected periodic state refresh error: ${String(error)}`,
          );
        })
        .finally(() => {
          if (generation !== this.periodicRefreshGeneration) {
            return;
          }
          this.periodicRefreshStep += 1;
          this.scheduleNextPeriodicStateRefresh();
        });
    }, delay);
    this.periodicRefreshTimer.unref?.();
  }

  private getPeriodicRefreshIntervalMs(): number {
    const configuredMinutes =
      this.platform.config.performance?.periodicStateRefreshIntervalMinutes ??
      BaseAccessory.DEFAULT_PERIODIC_REFRESH_INTERVAL_MINUTES;
    return Math.max(1, configuredMinutes) * 60_000;
  }

  private async refreshStateFromAlexa(): Promise<boolean> {
    const result = await this.platform.alexaApi.getDeviceStateGraphQl(
      this.device,
      this.service,
      false,
    )();

    if (E.isLeft(result)) {
      this.logWithContext(
        'debug',
        'Periodic state refresh failed',
        result.left,
      );
      return false;
    }

    this.lastUpdated = new Date();
    for (const characteristic of this.service.characteristics) {
      if (!characteristic.props.perms.includes(Perms.PAIRED_READ)) {
        continue;
      }
      const value = await characteristic.handleGetRequest();
      if (value !== null && value !== undefined) {
        characteristic.updateValue(value);
      }
    }
    this.logWithContext('debug', 'Periodic state refresh completed');
    return true;
  }

  addAccessoryInfoService() {
    const service =
      this.platformAcc.getService(this.Service.AccessoryInformation) ||
      this.platformAcc.addService(this.Service.AccessoryInformation);

    service
      .setCharacteristic(
        this.Characteristic.Manufacturer,
        this.device.manufacturer,
      )
      .setCharacteristic(
        this.Characteristic.SerialNumber,
        this.device.serialNumber,
      )
      .setCharacteristic(this.Characteristic.Name, this.device.displayName)
      .setCharacteristic(
        this.Characteristic.ConfiguredName,
        this.device.displayName,
      )
      .setCharacteristic(
        this.Characteristic.Model,
        this.device.model.length > 1 ? this.device.model : 'Unknown',
      );
  }

  configureStatusActive() {
    return pipe(
      this.platformAcc.services,
      A.map((s) => {
        !s.testCharacteristic(this.Characteristic.StatusActive) &&
          s.addOptionalCharacteristic(this.Characteristic.StatusActive);
        s.getCharacteristic(this.Characteristic.StatusActive).onGet(
          () => this.device.enabled,
        );
      }),
    );
  }

  getStateGraphQl<S, C>(
    toCharacteristicStateFn: (fa: S[]) => Option<C>,
  ): TaskEither<AlexaApiError, C> {
    const useCache =
      new Date().getTime() - this.lastUpdated.getTime() <
      this.platform.deviceStore.cacheTTL;
    return pipe(
      <TE.TaskEither<AlexaApiError, [boolean, S[]]>>(
        this.platform.alexaApi.getDeviceStateGraphQl(
          this.device,
          this.service,
          useCache,
        )
      ),
      TE.map(([fromCache, states]) => {
        if (!fromCache) {
          this.lastUpdated = new Date();
        }
        return states;
      }),
      TE.flatMapOption(
        toCharacteristicStateFn,
        () => new InvalidResponse('State not available'),
      ),
    );
  }

  getCacheValue(
    featureName: CapabilityState['featureName'],
    name?: CapabilityState['name'],
    instance?: CapabilityState['instance'],
  ): Option<CapabilityState['value']> {
    return pipe(
      this.platform.deviceStore.getCacheValue(this.device.id, {
        featureName,
        name,
        instance,
      }),
      O.flatMap(({ value }) => O.fromNullable(value)),
    );
  }

  updateCacheValue(newState: CapabilityState) {
    return this.platform.deviceStore.updateCacheValue(this.device.id, newState);
  }

  getHapValue(characteristic: Parameters<Service['getCharacteristic']>[0]) {
    return this.service.getCharacteristic(characteristic)?.value ?? null;
  }

  removeCharacteristic(
    char: Parameters<Service['testCharacteristic']>[0] &
      Parameters<Service['getCharacteristic']>[0],
  ) {
    if (this.service.testCharacteristic(char)) {
      this.service.removeCharacteristic(this.service.getCharacteristic(char)!);
    }
  }

  get serviceCommunicationError() {
    this.logWithContext('debug', 'Service communication error');
    return new this.platform.HAP.HapStatusError(
      this.platform.HAP.HAPStatus.SERVICE_COMMUNICATION_FAILURE,
    );
  }

  get readOnlyError() {
    this.logWithContext('debug', 'Read only error');
    return new this.platform.HAP.HapStatusError(
      this.platform.HAP.HAPStatus.READ_ONLY_CHARACTERISTIC,
    );
  }

  get notAllowedError() {
    this.logWithContext('debug', 'Not allowed error');
    return new this.platform.HAP.HapStatusError(
      this.platform.HAP.HAPStatus.NOT_ALLOWED_IN_CURRENT_STATE,
    );
  }

  get invalidValueError() {
    this.logWithContext('debug', 'Invalid value error');
    return new this.platform.HAP.HapStatusError(
      this.platform.HAP.HAPStatus.INVALID_VALUE_IN_REQUEST,
    );
  }

  private extractStates<T>(maybeStates: Option<CapabilityState>[]): T[] {
    return pipe(maybeStates as Option<T>[], A.filterMap(identity));
  }

  abstract configureServices(): void;
  abstract service: Service;
  abstract isExternalAccessory: boolean;
}
