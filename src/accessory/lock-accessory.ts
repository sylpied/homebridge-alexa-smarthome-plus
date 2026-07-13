import * as A from 'fp-ts/Array';
import * as E from 'fp-ts/Either';
import * as O from 'fp-ts/Option';
import * as TE from 'fp-ts/TaskEither';
import { flow, identity, pipe } from 'fp-ts/lib/function';
import { CharacteristicValue, Service } from 'homebridge';
import { SupportedActionsType } from '../domain/alexa';
import { LockState } from '../domain/alexa/lock';
import * as mapper from '../mapper/lock-mapper';
import BaseAccessory from './base-accessory';

export default class LockAccessory extends BaseAccessory {
  static requiredOperations: SupportedActionsType[] = ['lock', 'unlock'];
  service: Service;
  isExternalAccessory = false;

  configureServices() {
    this.service =
      this.platformAcc.getService(this.Service.LockMechanism) ||
      this.platformAcc.addService(
        this.Service.LockMechanism,
        this.device.displayName,
      );

    this.service
      .getCharacteristic(this.Characteristic.LockCurrentState)
      .onGet(this.handleCurrentStateGet.bind(this));

    this.service
      .getCharacteristic(this.Characteristic.LockTargetState)
      .onGet(this.handleTargetStateGet.bind(this))
      .onSet(this.handleTargetStateSet.bind(this));
  }

  async handleCurrentStateGet(): Promise<number> {
    const alexaValueName = 'lockState';
    const determineCurrentState = flow(
      A.findFirst<LockState>(
        ({ name, featureName }) =>
          featureName === 'lock' && name === alexaValueName,
      ),
      O.tap(({ value }) =>
        O.of(this.logWithContext('debug', `Get lock state result: ${value}`)),
      ),
      O.map(({ value }) =>
        mapper.mapAlexaCurrentStateToHomeKit(value, this.Characteristic),
      ),
    );

    return pipe(
      this.getStateGraphQl(determineCurrentState),
      TE.match((e) => {
        this.logWithContext('errorT', 'Get lock state', e);
        throw this.serviceCommunicationError;
      }, identity),
    )();
  }

  async handleTargetStateGet(): Promise<number> {
    const alexaValueName = 'lockState';
    const determineTargetState = flow(
      A.findFirst<LockState>(
        ({ name, featureName }) =>
          featureName === 'lock' && name === alexaValueName,
      ),
      O.map(({ value }) =>
        mapper.mapAlexaTargetStateToHomeKit(value, this.Characteristic),
      ),
      O.tap((s) =>
        O.of(
          this.logWithContext('debug', `Get lock target state result: ${s}`),
        ),
      ),
    );

    return pipe(
      this.getStateGraphQl(determineTargetState),
      TE.match((e) => {
        this.logWithContext('errorT', 'Get lock target state', e);
        throw this.serviceCommunicationError;
      }, identity),
    )();
  }

  async handleTargetStateSet(value: CharacteristicValue): Promise<void> {
    this.logWithContext('debug', `Triggered set target lock state: ${value}`);
    if (value !== 0 && value !== 1) {
      throw this.invalidValueError;
    }
    const targetState =
      value === this.Characteristic.LockTargetState.UNSECURED
        ? 'unlock'
        : 'lock';
    return pipe(
      this.platform.alexaApi.setDeviceStateGraphQl(
        this.device.endpointId,
        'lock',
        targetState,
      ),
      TE.match(
        (e) => {
          this.logWithContext('errorT', 'Set target lock state', e);
          throw this.serviceCommunicationError;
        },
        () => {
          // Alexa's control response only confirms that the command was
          // accepted. The physical lock may still be moving, so finish the
          // HomeKit transition when Alexa reports the requested state.
          void this.confirmTargetState(targetState, value);
        },
      ),
    )();
  }

  private async confirmTargetState(
    targetState: 'lock' | 'unlock',
    homeKitTargetState: CharacteristicValue,
  ): Promise<void> {
    const expectedAlexaState = targetState === 'lock' ? 'LOCKED' : 'UNLOCKED';

    for (let attempt = 0; attempt < 10; attempt++) {
      await new Promise((resolve) =>
        setTimeout(resolve, attempt === 0 ? 300 : 1000),
      );

      const result = await this.platform.alexaApi.getDeviceStateGraphQl(
        this.device,
        this.service,
        false,
      )();

      if (E.isLeft(result)) {
        continue;
      }

      const [, states] = result.right;
      const lockState = states.find(
        ({ featureName, name }) =>
          featureName === 'lock' && name === 'lockState',
      );

      if (lockState?.value !== expectedAlexaState) {
        continue;
      }

      this.updateCacheValue({
        featureName: 'lock',
        name: 'lockState',
        value: expectedAlexaState,
      });
      this.service
        .getCharacteristic(this.Characteristic.LockCurrentState)
        .updateValue(
          mapper.mapAlexaCurrentStateToHomeKit(
            expectedAlexaState,
            this.Characteristic,
          ),
        );
      this.service
        .getCharacteristic(this.Characteristic.LockTargetState)
        .updateValue(homeKitTargetState);
      this.logWithContext(
        'debug',
        `Confirmed physical lock state: ${expectedAlexaState}`,
      );
      return;
    }

    this.logWithContext(
      'warn',
      `Timed out waiting for physical lock state: ${expectedAlexaState}`,
    );
  }
}
