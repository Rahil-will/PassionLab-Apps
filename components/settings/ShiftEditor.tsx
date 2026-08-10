import React, { useMemo, useState } from 'react';
import { Input, Button } from '../ui';
import { Clock, Plus, Trash2, Sun, Moon, Coffee, AlertCircle, AlertTriangle } from 'lucide-react';
import { tokens } from '../../lib/designTokens';
import { useShiftsCatalog } from '../../lib/queries/settingsSlices';
import { useNavigationStore } from '../../stores';
import { DesktopWriteGate } from '../DesktopWriteGate';

interface HourBlock {
  id: string;
  start: string;
  end: string;
  type: 'active' | 'break';
  label?: string;
}

interface ShiftEditorProps {
  formData: any;
  setFormData: (d: any) => void;
  onSave?: () => void;
  onDelete?: () => void;
}

// Helpers
const timeToMin = (t: string) => {
  if (!t) return 0;
  const [h, m] = t.split(':').map(Number);
  return h * 60 + m;
};
const minToTime = (m: number) => {
  const h = Math.floor(m / 60);
  const mm = m % 60;
  return `${String(h).padStart(2, '0')}:${String(mm).padStart(2, '0')}`;
};
const fmtTime = (t: string) => {
  if (!t) return '';
  const [h, m] = t.split(':').map(Number);
  const ampm = h >= 12 ? 'pm' : 'am';
  const h12 = h === 0 ? 12 : h > 12 ? h - 12 : h;
  return m === 0 ? `${h12}${ampm}` : `${h12}:${String(m).padStart(2, '0')}${ampm}`;
};

