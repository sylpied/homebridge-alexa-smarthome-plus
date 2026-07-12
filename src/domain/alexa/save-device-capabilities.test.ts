import { Endpoint } from './get-devices';
import { extractRangeFeatures } from './save-device-capabilities';

describe('extractRangeFeatures', () => {
  test('extracts current GraphQL range features', () => {
    const device = global.createSmartHomeDevice({ id: 'device-1' });
    const endpoint = {
      id: 'endpoint-1',
      features: [
        {
          name: 'range',
          instance: '9',
          properties: [{ rangeValue: { value: 42 } }],
          configuration: {
            friendlyName: { value: { text: 'Indoor Air Quality' } },
          },
        },
      ],
    } as Endpoint;

    expect(extractRangeFeatures([[endpoint, device]])).toStrictEqual({
      'device-1': {
        'Indoor Air Quality': {
          featureName: 'range',
          instance: '9',
          rangeName: 'Indoor Air Quality',
        },
      },
    });
  });
});
