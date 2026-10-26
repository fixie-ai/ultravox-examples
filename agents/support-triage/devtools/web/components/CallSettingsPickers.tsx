import React from 'react';
import { DETAILS_MODES, DetailsMode } from '../../../engine/decision/extraction';
import type { ObserverSetting } from '../../../engine/observer/settings';
import { CallSettings } from '../hooks/useCallSettings';
import Picker from './Picker';

const OBSERVER_LABELS: Record<ObserverSetting, string> = {
  off: 'Off',
  thread: 'Ultravox thread + HTTP tool',
  dataconnection: 'Data connection',
};
const DETAILS_LABELS: Record<DetailsMode, string> = {
  agent: 'Agent passes them',
  jev: 'Jev checks each field',
  extract: 'Extraction thread',
};
const MODEL_LABELS = { default: "default (Ultravox's default)" };

/** The pickers for how the next test call is set up. */
const CallSettingsPickers: React.FC<{ settings: CallSettings; disabled: boolean }> = ({ settings, disabled }) => (
  <>
    <Picker
      label="model"
      title="The Ultravox model (each model is its own saved agent)"
      value={settings.model}
      options={[...new Set(['default', ...settings.models, settings.model])]}
      labels={MODEL_LABELS}
      disabled={disabled}
      onChange={settings.setModel}
    />
    <Picker
      label="observer"
      title="Checks every caller turn with Jev and acts when the agent didn't"
      value={settings.observer}
      options={settings.observers}
      labels={OBSERVER_LABELS}
      disabled={disabled}
      onChange={settings.setObserver}
    />
    <Picker
      label="details"
      title="How the caller's free-text answers (e.g. when it started) get recorded"
      value={settings.details}
      options={DETAILS_MODES}
      labels={DETAILS_LABELS}
      disabled={disabled}
      onChange={settings.setDetails}
    />
  </>
);

export default CallSettingsPickers;
