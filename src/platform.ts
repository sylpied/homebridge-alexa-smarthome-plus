import AlexaRemote, { type InitOptions } from 'alexa-remote2';
import * as A from 'fp-ts/Array';
import * as E from 'fp-ts/Either';
import * as IO from 'fp-ts/IO';
import * as IOE from 'fp-ts/IOEither';
import { IOEither } from 'fp-ts/IOEither';
import * as J from 'fp-ts/Json';
import * as O from 'fp-ts/Option';
import { Option } from 'fp-ts/Option';
import * as TE from 'fp-ts/TaskEither';
import { constVoid, constant, flow, identity, pipe } from 'fp-ts/lib/function';
import fs from 'fs';
import {
  API,
  Characteristic,
  DynamicPlatformPlugin,
  Logger,
  type MatterAccessory,
  PlatformAccessory,
  PlatformConfig,
  Service,
} from 'homebridge';
import AccessoryFactory from './accessory/accessory-factory';
import BaseAccessory from './accessory/base-accessory';
import RoutineAccessory from './accessory/routine-accessory';
import { AlexaDeviceError, AlexaError, HttpError } from './domain/alexa/errors';
import { SmartHomeDevice } from './domain/alexa/get-devices';
import { AlexaRoutine } from './domain/alexa/routine';
import { AlexaPlatformConfig } from './domain/homebridge';
import { mapAlexaDeviceToHomeKitAccessoryInfos } from './mapper';
import { LocalContextServer } from './local-context/local-context-server';
import { AlexaMatterBridge } from './matter/matter-bridge';
import * as settings from './settings';
import DeviceStore from './store/device-store';
import * as util from './util';
import { getOrElse } from './util/fp-util';
import { PluginLogger } from './util/plugin-logger';
import { AlexaApiWrapper } from './wrapper/alexa-api-wrapper';

export class AlexaSmartHomePlatform implements DynamicPlatformPlugin {
  public readonly HAP: API['hap'] = this.api.hap;

  public readonly Service: typeof Service = this.api.hap.Service;
  public readonly Characteristic: typeof Characteristic =
    this.api.hap.Characteristic;

  public readonly log: PluginLogger;
  public readonly config: AlexaPlatformConfig;
  public readonly alexaRemote: AlexaRemote;
  public readonly alexaApi: AlexaApiWrapper;
  public readonly deviceStore: DeviceStore;
  public readonly matterBridge: AlexaMatterBridge;
  public readonly localContextServer: LocalContextServer;

  public cachedAccessories: PlatformAccessory[] = [];
  public accessoryHandlers: BaseAccessory[] = [];
  public activeDeviceIds: string[] = [];

  private readonly cookiePersistPath: string;
  private cookieListenerRegistered = false;

