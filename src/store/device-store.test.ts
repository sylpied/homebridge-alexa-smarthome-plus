import { randomUUID } from 'crypto';
import * as O from 'fp-ts/Option';
import DeviceStore from './device-store';

describe('updateCacheValue', () => {
  test('should update given device and namespace were previously cached', () => {
    // given
    const deviceId = randomUUID();
    const store = new DeviceStore({ cacheTTL: 30 });
    store.cache.states = {
      [deviceId]: [
        O.of({
          featureName: 'power',
          value: 'ON',
        }),
      ],
    };

    // when
    const cache = store.updateCacheValue(deviceId, {
      featureName: 'power',
      value: 'OFF',
    });

    // then
    expect(cache[deviceId].length).toBe(1);
    expect(
      O.Functor.map(cache[deviceId][0], ({ value }) => value),
    ).toStrictEqual(O.of('OFF'));
  });

  test('should not update given no previous value', () => {
    // given
    const deviceId = randomUUID();
    const store = new DeviceStore({ cacheTTL: 30 });
    store.cache.states = {
      [deviceId]: [
        O.of({
          featureName: 'power',
          value: 'ON',
        }),
      ],
    };

    // when
    const cache = store.updateCacheValue(deviceId, {
      featureName: 'brightness',
      value: 100,
    });

    // then
    expect(cache[deviceId].length).toBe(1);
    expect(
      O.Functor.map(cache[deviceId][0], ({ value }) => value),
    ).toStrictEqual(O.of('ON'));
  });
});
