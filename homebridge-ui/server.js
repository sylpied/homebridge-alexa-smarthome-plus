const fs = require('node:fs');
const path = require('node:path');
const { isKokochiInstalled } = require('../integrations');
const AlexaRemoteModule = require('alexa-remote2');
const AlexaRemote = AlexaRemoteModule.default || AlexaRemoteModule;
const AlexaCookie = require('alexa-cookie2');
const {
  isAuthenticationFailure,
  withTimeout,
  writePrivateJson,
} = require('./server-core');

const PLUGIN_NAME = 'homebridge-alexa-smarthome-plus';
const ONE_DAY_MILLIS = 24 * 60 * 60 * 1000;
const DISCOVERY_TIMEOUT_MILLIS = 12000;
const AUTHENTICATION_VALIDATION_TIMEOUT_MILLIS = 12000;

const toPromise = (fn) =>
  new Promise((resolve, reject) =>
    fn((error, body) => (error ? reject(error) : resolve(body))),
  );

const extractLoginUrl = (message) =>
  message?.match(/https?:\/\/[^\s]+/)?.[0]?.replace(/[.)]+$/, '');

const normalizeDevices = (devices) =>
  (Array.isArray(devices) ? devices : [])
    .map((device) => ({
      id: String(
        device.id ||
          device.endpointId ||
          device.legacyIdentifiers?.applianceId ||
          '',
      ).replace('amzn1.alexa.endpoint.', ''),
      name:
        device.friendlyName ||
        device.displayName ||
        device.legacyAppliance?.friendlyName ||
        '',
      type:
        device.displayCategories?.primary?.value ||
        device.deviceType ||
        'UNKNOWN',
    }))
    .filter(({ id, name }) => id && name)
    .sort((a, b) => a.name.localeCompare(b.name));

const normalizeRoutines = (response) => {
  const routines = Array.isArray(response)
    ? response
    : response?.automations || response?.routines || [];
  return routines
    .map((routine) => ({
      id: routine.automationId || routine.id || '',
      name: routine.name || '',
      status: routine.status || 'UNKNOWN',
    }))
    .filter(({ id, name }) => id && name)
    .sort((a, b) => a.name.localeCompare(b.name));
};

