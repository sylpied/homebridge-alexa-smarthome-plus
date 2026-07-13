import { Option } from 'fp-ts/lib/Option';
import { PlatformConfig } from 'homebridge';
import { AmazonDomain } from '../alexa/index';
import { Nullable } from '../index';

export interface HomebridgeAccessoryInfo {
  deviceType: string;
  uuid: string;
  altDeviceName: Option<string>;
}

export interface AlexaPlatformConfig extends PlatformConfig {
  platform: 'AlexaSmartHomePlus';
  uiLanguage: Nullable<'auto' | 'ja' | 'en'>;
  deviceFilterMode: Nullable<'all' | 'include' | 'exclude'>;
  devices: Nullable<string[]>;
  deviceIds: Nullable<string[]>;
  excludeDevices: Nullable<string[]>;
  excludeDeviceIds: Nullable<string[]>;
  deviceAliases: Nullable<
    Array<{
      alexaName: string;
      homeKitName: string;
    }>
  >;
  routines: Nullable<{
    names: Nullable<string[]>;
    executionDevice: Nullable<string>;
    resetDelayMs: Nullable<number>;
  }>;
  amazonDomain: Nullable<AmazonDomain>;
  language: Nullable<string>;
  auth: {
    proxy: {
      clientHost: string;
      port: number;
    };
    refreshInterval: Nullable<number>;
    reauthenticateOnFailure: Nullable<boolean>;
  };
  performance: Nullable<{
    cacheTTL: Nullable<number>;
  }>;
  disabledOperations: Nullable<
    Array<{
      deviceName: string;
      operations: Nullable<string>;
    }>
  >;
  debug: Nullable<boolean>;
}