  constructor(
    readonly logger: Logger,
    config: PlatformConfig,
    public readonly api: API,
  ) {
    this.log = new PluginLogger(logger, config);

    if (util.validateConfig(config)) {
      const formattedClientHost = config.auth.proxy.clientHost
        .replace(/^https?:\/\//, '')
        .toLowerCase();
      config.auth.proxy.clientHost = formattedClientHost;
      if (
        formattedClientHost.includes('/') ||
        formattedClientHost.includes(':')
      ) {
        pipe(
          this.log.error(
            `Invalid proxy client host provided: ${formattedClientHost}. The host should not include a port number or a slash (/).`,
          ),
          IO.flatMap(() =>
            this.log.error(
              'Examples of correct hosts: 192.168.1.100, homebridge-vm.local',
            ),
          ),
        )();
        return;
      }
      this.config = config;
    } else {
      this.log.error(
        'Missing configuration for this plugin to work, see the documentation for initial setup.',
      )();
      return;
    }

    this.cookiePersistPath = `${api.user.persistPath()}/.${
      settings.PLUGIN_NAME
    }`;
    this.alexaRemote = Object.assign(new AlexaRemote(), {
      // alexa-remote2 otherwise resolves its own unpatched registry copy.
      // eslint-disable-next-line @typescript-eslint/no-var-requires
      alexaCookie: require('alexa-cookie2'),
    });
    this.deviceStore = new DeviceStore(this.config.performance);
    this.alexaApi = new AlexaApiWrapper(
      this.Service,
      this.alexaRemote,
      this.log,
      this.deviceStore,
    );
    this.matterBridge = new AlexaMatterBridge(
      this.api,
      this.alexaApi,
      this.deviceStore,
      this.Service,
      this.log,
    );
    this.localContextServer = new LocalContextServer(
      this.config.localContext,
      this.alexaApi,
      this.deviceStore,
      this.Service,
      this.log,
      `${api.user.persistPath()}/.${settings.PLUGIN_NAME}-local-context.json`,
    );
    this.log.info(
      `Periodic Alexa state refresh: ${
        this.config.performance?.periodicStateRefresh === false
          ? 'disabled'
          : 'enabled'
      }.`,
    )();

    const handleAuthResult = flow(
      O.match(
        () => {
          this.alexaRemote.cookie;
          return this.log.debug('Successfully authenticated Alexa account.');
        },
        (e: Error) =>
          this.log.errorT('Failed to initialize connection to Alexa.', e),
      ),
    );

    let connectionStarted = false;
    let stopped = false;
    const connect = () => {
      if (connectionStarted || stopped) {
        return;
      }
      connectionStarted = true;
      this.initAlexaRemote((maybeError) => {
        if (stopped) {
          this.alexaRemote.stop?.();
          return;
        }
        if (O.isSome(maybeError)) {
          connectionStarted = false;
          handleAuthResult(maybeError)();
          return;
        }
        pipe(
          TE.rightIO(handleAuthResult(maybeError)),
          TE.flatMap(this.findDevices.bind(this)),
          TE.tapIO((devices) => () => {
            this.localContextServer.syncDevices(devices);
            this.localContextServer.start();
          }),
          TE.tap((devices: SmartHomeDevice[]) =>
            this.syncMatterDevices(devices),
          ),
          TE.flatMap(this.initDevices.bind(this)),
          TE.flatMap((deviceAccessories) =>
            pipe(
              this.initRoutines(),
              TE.map((routineAccessories) => [
                ...deviceAccessories,
                ...routineAccessories,
              ]),
            ),
          ),
          TE.flatMapIO(this.findStaleAccessories.bind(this)),
        )().then(
          E.match(
            (e) => this.log.errorT('After initialization', e)(),
            this.unregisterStaleAccessories.bind(this),
          ),
        );
      });
    };
    const authenticationChanged = () => {
      if (!connectionStarted && fs.existsSync(this.cookiePersistPath)) {
        connect();
      }
    };
    api.on('didFinishLaunching', () => {
      fs.watchFile(
        this.cookiePersistPath,
        { interval: 2000, persistent: false },
        authenticationChanged,
      );
      connect();
    });

    api.on('shutdown', () => {
      stopped = true;
      fs.unwatchFile(this.cookiePersistPath, authenticationChanged);
      this.accessoryHandlers.forEach((accessory) =>
        accessory.stopPeriodicStateRefresh(),
      );
      this.matterBridge?.stop();
      this.localContextServer?.stop();
      this.alexaRemote.stop?.();
    });
  }

  configureAccessory(accessory: PlatformAccessory) {
    this.log.debug('Loading accessory from cache:', accessory.displayName)();
    this.cachedAccessories.push(accessory);
  }

  configureMatterAccessory(accessory: MatterAccessory): void {
    this.log.debug(
      'Loading Matter accessory from cache:',
      accessory.displayName,
    )();
    this.matterBridge?.configureAccessory(accessory);
  }

  private syncMatterDevices(
    devices: SmartHomeDevice[],
  ): TE.TaskEither<never, void> {
    return TE.fromTask(async () => {
      try {
        await this.matterBridge.syncDevices(
          devices.map((device) => this.prepareDevice(device)),
        );
      } catch (reason) {
        this.log.errorT(
          'Matter accessories were skipped; HomeKit initialization will continue.',
          new HttpError(
            `Matter initialization failed. Reason: ${String(reason)}`,
          ),
        )();
      }
    });
  }

  initAlexaRemote(callback: (error: Option<Error>) => void) {
    if (!this.cookieListenerRegistered) {
      this.cookieListenerRegistered = true;
      this.alexaRemote.on('cookie', () => {
        const cookieData = this.alexaRemote.cookieData;
        if (util.isValidAuthentication(cookieData as unknown as J.Json)) {
          this.log.debug(
            'Alexa login cookie updated. Storing cookie in file:',
            this.cookiePersistPath,
          )();
          const temporaryPath = `${this.cookiePersistPath}.${process.pid}.tmp`;
          try {
            fs.writeFileSync(temporaryPath, JSON.stringify({ cookieData }), {
              mode: 0o600,
            });
            fs.renameSync(temporaryPath, this.cookiePersistPath);
            fs.chmodSync(this.cookiePersistPath, 0o600);
          } finally {
            fs.rmSync(temporaryPath, { force: true });
          }
        }
      });
    }

    const logStoredAuthErrors = O.match(
      () => {
        this.log.debug(
          'Login required because existing authentication not found',
        )();
        return undefined;
      },
      (e) => {
        this.log.errorT('Error trying to retrieve stored authentication', e)();
        return undefined;
      },
    );

    const amazonDomain =
      this.config.amazonDomain ?? settings.DEFAULT_AMAZON_DOMAIN;
    pipe(
      util.getAuthentication(this.cookiePersistPath),
      IOE.match(logStoredAuthErrors, identity),
      IO.map((auth) => {
        if (!auth) {
          callback(
            O.of(
              new Error(
                'Alexa authentication is required. Open the plugin settings to authenticate.',
              ),
            ),
          );
          return;
        }

        // Prefer the marketplace from saved cookie data over the config.
        const effectiveDomain =
          auth?.amazonPage && auth.amazonPage !== amazonDomain
            ? (this.log.debug(
                `amazonPage corrected: "${amazonDomain}" → "${auth?.amazonPage}"`,
              ),
              auth.amazonPage)
            : amazonDomain;

        return this.alexaRemote.init(
          {
            acceptLanguage:
              this.config.language ?? settings.DEFAULT_ACCEPT_LANG,
            alexaServiceHost: `alexa.${effectiveDomain}`,
            amazonPage: effectiveDomain,
            amazonPageProxyLanguage:
              this.config.language?.replace('-', '_') ??
              settings.DEFAULT_PROXY_PAGE_LANG,
            formerRegistrationData: auth,
            cookieRefreshInterval:
              (this.config.auth.refreshInterval ??
                settings.DEFAULT_REFRESH_INTERVAL_DAYS) *
              settings.ONE_DAY_MILLIS,
            cookie: auth?.localCookie,
            deviceAppName: 'Homebridge',
            allowInteractiveLogin: false,
            macDms: auth?.macDms,
            proxyOwnIp: this.config.auth.proxy.clientHost,
            proxyPort: this.config.auth.proxy.port,
            // alexa-remote2 may include cookies, tokens, headers, account data,
            // or complete response bodies in diagnostic messages. Runtime
            // logging is intentionally limited to messages created here.
            logger: () => undefined,
            proxyLogLevel: 'error',
            usePushConnectType: 3,
            useWsMqtt: false,
          } as InitOptions,
          (error) => {
            pipe(
              O.fromNullable(error),
              O.match(
                () => callback(O.none),
                (e) => {
                  if (
                    this.config.auth.reauthenticateOnFailure !== false &&
                    util.isAuthenticationFailure(e)
                  ) {
                    this.log.warn(
                      'Stored Alexa authentication has expired and was removed. Open the plugin settings to authenticate again.',
                    )();
                    fs.rmSync(this.cookiePersistPath, { force: true });
                  }
                  callback(O.of(e));
                },
              ),
            );
          },
        );
      }),
    )();
  }

  findDevices(): TE.TaskEither<AlexaError, SmartHomeDevice[]> {
    const filterMode =
      this.config.deviceFilterMode ??
      (this.config.devices?.length
        ? 'include'
        : this.config.excludeDevices?.length
        ? 'exclude'
        : 'all');
    const deviceFilter = pipe(
      O.fromNullable(filterMode === 'include' ? this.config.devices : []),
      O.map(A.map((d) => d.trim())),
      O.getOrElse(constant(new Array<string>())),
    );
    const excludeDevices = pipe(
      O.fromNullable(
        filterMode === 'exclude' ? this.config.excludeDevices : [],
      ),
      O.map(A.map((d) => d.trim())),
      O.getOrElse(constant(new Array<string>())),
    );
    const deviceIds =
      filterMode === 'include'
        ? this.config.deviceIds?.map((id) => id.trim()) ?? []
        : [];
    const excludeDeviceIds =
      filterMode === 'exclude'
        ? this.config.excludeDeviceIds?.map((id) => id.trim()) ?? []
        : [];
    const configuredFilterCount =
      filterMode === 'include' && deviceIds.length > 0
        ? deviceIds.length
        : filterMode === 'exclude' && excludeDeviceIds.length > 0
        ? excludeDeviceIds.length
        : deviceFilter.length;
    return pipe(
      this.alexaApi.getDevices(),
      TE.tapIO((devices) =>
        this.log.debug(
          `Found ${devices.length} devices connected to the current Alexa account.`,
        ),
      ),
      TE.tap((devices) =>
        pipe(
          devices,
          util.stringifyJson,
          TE.fromEither,
          TE.tapIO((json) =>
            this.log.debug(
              `BEGIN devices connected to Alexa account\n\n ${json}\n\nEND devices connected to Alexa account`,
            ),
          ),
        ),
      ),
      TE.map(
        A.filter((d: SmartHomeDevice) =>
          filterMode === 'include'
            ? deviceIds.length > 0
              ? deviceIds.includes(d.id)
              : deviceFilter.includes(d.displayName.trim())
            : filterMode === 'exclude'
            ? excludeDeviceIds.length > 0
              ? !excludeDeviceIds.includes(d.id)
              : !excludeDevices.includes(d.displayName.trim())
            : true,
        ),
      ),
      TE.tapIO((devices) =>
        devices.length === configuredFilterCount || configuredFilterCount === 0
          ? this.log.debug(`Discovered ${configuredFilterCount} devices.`)
          : this.log.warn(
              `${configuredFilterCount} devices provided in settings but ${devices.length} matching ` +
                'Alexa smart home devices were discovered.',
            ),
      ),
    );
  }

  initDevices(
    devices: SmartHomeDevice[],
  ): TE.TaskEither<AlexaError | void, BaseAccessory[]> {
    const initUserConfiguredDevices = flow(
      A.map(flow(this.initAccessories.bind(this), IO.FromIO.fromIO)),
      A.map(
        IO.flatMap(
          E.match(
            (e) => IO.as(this.log.errorT('Initialize Devices', e), O.none),
            (acc) => IO.of(O.of(acc)),
          ),
        ),
      ),
      A.traverse(IO.Applicative)(identity),
    );

    return pipe(
      TE.of(devices),
      TE.flatMapIO(initUserConfiguredDevices),
      TE.map(flow(A.filterMap(identity), A.flatten)),
      TE.tapIO((accessories) => () => {
        this.accessoryHandlers = accessories;
        accessories.forEach((accessory, index) =>
          accessory.startPeriodicStateRefresh(index * 1_000),
        );
      }),
    );
  }

  private initRoutines(): TE.TaskEither<AlexaError, RoutineAccessory[]> {
    const configuredNames =
      this.config.routines?.names?.map((name) => name.trim()) ?? [];

    if (configuredNames.length === 0) {
      return TE.right([]);
    }

    const executionDevice =
      this.config.routines?.executionDevice?.trim() ||
      Object.values(this.alexaRemote.serialNumbers).find(
        ({ online, isControllable }) => online && isControllable,
      )?.serialNumber ||
      Object.values(this.alexaRemote.serialNumbers)[0]?.serialNumber;

    if (!executionDevice) {
      return TE.left(
        new HttpError(
          'No Echo device is available to execute configured Alexa routines.',
        ),
      );
    }

    return pipe(
      this.alexaApi.getAutomationRoutines(),
      TE.map((routines) => {
        const selectedRoutines = routines.filter((routine) =>
          configuredNames.includes(routine.name.trim()),
        );
        const discoveredNames = new Set(
          selectedRoutines.map(({ name }) => name.trim()),
        );

        configuredNames
          .filter((name) => !discoveredNames.has(name))
          .forEach((name) =>
            this.log.warn('Configured Alexa routine was not found:', name)(),
          );

        return selectedRoutines.map((routine) =>
          this.createRoutineAccessory(routine, executionDevice),
        );
      }),
    );
  }

  private createRoutineAccessory(
    routine: AlexaRoutine,
    executionDevice: string,
  ): RoutineAccessory {
    const uuid = this.HAP.uuid.generate(
      `alexa-routine:${routine.automationId}`,
    );
    const cachedAccessory = this.cachedAccessories.find(
      (accessory) => accessory.UUID === uuid,
    );
    const platformAcc =
      cachedAccessory ?? new this.api.platformAccessory(routine.name, uuid);

    platformAcc.context = {
      ...platformAcc.context,
      deviceId: `routine:${routine.automationId}`,
      deviceType: 'ALEXA_ROUTINE',
      homebridgeDeviceType: this.Service.Switch.UUID,
    };

    if (!cachedAccessory) {
      this.api.registerPlatformAccessories(
        settings.PLUGIN_NAME,
        settings.PLATFORM_NAME,
        [platformAcc],
      );
      this.log.info('Added Alexa routine:', routine.name)();
    } else {
      this.log.debug('Restored Alexa routine:', routine.name)();
    }

    return new RoutineAccessory(
      this,
      platformAcc,
      routine,
      executionDevice,
      this.config.routines?.resetDelayMs ?? 500,
    );
  }

  initAccessories(
    device: SmartHomeDevice,
  ): IOEither<AlexaDeviceError, BaseAccessory[]> {
    return pipe(
      E.bindTo('entityId')(util.extractEntityId(device.id)),
      E.bind('hbAccessories', ({ entityId }) =>
        mapAlexaDeviceToHomeKitAccessoryInfos(this, entityId, device),
      ),
      E.map(({ entityId, hbAccessories }) =>
        pipe(
          hbAccessories,
          A.map((hbAcc) => ({
            ...hbAcc,
            entityId,
            maybeCachedAcc: pipe(
              this.cachedAccessories,
              A.findFirst(
                ({ UUID: cachedUuid, context }) =>
                  cachedUuid === hbAcc.uuid &&
                  context.deviceType === device.deviceType &&
                  (context.homebridgeDeviceType ?? hbAcc.deviceType) ===
                    hbAcc.deviceType,
              ),
            ),
          })),
        ),
      ),
      IOE.fromEither,
      IOE.tap(this.logDeviceInfo(device)),
      IOE.flatMap((hkDevices) =>
        pipe(
          hkDevices,
          A.traverse(IOE.ApplicativeSeq)((hbAcc) => {
            const newDevice = this.prepareDevice(
              device,
              getOrElse(hbAcc.altDeviceName, constant(device.displayName)),
            );
            return pipe(
              O.bindTo('platAcc')(hbAcc.maybeCachedAcc),
              O.fold(
                () =>
                  this.addNewAccessory(newDevice, hbAcc.deviceType, hbAcc.uuid),
                ({ platAcc }) =>
                  this.restoreExistingAccessory(
                    newDevice,
                    hbAcc.deviceType,
                    platAcc,
                  ),
              ),
            );
          }),
        ),
      ),
    );
  }

  private prepareDevice(
    device: SmartHomeDevice,
    alternateName = device.displayName,
  ): SmartHomeDevice {
    const disabled =
      this.config.disabledOperations
        ?.find(
          ({ deviceName }) => deviceName.trim() === device.displayName.trim(),
        )
        ?.operations?.split(',')
        .map((operation) => operation.trim())
        .filter(Boolean) ?? [];

    return {
      ...device,
      displayName: util.resolveHomeKitDeviceName(
        device.displayName,
        alternateName,
        this.config.deviceAliases,
      ),
      supportedOperations: device.supportedOperations.filter(
        (operation) => !disabled.includes(operation),
      ),
    };
  }

  private restoreExistingAccessory(
    device: SmartHomeDevice,
    hbDeviceType: string,
    acc: PlatformAccessory,
  ): IOEither<AlexaDeviceError, BaseAccessory> {
    if (
      !acc.context?.deviceId ||
      !acc.context?.deviceType ||
      !acc.context?.homebridgeDeviceType
    ) {
      this.log.debug('Update accessory context:', acc.displayName)();
      acc.context = {
        ...acc.context,
        deviceId: device.id,
        deviceType: device.deviceType,
        homebridgeDeviceType: hbDeviceType,
      };
      this.api.updatePlatformAccessories([acc]);
    }
    return pipe(
      IOE.Do,
      IOE.flatMapEither(() =>
        AccessoryFactory.createAccessory(this, acc, device, hbDeviceType),
      ),
      IOE.tapIO(() =>
        this.log.debug(
          'Restored existing accessory from cache:',
          device.displayName,
        ),
      ),
      IOE.tapIO(() => this.logAccessoryMapping(device, hbDeviceType)),
      IOE.tapEither(() => {
        this.activeDeviceIds.push(device.id);
        return E.of(constVoid());
      }),
    );
  }

  private addNewAccessory(
    device: SmartHomeDevice,
    hbDeviceType: string,
    uuid: string,
  ): IOEither<AlexaDeviceError, BaseAccessory> {
    const platAcc = new this.api.platformAccessory(device.displayName, uuid);
    platAcc.context = {
      ...platAcc.context,
      deviceId: device.id,
      deviceType: device.deviceType,
      homebridgeDeviceType: hbDeviceType,
    };

    return pipe(
      IOE.Do,
      IOE.flatMapEither(() =>
        AccessoryFactory.createAccessory(this, platAcc, device, hbDeviceType),
      ),
      IOE.tapIO(() => this.log.info('Added accessory:', device.displayName)),
      IOE.tapIO(() => this.logAccessoryMapping(device, hbDeviceType)),
      IOE.tapEither((acc) => {
        acc.isExternalAccessory
          ? this.api.publishExternalAccessories(settings.PLUGIN_NAME, [platAcc])
          : this.api.registerPlatformAccessories(
              settings.PLUGIN_NAME,
              settings.PLATFORM_NAME,
              [platAcc],
            );
        this.activeDeviceIds.push(device.id);
        return E.of(constVoid());
      }),
    );
  }

  private logAccessoryMapping(
    device: SmartHomeDevice,
    homeKitDeviceType: string,
  ): IO.IO<void> {
    const homeKitType =
      [
        [this.Service.Lightbulb.UUID, 'Lightbulb'],
        [this.Service.Switch.UUID, 'Switch'],
        [this.Service.Fanv2.UUID, 'Fan'],
        [this.Service.LockMechanism.UUID, 'Lock'],
        [this.Service.Outlet.UUID, 'Outlet'],
        [this.Service.Thermostat.UUID, 'Thermostat'],
        [this.Service.AirQualitySensor.UUID, 'AirQualitySensor'],
        [this.Service.CarbonMonoxideSensor.UUID, 'CarbonMonoxideSensor'],
        [this.Service.HumiditySensor.UUID, 'HumiditySensor'],
        [this.Service.TemperatureSensor.UUID, 'TemperatureSensor'],
      ].find(([uuid]) => uuid === homeKitDeviceType)?.[1] ?? 'Unknown';
    const operations = device.supportedOperations.length
      ? device.supportedOperations.join(', ')
      : 'read-only';
    return this.log.info(
      `Mapped "${device.displayName}": Alexa ${device.deviceType} → HomeKit ${homeKitType} (operations: ${operations})`,
    );
  }

  private findStaleAccessories(
    activeAccessories: Array<{ platformAcc: PlatformAccessory }>,
  ): IO.IO<PlatformAccessory[]> {
    return pipe(
      IO.of(
        A.Functor.map(activeAccessories, ({ platformAcc: { UUID } }) => UUID),
      ),
      IO.map((activeAccessoryIds) =>
        A.Filterable.filter(
          this.cachedAccessories,
          ({ UUID }) => !activeAccessoryIds.includes(UUID),
        ),
      ),
    );
  }

  private unregisterStaleAccessories(
    staleAccessories: PlatformAccessory[],
  ): void {
    staleAccessories.forEach((staleAccessory) => {
      this.log.info(
        `Removing stale cached accessory ${staleAccessory.UUID} ${staleAccessory.displayName}`,
      )();
    });

    if (staleAccessories.length) {
      this.api.unregisterPlatformAccessories(
        settings.PLUGIN_NAME,
        settings.PLATFORM_NAME,
        staleAccessories,
      );
    }
  }

  private logDeviceInfo(device: SmartHomeDevice) {
    return () =>
      pipe(
        IOE.bindTo('deviceJson')(IOE.fromEither(util.stringifyJson(device))),
        IOE.bind('state', () =>
          IOE.fromEither(
            util.stringifyJson(
              this.deviceStore.getCacheStatesForDevice(device.id),
            ),
          ),
        ),
        IOE.tapIO(({ deviceJson }) =>
          this.log.debug(
            `${device.displayName} ::: Attempting to add accessory(s) for device: ${deviceJson}`,
          ),
        ),
        IOE.tapIO(({ state }) =>
          this.log.debug(`${device.displayName} ::: Current state: ${state}`),
        ),
      );
  }
}
