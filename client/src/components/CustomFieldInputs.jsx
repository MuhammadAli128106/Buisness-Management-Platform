// Ahmed — renders inputs for custom field definitions by type (F2.2).
// <CustomFieldInputs fields={defs} value={obj} onChange={(obj)=>…} errors={{}} />
// `errors` can use the server's keys ("custom.<key>") or the bare field key.
import { Checkbox, Field, Input, Select } from './ui';

export default function CustomFieldInputs({ fields = [], value = {}, onChange, errors = {} }) {
  if (!fields.length) return null;
  const set = (key, v) => onChange({ ...value, [key]: v });

  return (
    <div className="grid gap-3 sm:grid-cols-2">
      {fields.map((f) => {
        const err = errors[`custom.${f.key}`] || errors[f.key];
        const v = value[f.key];

        if (f.type === 'checkbox') {
          return (
            <div key={f.id || f.key} className="flex flex-col justify-end gap-1 pb-2">
              <Checkbox label={f.label} checked={v === true || v === 'true'} onChange={(e) => set(f.key, e.target.checked)} />
              {err && <p className="text-xs font-medium text-red-700">⚠ {err}</p>}
            </div>
          );
        }

        let control;
        if (f.type === 'dropdown') {
          control = (
            <Select placeholder="Choose…" value={v ?? ''} onChange={(e) => set(f.key, e.target.value)}
              options={(f.options || []).map((o) => ({ value: o, label: o }))} />
          );
        } else {
          control = <Input type={f.type === 'number' ? 'number' : f.type === 'date' ? 'date' : 'text'} step={f.type === 'number' ? 'any' : undefined}
            value={v ?? ''} onChange={(e) => set(f.key, e.target.value)} />;
        }
        return <Field key={f.id || f.key} label={f.label} error={err}>{control}</Field>;
      })}
    </div>
  );
}
