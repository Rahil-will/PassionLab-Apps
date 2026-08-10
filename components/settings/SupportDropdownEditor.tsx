import React, { useState } from 'react';
import { X, Plus, List, Save, Loader2 } from 'lucide-react';
import { Input } from '../ui';
import { DesktopWriteGate } from '../DesktopWriteGate';
import { tokens } from '../../lib/designTokens';

interface SupportDropdownEditorProps {
  formData: any;
  setFormData: (d: any) => void;
  onSave?: () => void;
  onDelete?: () => void;
  saving?: boolean;
}

export const SupportDropdownEditor: React.FC<SupportDropdownEditorProps> = ({
  formData,
  setFormData,
  onSave,
  saving,
}) => {
  const [newValue, setNewValue] = useState('');

  const values: string[] = formData.values || [];

  const addValue = () => {
    const trimmed = newValue.trim();
    if (!trimmed || values.includes(trimmed)) return;
    setFormData({ ...formData, values: [...values, trimmed] });
    setNewValue('');
  };

  const removeValue = (idx: number) => {
    setFormData({ ...formData, values: values.filter((_, i) => i !== idx) });
  };

  const updateValue = (idx: number, val: string) => {
    const newValues = [...values];
    newValues[idx] = val.trim();
    setFormData({ ...formData, values: newValues });
  };

  return (
    <div className="space-y-6 w-full">
      <div className="bg-white p-6 rounded-xl border border-slate-200 shadow-sm">
        <div className="flex items-center justify-between mb-6">
          <h4 className="text-xs font-bold text-slate-800 flex items-center gap-2">
            <List size={16} /> Support Dropdown Configuration
          </h4>
          {onSave && (
            <DesktopWriteGate>
              <button
                onClick={() => void onSave()}
                disabled={saving}
                className="flex items-center gap-1.5 px-3 py-1.5 bg-blue-600 text-white rounded-lg hover:bg-blue-700 disabled:opacity-50 disabled:cursor-not-allowed transition-colors text-xs font-medium"
              >
                {saving ? <Loader2 size={14} className="animate-spin" /> : <Save size={14} />}
                Save Changes
              </button>
            </DesktopWriteGate>
          )}
        </div>

        <div className="space-y-6">
          {/* App Name — read-only display label */}
          {formData.app_name && (
            <div>
              <label className="block font-medium text-slate-700 mb-1.5" style={{ fontSize: tokens.fontSize.body }}>
                Display Name
              </label>
              <div className="w-full bg-slate-50 border border-slate-200 rounded-lg py-2 px-3 text-xs text-slate-800 font-medium">
                {formData.app_name}
              </div>
              <p className="text-[10px] text-slate-400 mt-1">This name is shown in the app. It cannot be edited.</p>
            </div>
          )}

          <div>
            <label className="block font-medium text-slate-700 mb-2" style={{ fontSize: tokens.fontSize.body }}>
              Dropdown Values
            </label>

            {/* Existing values */}
            <div className="flex flex-wrap gap-2 mb-3">
              {values.map((val, idx) => (
                <div
                  key={idx}
                  className="flex items-center gap-1.5 bg-blue-50 text-blue-700 border border-blue-100 rounded-lg px-2.5 py-1.5 text-xs font-medium group"
                >
                  <DesktopWriteGate>
                    <>
                      <input
                        type="text"
                        value={val}
                        onChange={(e) => updateValue(idx, e.target.value)}
                        className="bg-transparent border-none outline-none w-24 text-xs font-medium text-blue-700 focus:ring-0 p-0"
                      />
                      <button
                        onClick={() => removeValue(idx)}
                        className="text-blue-300 hover:text-red-500 transition-colors"
                      >
                        <X size={12} />
                      </button>
                    </>
                  </DesktopWriteGate>
                </div>
              ))}
              {values.length === 0 && (
                <span className="text-xs text-slate-400 italic">No values added yet.</span>
              )}
            </div>

            {/* Add new value */}
            <DesktopWriteGate>
              <div className="flex gap-2">
                <input
                  type="text"
                  value={newValue}
                  onChange={(e) => setNewValue(e.target.value)}
                  onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); addValue(); } }}
                  placeholder="Add new option..."
                  className="flex-1 bg-white border border-slate-200 rounded-lg py-2 px-3 text-xs text-slate-800 focus:border-blue-500 focus:ring-2 focus:ring-blue-100 outline-none"
                />
                <button
                  onClick={addValue}
                  disabled={!newValue.trim()}
                  className="flex items-center gap-1 px-3 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 disabled:opacity-50 disabled:cursor-not-allowed text-xs font-medium transition-colors"
                >
                  <Plus size={12} /> Add
                </button>
              </div>
            </DesktopWriteGate>
          </div>
        </div>
      </div>
    </div>
  );
};