export const ShiftEditor: React.FC<ShiftEditorProps> = ({
  formData,
  setFormData,
  onSave,
  onDelete,
}) => {
  const { factoryId } = useNavigationStore();
  const { shifts } = useShiftsCatalog(factoryId, 'full');
  const hours: HourBlock[] = formData.hours || [];

  // Check if this shift's time range conflicts with other shifts
  const timeConflict = useMemo(() => {
    if (!formData.name || hours.length === 0) return null;
    const myStart = hours[0]?.start;
    const myEnd = hours[hours.length - 1]?.end;
    if (!myStart || !myEnd) return null;
    for (const other of shifts) {
      if (other.id === formData.id) continue;
      if (!other.hours || other.hours.length === 0) continue;
      const otherStart = other.hours[0]?.start;
      const otherEnd = other.hours[other.hours.length - 1]?.end;
      if (!otherStart || !otherEnd) continue;
      // Check overlap: two ranges overlap if start1 < end2 && start2 < end1
      if (timeToMin(myStart) < timeToMin(otherEnd) && timeToMin(otherStart) < timeToMin(myEnd)) {
        return `Time overlaps with "${other.name}" (${fmtTime(otherStart)}–${fmtTime(otherEnd)})`;
      }
    }
    return null;
  }, [hours, shifts, formData.id, formData.name]);

  const setHours = (newHours: HourBlock[]) => {
    setFormData({ ...formData, hours: newHours });
  };

  // Get the next available start time (= end of last block, or 08:00)
  const nextStart = useMemo(() => {
    if (hours.length === 0) return '08:00';
    return hours[hours.length - 1].end;
  }, [hours]);

  // Compute default end = start + 60min
  const addBlock = (type: 'active' | 'break') => {
    const startMin = timeToMin(nextStart);
    const duration = type === 'break' ? 15 : 60;
    const endMin = startMin + duration;
    const newBlock: HourBlock = {
      id: Date.now().toString(),
      start: nextStart,
      end: minToTime(endMin),
      type,
      label: type === 'break' ? 'Break' : '',
    };
    setHours([...hours, newBlock]);
  };

  const updateBlock = (id: string, field: keyof HourBlock, value: string) => {
    setHours(hours.map(h => h.id === id ? { ...h, [field]: value } : h));
  };

  const removeBlock = (id: string) => {
    setHours(hours.filter(h => h.id !== id));
  };

  // Validation: check for overlaps/gaps
  const issues = useMemo(() => {
    const msgs: string[] = [];
    for (let i = 1; i < hours.length; i++) {
      if (hours[i].start !== hours[i - 1].end) {
        msgs.push(`Gap or overlap between block ${i} and ${i + 1}`);
      }
    }
    for (const h of hours) {
      if (timeToMin(h.end) <= timeToMin(h.start)) {
        msgs.push(`Block "${fmtTime(h.start)}-${fmtTime(h.end)}" has invalid times`);
      }
    }
    return msgs;
  }, [hours]);

  // Summary stats
  const totalMin = useMemo(() => {
    if (hours.length === 0) return 0;
    return timeToMin(hours[hours.length - 1].end) - timeToMin(hours[0].start);
  }, [hours]);
  const activeMin = useMemo(() => hours.filter(h => h.type === 'active').reduce((s, h) => s + (timeToMin(h.end) - timeToMin(h.start)), 0), [hours]);
  const breakMin = useMemo(() => hours.filter(h => h.type === 'break').reduce((s, h) => s + (timeToMin(h.end) - timeToMin(h.start)), 0), [hours]);

  const getIcon = (hour: number) => {
    if (hour >= 6 && hour < 12) return <Sun size={13} className="text-amber-500" />;
    if (hour >= 12 && hour < 17) return <Sun size={13} className="text-orange-500" />;
    if (hour >= 17 && hour < 20) return <Sun size={13} className="text-purple-500" />;
    return <Moon size={13} className="text-indigo-500" />;
  };

  return (
    <div className="w-full">
      <div className="grid grid-cols-1 lg:grid-cols-[280px_1fr] gap-5">
        {/* LEFT: Shift Details + Summary stacked */}
        <div className="space-y-5">
          <div className="bg-white p-5 rounded-xl border border-slate-200 shadow-sm">
            <h4 className="text-xs font-bold text-slate-800 mb-4 flex items-center gap-2">
              <Clock size={16} /> Shift Details
            </h4>
            <div className="space-y-4">
              <Input
                label="Shift Name"
                placeholder="e.g. Morning Shift"
                value={formData.name}
                onChange={(e) => setFormData({ ...formData, name: e.target.value })}
                className="bg-white"
              />
              <div>
                <label className="block font-medium mb-1.5 text-slate-700" style={{ fontSize: tokens.fontSize.body }}>Shift Type</label>
                {(() => {
                  const otherRegularExists = shifts.some((s) => s.id !== formData.id && (s.type || 'Regular') === 'Regular');
                  const isRegular = (formData.type || 'Regular') === 'Regular';
                  return (
                    <select
                      value={formData.type || 'Regular'}
                      onChange={(e) => setFormData({ ...formData, type: e.target.value })}
                      disabled={isRegular && otherRegularExists === false}
                      className="w-full px-3 py-2 text-xs rounded-lg border border-slate-200 bg-white focus:outline-none focus:ring-2 focus:ring-blue-200 disabled:opacity-60"
                    >
                      <option value="Regular" disabled={otherRegularExists && !isRegular}>Regular {otherRegularExists && !isRegular ? '(already exists)' : ''}</option>
                      <option value="OT">OT (Overtime)</option>
                    </select>
                  );
                })()}
              </div>
            </div>

            {timeConflict && (
              <div className="mt-3 p-2.5 rounded-lg bg-amber-50 border border-amber-200 flex items-center gap-2">
                <AlertTriangle size={12} className="text-amber-600 flex-shrink-0" />
                <span className="text-[10px] text-amber-700 font-medium">{timeConflict}</span>
              </div>
            )}
          </div>

          {/* Summary */}
          <div className="bg-white p-5 rounded-xl border border-slate-200 shadow-sm">
            <h4 className="text-xs font-bold text-slate-800 mb-4">Shift Summary</h4>
            {hours.length === 0 ? (
              <div className="text-center py-4 text-slate-400 text-xs italic">Add hours to see summary</div>
            ) : (
              <>
                <div className="grid grid-cols-3 gap-2">
                  <div className="p-2.5 rounded-lg bg-slate-50 border border-slate-200 text-center">
                    <div className="text-sm font-bold text-slate-800">{Math.floor(totalMin / 60)}h {totalMin % 60 > 0 ? `${totalMin % 60}m` : ''}</div>
                    <div className="text-[9px] font-medium text-slate-500 uppercase">Total</div>
                  </div>
                  <div className="p-2.5 rounded-lg bg-blue-50 border border-blue-200 text-center">
                    <div className="text-sm font-bold text-blue-700">{Math.floor(activeMin / 60)}h {activeMin % 60 > 0 ? `${activeMin % 60}m` : ''}</div>
                    <div className="text-[9px] font-medium text-blue-500 uppercase">Working</div>
                  </div>
                  <div className="p-2.5 rounded-lg bg-amber-50 border border-amber-200 text-center">
                    <div className="text-sm font-bold text-amber-700">{breakMin}m</div>
                    <div className="text-[9px] font-medium text-amber-500 uppercase">Break</div>
                  </div>
                </div>
                <div className="mt-3 flex items-center gap-2 text-[10px] text-slate-500">
                  <Clock size={11} />
                  <span>{fmtTime(hours[0].start)} &ndash; {fmtTime(hours[hours.length - 1].end)}</span>
                </div>
              </>
            )}
          </div>
        </div>

        {/* RIGHT: Hour Builder */}
        <div className="bg-white p-5 rounded-xl border border-slate-200 shadow-sm">
        <div className="flex items-center justify-between mb-4">
          <h4 className="text-xs font-bold text-slate-800 flex items-center gap-2">
            <Clock size={16} /> Hour Builder
          </h4>
          <DesktopWriteGate>
          <div className="flex gap-2">
            <button
              onClick={() => addBlock('active')}
              className="flex items-center gap-1 px-2.5 py-1.5 text-[10px] font-medium bg-blue-50 text-blue-700 border border-blue-200 rounded-lg hover:bg-blue-100 transition-colors"
            >
              <Plus size={12} /> Active Hour
            </button>
            <button
              onClick={() => addBlock('break')}
              className="flex items-center gap-1 px-2.5 py-1.5 text-[10px] font-medium bg-amber-50 text-amber-700 border border-amber-200 rounded-lg hover:bg-amber-100 transition-colors"
            >
              <Coffee size={12} /> Break
            </button>
          </div>
          </DesktopWriteGate>
        </div>

        {hours.length === 0 ? (
          <div className="text-center py-8 text-slate-400 text-xs italic border-2 border-dashed border-slate-200 rounded-lg">
            No hours added yet. Click "Active Hour" or "Break" to start building.
          </div>
        ) : (
          <div className="space-y-2">
            {hours.map((block, idx) => {
              const dur = timeToMin(block.end) - timeToMin(block.start);
              const h = Math.floor(timeToMin(block.start) / 60);
              return (
                <div
                  key={block.id}
                  className={`flex items-center gap-3 p-3 rounded-lg border transition-colors ${
                    block.type === 'break'
                      ? 'bg-amber-50/50 border-amber-200'
                      : 'bg-slate-50/50 border-slate-200'
                  }`}
                >
                  <span className="text-[10px] font-bold text-slate-400 w-5 text-center">{idx + 1}</span>
                  <div className={`w-2 h-8 rounded-full ${block.type === 'break' ? 'bg-amber-400' : 'bg-blue-400'}`} />
                  {block.type === 'break' ? (
                    <Coffee size={13} className="text-amber-600 flex-shrink-0" />
                  ) : (
                    <span className="flex-shrink-0">{getIcon(h)}</span>
                  )}
                  <input
                    type="time"
                    value={block.start}
                    onChange={(e) => updateBlock(block.id, 'start', e.target.value)}
                    className="px-2 py-1.5 text-xs rounded-lg border border-slate-200 bg-white w-24 focus:outline-none focus:ring-2 focus:ring-blue-100"
                  />
                  <span className="text-[10px] text-slate-400">to</span>
                  <input
                    type="time"
                    value={block.end}
                    onChange={(e) => updateBlock(block.id, 'end', e.target.value)}
                    className="px-2 py-1.5 text-xs rounded-lg border border-slate-200 bg-white w-24 focus:outline-none focus:ring-2 focus:ring-blue-100"
                  />
                  <select
                    value={block.type}
                    onChange={(e) => updateBlock(block.id, 'type', e.target.value)}
                    className={`px-2 py-1.5 text-[10px] font-bold rounded-lg border w-20 ${
                      block.type === 'break'
                        ? 'bg-amber-100 border-amber-300 text-amber-800'
                        : 'bg-blue-100 border-blue-300 text-blue-800'
                    }`}
                  >
                    <option value="active">Active</option>
                    <option value="break">Break</option>
                  </select>
                  {block.type === 'break' && (
                    <input
                      type="text"
                      value={block.label || ''}
                      onChange={(e) => updateBlock(block.id, 'label', e.target.value)}
                      placeholder="e.g. Tea Break"
                      className="px-2 py-1.5 text-xs rounded-lg border border-slate-200 bg-white flex-1 min-w-0 focus:outline-none focus:ring-2 focus:ring-amber-100"
                    />
                  )}
                  {block.type === 'active' && (
                    <span className="text-[10px] font-medium text-slate-500 flex-1">
                      {fmtTime(block.start)} &ndash; {fmtTime(block.end)}
                    </span>
                  )}
                  <span className={`text-[10px] font-medium px-2 py-0.5 rounded-full ${
                    block.type === 'break' ? 'bg-amber-200 text-amber-800' : 'bg-blue-100 text-blue-700'
                  }`}>
                    {dur > 0 ? `${dur}m` : '—'}
                  </span>
                  <DesktopWriteGate>
                  <button
                    onClick={() => removeBlock(block.id)}
                    className="p-1 rounded hover:bg-red-50 text-red-400 hover:text-red-600 transition-colors"
                  >
                    <Trash2 size={13} />
                  </button>
                  </DesktopWriteGate>
                </div>
              );
            })}
          </div>
        )}

        {issues.length > 0 && (
          <div className="mt-3 p-2.5 rounded-lg bg-red-50 border border-red-200">
            {issues.map((msg, i) => (
              <div key={i} className="flex items-center gap-1.5 text-[10px] text-red-700">
                <AlertCircle size={11} /> {msg}
              </div>
            ))}
          </div>
        )}
        </div>
      </div>
    </div>
  );
};
