import { describe, expect, it } from 'vitest';
import { isDetailsMode } from '../../../engine/decision/extraction';
import { readStored } from './useStoredState';

describe('readStored', () => {
  const storage = (value: string | null) => ({ getItem: () => value });

  it('returns a valid stored value', () => {
    expect(readStored(storage('jev'), 'details', isDetailsMode, 'agent')).toBe('jev');
  });

  it('falls back when the value is missing, invalid, or storage is unavailable', () => {
    expect(readStored(storage(null), 'details', isDetailsMode, 'agent')).toBe('agent');
    expect(readStored(storage('ask the agent'), 'details', isDetailsMode, 'agent')).toBe('agent');
    expect(readStored(undefined, 'details', isDetailsMode, 'agent')).toBe('agent');
    const throwing = { getItem: () => { throw new Error('SecurityError'); } };
    expect(readStored(throwing, 'details', isDetailsMode, 'agent')).toBe('agent');
  });
});
