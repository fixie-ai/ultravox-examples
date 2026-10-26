import { useEffect, useState } from 'react';
import { DetailsMode, isDetailsMode } from '../../../engine/decision/extraction';
import { isObserverSetting, OBSERVER_SETTINGS, ObserverSetting } from '../../../engine/observer/settings';
import { useStoredState } from './useStoredState';

const isModelName = (value: unknown): value is string => typeof value === 'string' && value.trim() !== '';

// Models to offer in the picker that this account's model list doesn't include (VITE_EXTRA_MODELS, comma-separated).
const EXTRA_MODELS = (import.meta.env.VITE_EXTRA_MODELS ?? '')
  .split(',')
  .map((name: string) => name.trim())
  .filter(Boolean);

/** How the next test call is set up, kept across reloads, plus the models this account can use and the observers the server can run. */
export function useCallSettings() {
  const [model, setModel] = useStoredState('model', isModelName, 'default');
  const [storedObserver, setObserver] = useStoredState('observer', isObserverSetting, 'off');
  const [details, setDetails] = useStoredState('details', isDetailsMode, 'agent');
  const [models, setModels] = useState<string[]>([]);
  const [observers, setObservers] = useState<ObserverSetting[]>(OBSERVER_SETTINGS);
  // The data-connection observer needs the decision model and OBSERVER_SECRET on the devtools server.
  const observer = observers.includes(storedObserver) ? storedObserver : 'off';

  useEffect(() => {
    fetch('/api/models')
      .then((response) => response.json())
      .then((body) => setModels([...new Set([...(body.models ?? []), ...EXTRA_MODELS])]))
      .catch(() => setModels(EXTRA_MODELS));
    fetch('/api/health')
      .then((response) => response.json())
      .then((body) => Array.isArray(body.observers) && setObservers(body.observers.filter(isObserverSetting)))
      .catch(() => {});
  }, []);

  return { model, setModel, observer, setObserver, details, setDetails, models, observers };
}

export type CallSettings = ReturnType<typeof useCallSettings>;
export type NewCall = { model: string; observer: ObserverSetting; details: DetailsMode };
