import React from 'react';
import { Input, SelectDropdown } from '../../../components/ui';
import type { MmChallanField } from '../lib/mmV4Rpc';

export function MmChallanFieldInputs({
  fields,
  values,
  onChange,
}: {
  fields: MmChallanField[];
  values: Record<string, string>;
  onChange: (key: string, value: string) => void;
}) {
  return (
    <>
      {fields.map((field) => {
        const key = field.key ?? '';
        if (!key) return null;
        const label = field.required ? `${field.label} *` : field.label;
        if (field.type === 'select') {
          return (
            <SelectDropdown size="compact"
              key={key}
              label={label}
              value={values[key] ?? ''}
              onChange={(value) => onChange(key, value)}
              options={[
                { value: '', label: 'Select' },
                ...(field.options ?? []).map((option) => ({ value: option, label: option })),
              ]}
            />
          );
        }
        return (
          <Input
            key={key}
            label={label}
            type={field.type === 'number' ? 'number' : 'text'}
            value={values[key] ?? ''}
            onChange={(event) => onChange(key, event.target.value)}
          />
        );
      })}
    </>
  );
}