(async () => {
  const { HomebridgePluginUiServer, RequestError } = await import(
    '@homebridge/plugin-ui-utils'
  );

  class AlexaSmartHomePlusUiServer extends HomebridgePluginUiServer {
    constructor() {
      super();
      this.activeRemote = undefined;
      this.authenticationStarting = false;
      this.discoveryState = { status: 'idle' };
      this.lastAuthenticationLog = '';

      this.onRequest('/auth/status', this.authStatus.bind(this));
      this.onRequest('/integrations', async () => {
        return {
          kokochiInstalled: isKokochiInstalled(this.homebridgeStoragePath),
        };
      });
      this.onRequest('/auth/start', this.startAuthentication.bind(this));
      this.onRequest('/auth/clear', this.clearAuthentication.bind(this));
      this.ready();
    }

    get authPath() {
      return path.join(
        this.homebridgeStoragePath,
        'persist',
        `.${PLUGIN_NAME}`,
      );
    }

    readAuthentication() {
      try {
        return JSON.parse(fs.readFileSync(this.authPath, 'utf8')).cookieData;
      } catch {
        return undefined;
      }
    }

    writeAuthentication(cookieData) {
      writePrivateJson(this.authPath, { cookieData });
    }

    async authStatus(request = {}) {
      const auth = this.readAuthentication();
      let authenticated = Boolean(
        auth?.localCookie && auth?.refreshToken && auth?.macDms,
      );
      let errorCode;

      if (
        request.validate === true &&
        authenticated &&
        !this.authenticationStarting &&
        this.discoveryState.status !== 'running'
      ) {
        let remote;
        try {
          remote = await withTimeout(
            this.initializeRemote(request.config || {}, false),
            AUTHENTICATION_VALIDATION_TIMEOUT_MILLIS,
            'Alexa authentication validation timed out.',
            () => this.activeRemote?.stop?.(),
          );
        } catch (error) {
          authenticated = false;
          errorCode = isAuthenticationFailure(error)
            ? 'AUTHENTICATION_EXPIRED'
            : 'ALEXA_API_UNAVAILABLE';
        } finally {
          remote?.stop?.();
          if (this.activeRemote === remote) this.activeRemote = undefined;
        }
      }

      if (
        request.refresh === true &&
        this.discoveryState.status !== 'running'
      ) {
        this.discoveryState = {
          status: 'running',
          startedAt: new Date().toISOString(),
        };
        // Let the UI response flush before alexa-remote2 starts its connection
        // setup. Starting it inline can keep Homebridge UI 5.24 from resolving
        // this otherwise completed request.
        setTimeout(() => {
          void this.performDiscovery(request.config || {});
        }, 100);
      }
      const status = {
        authenticated,
        errorCode,
        amazonDomain: auth?.amazonPage,
        updatedAt: auth?.tokenDate
          ? new Date(auth.tokenDate).toISOString()
          : undefined,
        discovery: this.discoveryState,
      };
      const logSignature = `${status.authenticated}:${status.updatedAt || ''}`;
      if (logSignature !== this.lastAuthenticationLog) {
        this.lastAuthenticationLog = logSignature;
        console.log(
          `Alexa authentication status: authenticated=${status.authenticated}, path=${this.authPath}`,
        );
      }
      return status;
    }

    async initializeRemote(config, interactive) {
      // A user-requested browser login must never try to refresh stale saved
      // credentials first. Doing so can leave the UI waiting indefinitely.
      const auth = interactive ? undefined : this.readAuthentication();
      const domain = auth?.amazonPage || config.amazonDomain || 'amazon.com';
      const remote = new AlexaRemote();
      remote.alexaCookie = AlexaCookie;
      this.activeRemote = remote;

      remote.on('cookie', () => {
        if (remote.cookieData) {
          this.writeAuthentication(remote.cookieData);
          // A cookie refresh during ordinary device discovery is not a new
          // login. Emitting alexa-authenticated here makes the UI start a
          // second discovery and display the completion notification twice.
        }
      });

      return new Promise((resolve, reject) => {
        remote.init(
          {
            acceptLanguage: config.language || 'en-US',
            alexaServiceHost: `alexa.${domain}`,
            amazonPage: domain,
            amazonPageProxyLanguage: (config.language || 'en-US').replace(
              '-',
              '_',
            ),
            formerRegistrationData: auth,
            allowInteractiveLogin: interactive === true,
            cookieRefreshInterval:
              (config.auth?.refreshInterval || 4) * ONE_DAY_MILLIS,
            cookie: auth?.localCookie,
            deviceAppName: 'Homebridge',
            macDms: auth?.macDms,
            proxyOwnIp: config.auth?.proxy?.clientHost,
            proxyPort: config.auth?.proxy?.port,
            proxyLogLevel: 'error',
            proxyOnly: true,
            setupProxy: true,
            usePushConnectType: 3,
            useWsMqtt: false,
          },
          (error) => {
            if (!error) {
              resolve(remote);
              return;
            }

            const loginUrl = extractLoginUrl(error.message);
            if (interactive && loginUrl) {
              resolve({ remote, loginUrl });
              return;
            }
            reject(error);
          },
        );
      });
    }

    async startAuthentication(config) {
      const host = config.auth?.proxy?.clientHost;
      const port = config.auth?.proxy?.port;
      if (!host || !port) {
        throw new RequestError(
          'Alexa authentication settings are incomplete.',
          {
            message:
              'Homebridge host and authentication proxy port are required.',
          },
        );
      }

      // AlexaRemote keeps the init callback pending while the browser login is
      // in progress on some versions. Start it in the background and return the
      // deterministic local proxy URL immediately so the UI never blocks.
      if (this.authenticationStarting) {
        return {
          authenticated: false,
          loginUrl: `http://${host}:${port}/`,
          starting: true,
        };
      }

      this.authenticationStarting = true;
      AlexaCookie.stopProxyServer();
      fs.rmSync(`${this.authPath}.proxy`, { force: true });

      const domain = config.amazonDomain || 'amazon.com';
      const language = config.language || 'en-US';
      const loginProtocol = 'http';
      const loginUrl = `${loginProtocol}://${host}:${port}/`;
      let readyReported = false;
      const authenticationCompleteHtml = language.toLowerCase().startsWith('ja')
        ? `<!doctype html><html lang="ja"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Alexa認証完了</title><style>body{font-family:-apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif;background:#f6f7f9;color:#202124;display:grid;min-height:100vh;margin:0;place-items:center}.card{background:#fff;border-radius:14px;box-shadow:0 6px 24px #0002;max-width:560px;padding:36px;text-align:center;margin:20px}.mark{background:#34a853;border-radius:50%;color:#fff;display:inline-grid;font-size:32px;height:64px;place-items:center;width:64px}h1{font-size:26px;margin:20px 0 12px}p{color:#5f6368;line-height:1.7;margin:0}</style></head><body><main class="card"><div class="mark">✓</div><h1>Alexa認証が完了しました</h1><p>このWebページは閉じてください。<br>Homebridgeの設定画面へ戻ると、Alexa機器と定型アクションの取得が始まります。</p></main></body></html>`
        : `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Alexa authentication complete</title><style>body{font-family:-apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif;background:#f6f7f9;color:#202124;display:grid;min-height:100vh;margin:0;place-items:center}.card{background:#fff;border-radius:14px;box-shadow:0 6px 24px #0002;max-width:560px;padding:36px;text-align:center;margin:20px}.mark{background:#34a853;border-radius:50%;color:#fff;display:inline-grid;font-size:32px;height:64px;place-items:center;width:64px}h1{font-size:26px;margin:20px 0 12px}p{color:#5f6368;line-height:1.7;margin:0}</style></head><body><main class="card"><div class="mark">✓</div><h1>Alexa authentication is complete</h1><p>You can close this page now.<br>Return to the Homebridge settings page to retrieve your Alexa devices and routines.</p></main></body></html>`;

      return await new Promise((resolve, reject) => {
        const timeout = setTimeout(() => {
          this.authenticationStarting = false;
          reject(
            new RequestError('Alexa authentication proxy startup timed out.', {
              message: 'The proxy did not start listening within 10 seconds.',
            }),
          );
        }, 10000);

        AlexaCookie.generateAlexaCookie(
          {
            acceptLanguage: language,
            amazonPage: domain,
            amazonPageProxyLanguage: language.replace('-', '_'),
            // The regional amazon.co.jp maplanding endpoint currently returns an
            // invalid-page error after login. Token registration uses Amazon's
            // global device-auth endpoint while Alexa API calls remain regional.
            baseAmazonPage: 'amazon.com',
            baseAmazonPageHandle: '',
            deviceAppName: 'Homebridge',
            formerDataStorePath: `${this.authPath}.proxy`,
            // alexa-cookie2 debug messages can contain complete cookies, OAuth
            // tokens, request bodies, and private device keys. Never forward
            // those messages into the Homebridge log.
            logger: () => undefined,
            proxyCloseWindowHTML: authenticationCompleteHtml,
            proxyListenBind: '0.0.0.0',
            proxyLogLevel: 'error',
            proxyOnly: true,
            proxyOwnIp: host,
            proxyPort: port,
            proxyProtocol: loginProtocol,
            setupProxy: true,
          },
          (error, cookieData) => {
            if (cookieData?.localCookie && cookieData?.refreshToken) {
              this.writeAuthentication(cookieData);
              this.authenticationStarting = false;
              clearTimeout(timeout);
              AlexaCookie.stopProxyServer();
              this.pushEvent('alexa-authenticated', {
                authenticated: true,
                amazonDomain: cookieData.amazonPage || domain,
                updatedAt: new Date().toISOString(),
              });
              if (!readyReported) {
                readyReported = true;
                resolve({ authenticated: true });
              }
              return;
            }

            const reportedUrl = extractLoginUrl(error?.message) || loginUrl;
            if (error && /Please open http/i.test(error.message)) {
              if (!readyReported) {
                readyReported = true;
                clearTimeout(timeout);
                this.pushEvent('alexa-proxy-ready', { loginUrl: reportedUrl });
                resolve({ authenticated: false, loginUrl: reportedUrl });
              }
              return;
            }

            if (error) {
              this.authenticationStarting = false;
              console.error(
                `Alexa authentication proxy startup failed: ${error.message}`,
              );
              this.pushEvent('alexa-authentication-error', {
                message: error.message,
              });
              clearTimeout(timeout);
              reject(
                new RequestError(
                  'Alexa authentication proxy could not start.',
                  {
                    message: error.message,
                  },
                ),
              );
            }
          },
        );
      });
    }

    async clearAuthentication() {
      AlexaCookie.stopProxyServer();
      this.authenticationStarting = false;
      fs.rmSync(this.authPath, { force: true });
      fs.rmSync(`${this.authPath}.proxy`, { force: true });
      this.activeRemote = undefined;
      this.discoveryState = { status: 'idle' };
      return { authenticated: false };
    }

    async performDiscovery(config) {
      let remote;
      try {
        console.log(
          'Alexa discovery: initializing authenticated connection...',
        );
        remote = await withTimeout(
          this.initializeRemote(config, false),
          DISCOVERY_TIMEOUT_MILLIS,
          'Alexa connection initialization timed out. Please try again.',
          () => {
            this.activeRemote?.stop?.();
            this.activeRemote = undefined;
          },
        );
        console.log('Alexa discovery: authenticated connection initialized.');
        console.log('Alexa discovery: requesting devices and routines...');
        const [devices, routines] = await withTimeout(
          Promise.all([
            toPromise((callback) => remote.getSmarthomeDevicesV2(callback)),
            toPromise((callback) =>
              remote.getAutomationRoutines(2000, callback),
            ),
          ]),
          DISCOVERY_TIMEOUT_MILLIS,
          'Alexa device discovery timed out. Please try again.',
          () => remote?.stop?.(),
        );
        console.log(
          `Alexa discovery: completed with ${
            normalizeDevices(devices).length
          } devices and ${normalizeRoutines(routines).length} routines.`,
        );
        const normalizedDevices = normalizeDevices(devices);
        const normalizedRoutines = normalizeRoutines(routines);
        // The settings UI only needs names and display types. Alexa endpoint
        // and automation identifiers can be very large or non-plain values,
        // which prevents Homebridge UI IPC responses from being serialized.
        const uiDevices = normalizedDevices.map(({ id, name, type }) => ({
          id,
          name,
          type,
        }));
        const uiRoutines = normalizedRoutines.map(({ name }) => ({ name }));
        this.discoveryState = {
          status: 'complete',
          authenticated: true,
          devices: uiDevices,
          routines: uiRoutines,
          completedAt: new Date().toISOString(),
        };
        this.pushEvent('alexa-discovery-complete', this.discoveryState);
      } catch (error) {
        console.error(`Alexa discovery failed: ${error.message}`);
        this.discoveryState = {
          status: 'error',
          message: error.message,
          completedAt: new Date().toISOString(),
        };
      } finally {
        remote?.stop?.();
        if (this.activeRemote === remote) {
          this.activeRemote = undefined;
        }
      }
    }
  }

  new AlexaSmartHomePlusUiServer();
})().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
