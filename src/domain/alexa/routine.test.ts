import { extractAlexaRoutines } from './routine';

const routine = {
  automationId: 'routine-1',
  name: 'Good night',
};

describe('extractAlexaRoutines', () => {
  test('accepts a direct array response', () => {
    expect(extractAlexaRoutines([routine])).toEqual([routine]);
  });

  test('accepts an automations response', () => {
    expect(extractAlexaRoutines({ automations: [routine] })).toEqual([routine]);
  });

  test('returns an empty array for an unknown response', () => {
    expect(extractAlexaRoutines({})).toEqual([]);
  });
});
