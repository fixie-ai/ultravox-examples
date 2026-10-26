import { useEffect, useState } from 'react';

/** A stored setting, or the fallback if it's missing, invalid (e.g. from an older version) or storage is unavailable. */
export function readStored<T extends string>(
  storage: Pick<Storage, 'getItem'> | undefined,
  key: string,
  isValid: (value: unknown) => value is T,
  fallback: T
): T {
  try {
    const value = storage?.getItem(key);
    return isValid(value) ? value : fallback;
  } catch {
    return fallback;
  }
}

/** useState for a setting kept in localStorage across reloads. */
export function useStoredState<T extends string>(key: string, isValid: (value: unknown) => value is T, fallback: T) {
  const [value, setValue] = useState<T>(() => readStored(globalThis.localStorage, key, isValid, fallback));
  useEffect(() => {
    try {
      localStorage.setItem(key, value);
    } catch {
      // Storage unavailable (e.g. disabled): the setting just doesn't persist.
    }
  }, [key, value]);
  return [value, setValue] as const;
}
