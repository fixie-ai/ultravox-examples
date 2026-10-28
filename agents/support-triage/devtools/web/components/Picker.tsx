interface PickerProps<T extends string> {
  label: string;
  /** Tooltip explaining the setting. */
  title: string;
  value: T;
  options: readonly T[];
  /** Display text per option; the option itself if missing. */
  labels?: Partial<Record<T, string>>;
  disabled: boolean;
  onChange: (value: T) => void;
}

/** A labeled select in the developer tools bar. */
function Picker<T extends string>({ label, title, value, options, labels, disabled, onChange }: PickerProps<T>) {
  return (
    <label className="flex items-center gap-1" title={title}>
      <span className="text-slate-400">{label}</span>
      <select
        className="bg-slate-700 text-slate-100 rounded px-1.5 py-0.5 disabled:opacity-50"
        value={value}
        disabled={disabled}
        onChange={(event) => onChange(event.target.value as T)}
      >
        {options.map((option) => (
          <option key={option} value={option}>
            {labels?.[option] ?? option}
          </option>
        ))}
      </select>
    </label>
  );
}

export default Picker;
