import * as E from 'fp-ts/Either';
import { CharacteristicValue, PlatformAccessory, Service } from 'homebridge';
import { AlexaRoutine } from '../domain/alexa/routine';
import { AlexaSmartHomePlatform } from '../platform';

export default class RoutineAccessory {
  readonly service: Service;

  constructor(
    private readonly platform: AlexaSmartHomePlatform,
    readonly platformAcc: PlatformAccessory,
    private readonly routine: AlexaRoutine,
    private readonly executionDevice: string,
    private readonly resetDelayMs: number,
  ) {
    const { Service, Characteristic } = platform;

    platformAcc
      .getService(Service.AccessoryInformation)
      ?.setCharacteristic(Characteristic.Manufacturer, 'Amazon Alexa')
      .setCharacteristic(Characteristic.Model, 'Alexa Routine')
      .setCharacteristic(Characteristic.SerialNumber, routine.automationId)
      .setCharacteristic(Characteristic.Name, routine.name)
      .setCharacteristic(Characteristic.ConfiguredName, routine.name);

    this.service =
      platformAcc.getService(Service.Switch) ??
      platformAcc.addService(Service.Switch, routine.name);

    this.service
      .getCharacteristic(Characteristic.On)
      .onGet(() => false)
      .onSet(this.handleSet.bind(this));
  }

  private async handleSet(value: CharacteristicValue): Promise<void> {
    if (value !== true) {
      return;
    }

    this.platform.log.info('Executing Alexa routine:', this.routine.name)();

    return this.platform.alexaApi
      .executeAutomationRoutine(this.executionDevice, this.routine)()
      .then(
        E.match(
          (error) => {
            this.platform.log.errorT(
              `Execute Alexa routine ${this.routine.name}`,
              error,
            )();
            this.resetSwitch();
            throw new this.platform.HAP.HapStatusError(
              this.platform.HAP.HAPStatus.SERVICE_COMMUNICATION_FAILURE,
            );
          },
          () => this.resetSwitch(),
        ),
      );
  }

  private resetSwitch(): void {
    setTimeout(
      () =>
        this.service.updateCharacteristic(
          this.platform.Characteristic.On,
          false,
        ),
      this.resetDelayMs,
    );
  }
}
