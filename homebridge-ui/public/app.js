(() => {
  const amazonDomains = [
    'amazon.com',
    'amazon.ca',
    'amazon.de',
    'amazon.es',
    'amazon.fr',
    'amazon.it',
    'amazon.in',
    'amazon.nl',
    'amazon.co.jp',
    'amazon.co.uk',
    'amazon.com.au',
    'amazon.com.br',
    'amazon.com.mx',
  ];

  const defaults = {
    platform: 'AlexaSmartHomePlus',
    name: 'AlexaSmartHomePlus',
    uiLanguage: 'auto',
    amazonDomain: 'amazon.com',
    language: 'en-US',
    deviceFilterMode: 'all',
    devices: [],
    deviceIds: [],
    excludeDevices: [],
    excludeDeviceIds: [],
    deviceAliases: [],
    routines: { names: [], executionDevice: '', resetDelayMs: 500 },
    auth: {
      refreshInterval: 4,
      reauthenticateOnFailure: true,
      proxy: { clientHost: '', port: 9000 },
    },
    performance: {
      cacheTTL: 60,
      periodicStateRefresh: true,
      periodicStateRefreshIntervalMinutes: 5,
    },
    disabledOperations: [],
    debug: false,
  };

  let config;
  let cachedAccessories = [];
  let discoveredDevices = [];
  let discoveredRoutines = [];
  let appliedDiscoveryCompletedAt = '';
  let discoveryInProgress = false;
  let authentication = { authenticated: false };
  let authenticationPollTimer;
  let translations;
  let updateTimer;

  const deepMerge = (base, value) => {
    const output = { ...base, ...value };
    Object.keys(base).forEach((key) => {
      if (
        base[key] &&
        typeof base[key] === 'object' &&
        !Array.isArray(base[key])
      ) {
        output[key] = deepMerge(base[key], value?.[key] || {});
      }
    });
    return output;
  };

  const t = (key) => translations?.[key] || key;
  const byId = (id) => document.getElementById(id);

  const withTimeout = (promise, fallback, timeoutMs = 2000) =>
    Promise.race([
      promise,
      new Promise((resolve) =>
        window.setTimeout(() => resolve(fallback), timeoutMs),
      ),
    ]);

  const field = (id, label, type = 'text', extra = '') => `
    <div class="form-group">
      <label for="${id}" class="form-label">${label}</label>
      <input id="${id}" type="${type}" class="form-control" ${extra}>
    </div>`;

  const section = (title, help, body, open = false) => `
    <details class="asmp-section" ${open ? 'open' : ''}>
      <summary>${title}</summary>
      <div class="asmp-section-body">
        <p class="text-muted">${help}</p>
        ${body}
      </div>
    </details>`;

  const render = () => {
    byId('page-title').textContent = t('pageTitle');
    byId('page-description').textContent = t('pageDescription');
    byId('ui-language').value = config.uiLanguage;

    const account = `
      <div class="asmp-grid">
        <div class="form-group">
          <label for="amazon-domain" class="form-label">${t('domain')}</label>
          <select id="amazon-domain" class="form-select">
            ${amazonDomains
              .map((domain) => `<option value="${domain}">${domain}</option>`)
              .join('')}
          </select>
        </div>
        <div class="form-group">
          <label for="auth-language" class="form-label">${t(
            'authLanguage',
          )}</label>
          <select id="auth-language" class="form-select">
            <option value="ja-JP">日本語 (ja-JP)</option>
            <option value="en-US">English (en-US)</option>
            <option value="de-DE">Deutsch (de-DE)</option>
            <option value="fr-FR">Français (fr-FR)</option>
            <option value="it-IT">Italiano (it-IT)</option>
            <option value="es-ES">Español (es-ES)</option>
          </select>
        </div>
        ${field('proxy-host', t('proxyHost'))}
        ${field(
          'proxy-port',
          t('proxyPort'),
          'number',
          'min="7000" max="9999"',
        )}
      </div>
      <div class="asmp-auth-actions mt-3">
        <span id="auth-state" class="badge"></span>
        <button id="start-auth" type="button" class="btn btn-primary btn-sm">${t(
          'connectAlexa',
        )}</button>
        <button id="discover-alexa" type="button" class="btn btn-outline-primary btn-sm">${t(
          'refreshAlexa',
        )}</button>
        <button id="clear-auth" type="button" class="btn btn-outline-danger btn-sm">${t(
          'disconnectAlexa',
        )}</button>
      </div>
      <a id="auth-login-link" class="btn btn-link px-0 d-none" target="_blank" rel="noopener noreferrer">${t(
        'openAmazonLogin',
      )}</a>
      <div class="asmp-security-note mt-3" role="note">
        <strong>${t('securityTitle')}</strong>
        <span>${t('securityNotice')}</span>
      </div>
      <small id="auth-updated" class="asmp-help text-muted"></small>`;

    const devices = `
      <div class="form-group mb-3">
        <label for="device-mode" class="form-label">${t('deviceMode')}</label>
        <select id="device-mode" class="form-select">
          <option value="all">${t('allDevices')}</option>
          <option value="include">${t('includeDevices')}</option>
          <option value="exclude">${t('excludeDevices')}</option>
        </select>
      </div>
      <div id="included-block" class="mb-3">
        <label class="form-label">${t('includedNames')}</label>
        <div id="included-list"></div>
        <button id="add-included" type="button" class="btn btn-outline-primary btn-sm">${t(
          'add',
        )}</button>
      </div>
      <div id="excluded-block" class="mb-3">
        <label class="form-label">${t('excludedNames')}</label>
        <div id="excluded-list"></div>
        <button id="add-excluded" type="button" class="btn btn-outline-primary btn-sm">${t(
          'add',
        )}</button>
      </div>
      <div>
        <label class="form-label">${t('aliases')}</label>
        <div id="alias-list"></div>
        <button id="add-alias" type="button" class="btn btn-outline-primary btn-sm">${t(
          'add',
        )}</button>
      </div>
      <div id="discovered-devices" class="mt-3"></div>`;

    const routines = `
      <label class="form-label">${t('routineNames')}</label>
      <div id="routine-list"></div>
      <button id="add-routine" type="button" class="btn btn-outline-primary btn-sm mb-3">${t(
        'add',
      )}</button>
      <div id="routine-options" class="asmp-grid">
        ${field('execution-device', t('executionDevice'))}
        ${field(
          'reset-delay',
          t('resetDelay'),
          'number',
          'min="100" max="10000"',
        )}
      </div>
      <div id="discovered-routines" class="mt-3"></div>`;

    const advanced = `
      <div class="asmp-grid">
        ${field('refresh-interval', t('refreshInterval'), 'number', 'min="1"')}
        ${field('cache-ttl', t('cacheTtl'), 'number', 'min="30" max="3600"')}
        <div class="form-check asmp-field-wide">
          <input id="auto-recovery" type="checkbox" class="form-check-input">
          <label for="auto-recovery" class="form-check-label">${t(
            'autoRecovery',
          )}</label>
        </div>
        <div class="form-check asmp-field-wide">
          <input id="periodic-state-refresh" type="checkbox" class="form-check-input">
          <label for="periodic-state-refresh" class="form-check-label">${t(
            'periodicStateRefresh',
          )}</label>
          <div class="form-text">${t('periodicStateRefreshHelp')}</div>
        </div>
        <div class="form-group asmp-field-wide">
          <label for="periodic-state-refresh-interval" class="form-label">${t(
            'periodicStateRefreshInterval',
          )}</label>
          <select id="periodic-state-refresh-interval" class="form-select">
            ${[1, 3, 5, 10, 15, 30]
              .map(
                (minutes) =>
                  `<option value="${minutes}">${minutes} ${t('minutes')}</option>`,
              )
              .join('')}
          </select>
          <div class="form-text">${t(
            'periodicStateRefreshIntervalHelp',
          )}</div>
        </div>
        <div class="form-check asmp-field-wide">
          <input id="debug" type="checkbox" class="form-check-input">
          <label for="debug" class="form-check-label">${t('debug')}</label>
        </div>
        <div class="asmp-field-wide">
          <label class="form-label">${t('disabledOperations')}</label>
          <div id="disabled-list"></div>
          <button id="add-disabled" type="button" class="btn btn-outline-primary btn-sm">${t(
            'add',
          )}</button>
        </div>
      </div>`;

    const deviceCandidates = cachedAccessories
      .filter((accessory) => accessory.context?.deviceType !== 'ALEXA_ROUTINE')
      .map((accessory) => accessory.displayName)
      .concat(discoveredDevices.map(({ name }) => name))
      .filter(Boolean);
    const routineCandidates = cachedAccessories
      .filter((accessory) => accessory.context?.deviceType === 'ALEXA_ROUTINE')
      .map((accessory) => accessory.displayName)
      .concat(discoveredRoutines.map(({ name }) => name))
      .filter(Boolean);

    byId('settings').innerHTML = [
      section(t('account'), t('accountHelp'), account, true),
      section(t('devices'), t('devicesHelp'), devices, true),
      section(t('routines'), t('routinesHelp'), routines),
      section(t('advanced'), '', advanced),
      `<datalist id="device-candidates">${[...new Set(deviceCandidates)]
        .map((name) => `<option value="${escapeAttribute(name)}"></option>`)
        .join('')}</datalist>`,
      `<datalist id="routine-candidates">${[...new Set(routineCandidates)]
        .map((name) => `<option value="${escapeAttribute(name)}"></option>`)
        .join('')}</datalist>`,
    ].join('');

    bindValues();
    renderLists();
    renderAuthenticationStatus();
    renderDiscoveryResults();
    updateConditionalFields();
    validateAndUpdate();
    homebridge.fixScrollHeight?.();
  };

  const bind = (id, value, handler, event = 'input') => {
    const element = byId(id);
    if (element.type === 'checkbox') element.checked = Boolean(value);
    else element.value = value ?? '';
    element.addEventListener(event, () => handler(element));
  };

  const bindValues = () => {
    bind(
      'amazon-domain',
      config.amazonDomain,
      (el) => {
        config.amazonDomain = el.value;
        scheduleUpdate();
      },
      'change',
    );
    bind(
      'auth-language',
      config.language,
      (el) => {
        config.language = el.value;
        scheduleUpdate();
      },
      'change',
    );
    bind('proxy-host', config.auth.proxy.clientHost, (el) => {
      config.auth.proxy.clientHost = el.value.trim();
      scheduleUpdate();
    });
    bind('proxy-port', config.auth.proxy.port, (el) => {
      config.auth.proxy.port = Number(el.value);
      scheduleUpdate();
    });
    bind(
      'device-mode',
      config.deviceFilterMode,
      (el) => {
        config.deviceFilterMode = el.value;
        updateConditionalFields();
        scheduleUpdate();
      },
      'change',
    );
    bind('execution-device', config.routines.executionDevice, (el) => {
      config.routines.executionDevice = el.value.trim();
      scheduleUpdate();
    });
    bind('reset-delay', config.routines.resetDelayMs, (el) => {
      config.routines.resetDelayMs = Number(el.value);
      scheduleUpdate();
    });
    bind('refresh-interval', config.auth.refreshInterval, (el) => {
      config.auth.refreshInterval = Number(el.value);
      scheduleUpdate();
    });
    bind('cache-ttl', config.performance.cacheTTL, (el) => {
      config.performance.cacheTTL = Number(el.value);
      scheduleUpdate();
    });
    bind(
      'auto-recovery',
      config.auth.reauthenticateOnFailure,
      (el) => {
        config.auth.reauthenticateOnFailure = el.checked;
        scheduleUpdate();
      },
      'change',
    );
    bind(
      'periodic-state-refresh',
      config.performance.periodicStateRefresh,
      (el) => {
        config.performance.periodicStateRefresh = el.checked;
        scheduleUpdate();
      },
      'change',
    );
    bind(
      'periodic-state-refresh-interval',
      config.performance.periodicStateRefreshIntervalMinutes,
      (el) => {
        config.performance.periodicStateRefreshIntervalMinutes = Number(
          el.value,
        );
        scheduleUpdate();
      },
      'change',
    );
    bind(
      'debug',
      config.debug,
      (el) => {
        config.debug = el.checked;
        scheduleUpdate();
      },
      'change',
    );

    byId('start-auth').onclick = startAuthentication;
    byId('discover-alexa').onclick = discoverAlexa;
    byId('clear-auth').onclick = clearAuthentication;
  };

  const runRequest = async (
    path,
    body,
    timeoutMs = 5000,
    showSpinner = true,
  ) => {
    if (showSpinner) homebridge.showSpinner?.();
    try {
      return await Promise.race([
        homebridge.request(path, body),
        new Promise((_, reject) =>
          window.setTimeout(
            () => reject(new Error(t('requestTimedOut'))),
            timeoutMs,
          ),
        ),
      ]);
    } finally {
      if (showSpinner) homebridge.hideSpinner?.();
    }
  };

  const renderAuthenticationStatus = () => {
    const state = byId('auth-state');
    if (!state) return;

    state.textContent = authentication.authenticated
      ? t('connected')
      : t('notConnected');
    state.className = `badge ${
      authentication.authenticated ? 'bg-success' : 'bg-secondary'
    }`;
    // Discovery is also a safe way to verify an existing saved session, so it
    // must remain available even when the status request was not reflected by
    // Homebridge UI.
    byId('discover-alexa').disabled = false;
    byId('clear-auth').disabled = !authentication.authenticated;

    const updated = byId('auth-updated');
    updated.textContent = authentication.updatedAt
      ? `${t('lastUpdated')}: ${new Date(
          authentication.updatedAt,
        ).toLocaleString()}`
      : '';
  };

  const startAuthentication = async () => {
    const host = config.auth.proxy.clientHost;
    const port = config.auth.proxy.port;
    if (!host || !port) {
      homebridge.toast?.error(t('required'), t('account'));
      return;
    }

    const link = byId('auth-login-link');
    link.classList.add('d-none');
    byId('auth-updated').textContent = t('proxyStartingInline');
    homebridge.toast?.info(t('proxyStarting'), t('account'));
    homebridge.fixScrollHeight?.();

    const loginUrl = `http://${host}:${port}/`;
    let linkRevealed = false;
    const revealLoginLink = (url = loginUrl) => {
      if (linkRevealed) return;
      linkRevealed = true;
      link.href = url;
      link.classList.remove('d-none');
      byId('auth-updated').textContent = t('proxyReady');
      homebridge.toast?.success(t('proxyReady'), t('account'));
      homebridge.fixScrollHeight?.();
    };

    // Homebridge UI does not reliably forward the custom-server response or
    // stream event in every release. The proxy is started by the request and
    // normally listens immediately; reveal its deterministic URL after a short
    // grace period as a UI-independent fallback.
    window.setTimeout(() => revealLoginLink(), 1500);
    startAuthenticationPolling();

    homebridge
      .request('/auth/start', config)
      .then((result) => {
        if (!result?.loginUrl) return;
        revealLoginLink(result.loginUrl);
      })
      .catch((error) => {
        const message = error?.message || t('authenticationFailed');
        byId('auth-updated').textContent = message;
        homebridge.toast?.error(message, t('account'));
      });
  };

  const startAuthenticationPolling = () => {
    window.clearTimeout(authenticationPollTimer);
    const startedAt = Date.now();

    const poll = async () => {
      if (Date.now() - startedAt > 120000) {
        byId('auth-updated').textContent = t('authCheckTimedOut');
        return;
      }

      try {
        const status = await withTimeout(
          homebridge.request('/auth/status', {}),
          { authenticated: false },
          4000,
        );
        if (status?.authenticated) {
          authentication = status;
          renderAuthenticationStatus();
          byId('auth-login-link').classList.add('d-none');
          homebridge.toast?.success(t('authenticationComplete'), t('account'));
          await discoverAlexa();
          return;
        }
      } catch {
        // A temporary settings-server failure should not stop later checks.
      }

      byId('auth-updated').textContent = t('checkingAuthentication');
      authenticationPollTimer = window.setTimeout(poll, 3000);
    };

    authenticationPollTimer = window.setTimeout(poll, 3000);
  };

  const clearAuthentication = async () => {
    try {
      authentication = await runRequest('/auth/clear', {});
      discoveredDevices = [];
      discoveredRoutines = [];
      renderAuthenticationStatus();
      renderDiscoveryResults();
    } catch (error) {
      homebridge.toast?.error(error.message, t('account'));
    }
  };

  const discoverAlexa = async () => {
    if (discoveryInProgress) return;
    discoveryInProgress = true;
    const refreshButton = byId('discover-alexa');
    if (refreshButton) refreshButton.disabled = true;
    try {
      byId('auth-updated').textContent = t('discoveringAlexa');
      // Homebridge UI 5.24 can leave the start request promise pending even
      // though the server received it. Do not block result polling on it.
      void homebridge
        .request('/auth/status', { refresh: true, config })
        .catch((error) =>
          console.error('Alexa discovery start failed:', error),
        );
      const startedAt = Date.now();
      const poll = async () => {
        try {
          const status = await withTimeout(
            homebridge.request('/auth/status', {}),
            undefined,
            4000,
          );
          const result = status?.discovery;
          const completedAt = result?.completedAt
            ? new Date(result.completedAt).getTime()
            : 0;
          if (completedAt && completedAt < startedAt) {
            window.setTimeout(() => void poll(), 1000);
            return;
          }
          if (result?.status === 'complete') {
            try {
              applyDiscoveryResult(result);
            } catch (error) {
              console.error('Alexa discovery rendering failed:', error);
              byId('auth-updated').textContent = t('discoveryRenderFailed');
              return;
            }
            homebridge.fixScrollHeight?.();
            return;
          }
          if (result?.status === 'error') {
            discoveryInProgress = false;
            if (refreshButton) refreshButton.disabled = false;
            byId('auth-updated').textContent =
              result.message || t('authenticationFailed');
            return;
          }
        } catch (error) {
          console.error('Alexa discovery status check failed:', error);
        }
        if (Date.now() - startedAt >= 16000) {
          discoveryInProgress = false;
          if (refreshButton) refreshButton.disabled = false;
          byId('auth-updated').textContent = t('discoveryContinues');
          return;
        }
        window.setTimeout(() => void poll(), 1000);
      };
      window.setTimeout(() => void poll(), 1000);
    } catch (error) {
      discoveryInProgress = false;
      if (refreshButton) refreshButton.disabled = false;
      byId('auth-updated').textContent = t('discoveryContinues');
    }
  };

  const setDevicePublished = (item, published) => {
    const { id, name } = item;
    const addUnique = (values, value) => {
      if (!values.includes(value)) values.push(value);
    };
    const remove = (values, value) => {
      const index = values.indexOf(value);
      if (index >= 0) values.splice(index, 1);
    };

    if (config.deviceFilterMode === 'all') {
      if (!published) {
        config.deviceFilterMode = 'exclude';
        addUnique(config.excludeDevices, name);
        addUnique(config.excludeDeviceIds, id);
      }
    } else if (config.deviceFilterMode === 'include') {
      if (published) addUnique(config.deviceIds, id);
      else remove(config.deviceIds, id);
      const sameNameSelected = discoveredDevices.some(
        (device) =>
          device.name === name && config.deviceIds.includes(device.id),
      );
      if (sameNameSelected) addUnique(config.devices, name);
      else remove(config.devices, name);
    } else if (published) {
      remove(config.excludeDeviceIds, id);
      const sameNameExcluded = discoveredDevices.some(
        (device) =>
          device.name === name && config.excludeDeviceIds.includes(device.id),
      );
      if (!sameNameExcluded) remove(config.excludeDevices, name);
    } else {
      addUnique(config.excludeDevices, name);
      addUnique(config.excludeDeviceIds, id);
    }

    byId('device-mode').value = config.deviceFilterMode;
    renderLists();
    updateConditionalFields();
    scheduleUpdate();
  };

  const isDevicePublished = ({ id, name }) => {
    if (config.deviceFilterMode === 'all') return true;
    if (config.deviceFilterMode === 'include') {
      if (config.deviceIds.length > 0) return config.deviceIds.includes(id);
      return config.devices.includes(name);
    }
    if (config.excludeDeviceIds.length > 0) {
      return !config.excludeDeviceIds.includes(id);
    }
    return !config.excludeDevices.includes(name);
  };

  const createDiscoveryList = (
    title,
    items,
    checked,
    onChange,
    onBulkChange,
  ) => {
    const wrapper = document.createElement('div');
    const heading = document.createElement('h6');
    const selectedCount = document.createElement('span');
    const updateCount = () => {
      const selected = items.filter((item) => checked(item)).length;
      selectedCount.textContent = `${t('selectedCount')}: ${selected} / ${
        items.length
      }`;
    };
    heading.textContent = title;
    wrapper.append(heading);

    const toolbar = document.createElement('div');
    toolbar.className = 'asmp-discovery-toolbar';
    const search = document.createElement('input');
    search.type = 'search';
    search.className = 'form-control form-control-sm';
    search.placeholder = t('searchDevices');
    const selectAll = document.createElement('button');
    selectAll.type = 'button';
    selectAll.className = 'btn btn-outline-primary btn-sm';
    selectAll.textContent = t('selectAll');
    const clearAll = document.createElement('button');
    clearAll.type = 'button';
    clearAll.className = 'btn btn-outline-secondary btn-sm';
    clearAll.textContent = t('clearAll');
    selectedCount.className = 'asmp-selection-count text-muted';
    toolbar.append(search, selectAll, clearAll, selectedCount);
    wrapper.append(toolbar);

    const list = document.createElement('div');
    list.className = 'asmp-discovery-list';
    const rows = [];
    items.forEach((item) => {
      const label = document.createElement('label');
      label.className = 'asmp-discovery-item';
      const checkbox = document.createElement('input');
      checkbox.type = 'checkbox';
      checkbox.className = 'form-check-input';
      checkbox.checked = checked(item);
      checkbox.addEventListener('change', () => {
        onChange(item, checkbox.checked);
        updateCount();
      });
      const text = document.createElement('span');
      text.textContent = item.name;
      label.append(checkbox, text);
      if (item.type && item.type !== 'UNKNOWN') {
        const type = document.createElement('span');
        type.className = 'badge bg-secondary asmp-device-type';
        type.textContent = item.type;
        label.append(type);
      }
      list.append(label);
      rows.push({ item, label, checkbox });
    });
    search.addEventListener('input', () => {
      const query = search.value.trim().toLocaleLowerCase();
      rows.forEach(({ item, label }) => {
        label.hidden = Boolean(
          query &&
            !`${item.name} ${item.type || ''}`
              .toLocaleLowerCase()
              .includes(query),
        );
      });
    });
    const bulkChange = (published) => {
      const visible = rows.filter(({ label }) => !label.hidden);
      onBulkChange(
        visible.map(({ item }) => item),
        published,
      );
      visible.forEach(({ checkbox }) => {
        checkbox.checked = published;
      });
      updateCount();
    };
    selectAll.addEventListener('click', () => bulkChange(true));
    clearAll.addEventListener('click', () => bulkChange(false));
    wrapper.append(list);
    updateCount();
    return wrapper;
  };

  const renderDiscoveryResults = () => {
    const deviceContainer = byId('discovered-devices');
    const routineContainer = byId('discovered-routines');
    if (!deviceContainer || !routineContainer) return;
    deviceContainer.replaceChildren();
    routineContainer.replaceChildren();

    if (discoveredDevices.length) {
      deviceContainer.append(
        createDiscoveryList(
          t('discoveredDevices'),
          discoveredDevices,
          isDevicePublished,
          setDevicePublished,
          (items, published) => {
            items.forEach((item) => setDevicePublished(item, published));
          },
        ),
      );
    }

    if (discoveredRoutines.length) {
      routineContainer.append(
        createDiscoveryList(
          t('discoveredRoutines'),
          discoveredRoutines,
          (item) => config.routines.names.includes(item.name),
          (item, published) => {
            const { name } = item;
            const index = config.routines.names.indexOf(name);
            if (published && index < 0) config.routines.names.push(name);
            if (!published && index >= 0) {
              config.routines.names.splice(index, 1);
            }
            renderLists();
            updateConditionalFields();
            scheduleUpdate();
          },
          (items, published) => {
            items.forEach(({ name }) => {
              const index = config.routines.names.indexOf(name);
              if (published && index < 0) config.routines.names.push(name);
              if (!published && index >= 0)
                config.routines.names.splice(index, 1);
            });
            renderLists();
            updateConditionalFields();
            scheduleUpdate();
          },
        ),
      );
    }
  };

  const migrateNameFiltersToDeviceIds = () => {
    let changed = false;
    if (
      config.deviceFilterMode === 'include' &&
      config.deviceIds.length === 0 &&
      config.devices.length > 0
    ) {
      config.deviceIds = discoveredDevices
        .filter(({ name }) => config.devices.includes(name))
        .map(({ id }) => id);
      changed = config.deviceIds.length > 0;
    }
    if (
      config.deviceFilterMode === 'exclude' &&
      config.excludeDeviceIds.length === 0 &&
      config.excludeDevices.length > 0
    ) {
      config.excludeDeviceIds = discoveredDevices
        .filter(({ name }) => config.excludeDevices.includes(name))
        .map(({ id }) => id);
      changed = changed || config.excludeDeviceIds.length > 0;
    }
    return changed;
  };

  const applyDiscoveryResult = (result) => {
    if (result?.status !== 'complete') return false;
    const completedAt = String(result.completedAt || '');
    if (completedAt && completedAt === appliedDiscoveryCompletedAt) {
      return false;
    }
    appliedDiscoveryCompletedAt = completedAt;
    authentication = { ...authentication, authenticated: true };
    discoveredDevices = Array.isArray(result.devices) ? result.devices : [];
    discoveredRoutines = Array.isArray(result.routines) ? result.routines : [];
    const migratedDeviceFilters = migrateNameFiltersToDeviceIds();
    renderAuthenticationStatus();
    renderDiscoveryResults();
    discoveryInProgress = false;
    const refreshButton = byId('discover-alexa');
    if (refreshButton) refreshButton.disabled = false;
    byId('auth-updated').textContent = t('discoveryComplete');
    if (migratedDeviceFilters) scheduleUpdate();
    homebridge.fixScrollHeight?.();
    return true;
  };

  const escapeAttribute = (value) =>
    String(value)
      .replaceAll('&', '&amp;')
      .replaceAll('"', '&quot;')
      .replaceAll('<', '&lt;')
      .replaceAll('>', '&gt;');

  const createInput = (value, placeholder, onInput, listId) => {
    const input = document.createElement('input');
    input.className = 'form-control';
    input.value = value || '';
    input.placeholder = placeholder;
    if (listId) input.setAttribute('list', listId);
    input.addEventListener('input', () => onInput(input.value));
    return input;
  };

  const removeButton = (onClick) => {
    const button = document.createElement('button');
    button.type = 'button';
    button.className = 'btn btn-outline-danger btn-sm';
    button.textContent = t('remove');
    button.addEventListener('click', onClick);
    return button;
  };

  const renderStringList = (
    containerId,
    values,
    placeholder,
    listId,
    onManualChange = () => {},
  ) => {
    const container = byId(containerId);
    container.replaceChildren();
    values.forEach((value, index) => {
      const row = document.createElement('div');
      row.className = 'asmp-list-row';
      row.append(
        createInput(
          value,
          placeholder,
          (next) => {
            values[index] = next;
            onManualChange();
            scheduleUpdate();
          },
          listId,
        ),
        removeButton(() => {
          values.splice(index, 1);
          onManualChange();
          renderLists();
          updateConditionalFields();
          scheduleUpdate();
        }),
      );
      container.append(row);
    });
  };

  const renderPairList = (
    containerId,
    values,
    keys,
    placeholders,
    firstListId,
  ) => {
    const container = byId(containerId);
    container.replaceChildren();
    values.forEach((value, index) => {
      const row = document.createElement('div');
      row.className = 'asmp-list-row asmp-pair';
      row.append(
        createInput(
          value[keys[0]],
          placeholders[0],
          (next) => {
            value[keys[0]] = next;
            scheduleUpdate();
          },
          firstListId,
        ),
        createInput(value[keys[1]], placeholders[1], (next) => {
          value[keys[1]] = next;
          scheduleUpdate();
        }),
        removeButton(() => {
          values.splice(index, 1);
          renderLists();
          scheduleUpdate();
        }),
      );
      container.append(row);
    });
  };

  const renderLists = () => {
    renderStringList(
      'included-list',
      config.devices,
      t('alexaName'),
      'device-candidates',
      () => {
        config.deviceIds = [];
      },
    );
    renderStringList(
      'excluded-list',
      config.excludeDevices,
      t('alexaName'),
      'device-candidates',
      () => {
        config.excludeDeviceIds = [];
      },
    );
    renderStringList(
      'routine-list',
      config.routines.names,
      t('routineNames'),
      'routine-candidates',
    );
    renderPairList(
      'alias-list',
      config.deviceAliases,
      ['alexaName', 'homeKitName'],
      [t('alexaName'), t('homeKitName')],
      'device-candidates',
    );
    renderPairList(
      'disabled-list',
      config.disabledOperations,
      ['deviceName', 'operations'],
      [t('alexaName'), t('operations')],
    );

    byId('add-included').onclick = () => {
      config.deviceIds = [];
      addString(config.devices);
    };
    byId('add-excluded').onclick = () => {
      config.excludeDeviceIds = [];
      addString(config.excludeDevices);
    };
    byId('add-routine').onclick = () => addString(config.routines.names);
    byId('add-alias').onclick = () => {
      config.deviceAliases.push({ alexaName: '', homeKitName: '' });
      renderLists();
      scheduleUpdate();
    };
    byId('add-disabled').onclick = () => {
      config.disabledOperations.push({ deviceName: '', operations: '' });
      renderLists();
      scheduleUpdate();
    };
  };

  const addString = (values) => {
    values.push('');
    renderLists();
    updateConditionalFields();
    scheduleUpdate();
  };

  const updateConditionalFields = () => {
    byId('included-block').classList.toggle(
      'd-none',
      config.deviceFilterMode !== 'include',
    );
    byId('excluded-block').classList.toggle(
      'd-none',
      config.deviceFilterMode !== 'exclude',
    );
    byId('routine-options').classList.toggle(
      'd-none',
      config.routines.names.length === 0,
    );
    homebridge.fixScrollHeight?.();
  };

  const scheduleUpdate = () => {
    clearTimeout(updateTimer);
    updateTimer = setTimeout(validateAndUpdate, 150);
  };

  const validateAndUpdate = async () => {
    const valid =
      Boolean(config.auth.proxy.clientHost) &&
      Number.isInteger(config.auth.proxy.port) &&
      config.auth.proxy.port >= 7000 &&
      config.auth.proxy.port <= 9999;
    const status = byId('status');
    status.textContent = valid ? '' : t('required');
    status.className = valid ? 'd-none' : 'alert alert-warning';

    if (valid) homebridge.enableSaveButton?.();
    else homebridge.disableSaveButton?.();

    await homebridge.updatePluginConfig([config]);
  };

  const loadTranslations = async () => {
    const homebridgeLanguage =
      typeof homebridge.i18nCurrentLang === 'function'
        ? await homebridge.i18nCurrentLang()
        : navigator.language;
    const selected =
      config.uiLanguage === 'auto'
        ? (homebridgeLanguage || '').toLowerCase().startsWith('ja')
          ? 'ja'
          : 'en'
        : config.uiLanguage;
    try {
      const response = await withTimeout(
        fetch(`locales/${selected}.json?v=1.0.0-rc.9`),
        undefined,
      );
      translations = response?.ok ? await response.json() : {};
    } catch {
      translations = {};
    }
  };

  const init = async () => {
    const blocks = await withTimeout(
      homebridge.getPluginConfig().catch(() => []),
      [],
    );
    config = deepMerge(defaults, blocks[0] || {});
    delete config.performance.experimentalAlexaStateRefresh;
    delete config.performance.refreshAlexaDeviceListBeforeState;
    await loadTranslations();
    render();

    // Optional data is deliberately loaded after the form is visible. A slow
    // custom UI server or accessory cache must never leave a blank page.
    cachedAccessories =
      typeof homebridge.getCachedAccessories === 'function'
        ? await withTimeout(
            homebridge.getCachedAccessories().catch(() => []),
            [],
          )
        : [];
    authentication = await withTimeout(
      homebridge
        .request('/auth/status', {})
        .catch(() => ({ authenticated: false })),
      { authenticated: false },
    );
    render();

    homebridge.addEventListener?.('alexa-authenticated', async (event) => {
      authentication = {
        ...authentication,
        ...(event.data || event.detail || {}),
        authenticated: true,
      };
      renderAuthenticationStatus();
      await discoverAlexa();
    });
    homebridge.addEventListener?.('alexa-authentication-error', (event) => {
      const message = event.data?.message || event.detail?.message;
      byId('auth-updated').textContent = message || t('authenticationFailed');
      homebridge.toast?.error(
        message || t('authenticationFailed'),
        t('account'),
      );
    });
    homebridge.addEventListener?.('alexa-discovery-complete', (event) => {
      const result = event.data || event.detail || {};
      try {
        applyDiscoveryResult(result);
      } catch (error) {
        console.error('Alexa discovery event rendering failed:', error);
        byId('auth-updated').textContent = t('discoveryRenderFailed');
      }
    });
    homebridge.addEventListener?.('alexa-proxy-ready', (event) => {
      const data = event.data || event.detail || {};
      const link = byId('auth-login-link');
      link.href = data.loginUrl;
      link.classList.remove('d-none');
      byId('auth-updated').textContent = t('proxyReady');
      homebridge.toast?.success(t('proxyReady'), t('account'));
      homebridge.fixScrollHeight?.();
    });

    byId('ui-language').addEventListener('change', async (event) => {
      config.uiLanguage = event.target.value;
      await loadTranslations();
      render();
      scheduleUpdate();
    });

    const cachedDiscovery = authentication?.discovery;
    if (cachedDiscovery?.status === 'complete') {
      applyDiscoveryResult(cachedDiscovery);
    } else if (authentication?.authenticated) {
      // Populate an empty settings session automatically once. Completed
      // results held by the UI server are reused on later openings, while the
      // refresh button remains available for an explicit up-to-date query.
      void discoverAlexa();
    }
  };

  let initializationStarted = false;
  const startInitialization = () => {
    if (initializationStarted) return;
    initializationStarted = true;
    init().catch((error) => {
      console.error(error);
      const status = byId('status');
      status.textContent = error.message || String(error);
      status.className = 'alert alert-danger';
      homebridge.toast?.error(error.message, 'Alexa Smart Home Plus');
      homebridge.fixScrollHeight?.();
    });
  };

  homebridge.addEventListener('ready', startInitialization);

  // Some Homebridge UI releases can finish their ready handshake before an
  // external custom-UI script has attached its listener. The delayed fallback
  // covers that case, while the guard prevents double initialization.
  window.setTimeout(startInitialization, 300);
})();
