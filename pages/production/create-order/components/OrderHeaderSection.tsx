import React from 'react';
import { Upload } from 'lucide-react';
import { Button, Card, Input, SelectDropdown } from '../../../../components/ui';
import { LabeledDatePicker } from '../../../../components/SingleDatePicker';
import { tokens } from '../../../../lib/designTokens';
import type { Buyer } from '../../../../types';
import { ORDER_TYPE_LABELS, type OrderPriority, type OrderType } from '../../../../types';
import type { HeaderAction, HeaderState } from '../hooks/useHeaderReducer';

const fieldLabelClass = 'block font-medium text-slate-700 mb-1.5';
const fieldLabelStyle = { fontSize: tokens.fontSize.body };

interface OrderHeaderSectionProps {
  headerState: HeaderState;
  headerDispatch: React.Dispatch<HeaderAction>;
  errors: Record<string, string>;
  buyers: Buyer[];
  sizeGroupDropdownOptions: { value: string; label: string }[];
  garmentTypes: string[];
  merchantNames: string[];
  seasons: string[];
  previewInternalNo: string;
  onSizeGroupChange: (value: string) => void;
}

export const OrderHeaderSection: React.FC<OrderHeaderSectionProps> = ({
  headerState,
  headerDispatch,
  errors,
  buyers,
  sizeGroupDropdownOptions,
  garmentTypes,
  merchantNames,
  seasons,
  previewInternalNo,
  onSizeGroupChange,
}) => {
  const setField = <K extends keyof HeaderState>(field: K, value: HeaderState[K]) => {
    headerDispatch({ type: 'setField', field, value });
  };

  return (
    <div className="col-span-12 flex flex-col lg:flex-row gap-6 items-stretch">
      <div className="lg:w-[70%] w-full min-w-0 flex flex-col">
        <Card
          title="Style Information"
          subtitle="Style, order details & control parameters"
          className="shadow-sm border-slate-200 h-full"
          action={
            <div className="text-right shrink-0">
              <p className="text-[9px] font-bold uppercase tracking-wide text-slate-400">Internal order</p>
              <p className="text-[11px] font-bold text-slate-700 tabular-nums mt-0.5">{previewInternalNo || '—'}</p>
            </div>
          }
        >
          <div className="space-y-4">
            <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
              <Input
                id="style-name"
                name="styleName"
                label="Style Name"
                placeholder="e.g. Basic Tee"
                value={headerState.styleName}
                onChange={(e: React.ChangeEvent<HTMLInputElement>) => setField('styleName', e.target.value)}
                className="bg-white"
                error={errors.styleName}
              />
              <Input
                id="style-ref"
                name="styleRef"
                label="Style Ref No."
                placeholder="e.g. ST-2026-001"
                value={headerState.styleRef}
                onChange={(e: React.ChangeEvent<HTMLInputElement>) => setField('styleRef', e.target.value)}
                className="bg-white"
                error={errors.styleRef}
              />
              <SelectDropdown
                id="order-type"
                name="orderType"
                label="Order type"
                value={headerState.orderType}
                onChange={(v: string) => setField('orderType', v as OrderType)}
                options={[
                  { value: 'new', label: ORDER_TYPE_LABELS.new },
                  { value: 'repeat', label: ORDER_TYPE_LABELS.repeat },
                ]}
                className="w-full"
              />
            </div>

            <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
              <Input
                id="po-number"
                name="poNumber"
                label="PO Number"
                placeholder="PO-XXXXX"
                value={headerState.poNumber}
                onChange={(e: React.ChangeEvent<HTMLInputElement>) => setField('poNumber', e.target.value)}
                error={errors.poNumber}
                className="bg-white"
              />
              <SelectDropdown
                id="buyer"
                name="buyer"
                label="Buyer"
                value={headerState.selectedBuyer}
                onChange={(v: string) => headerDispatch({ type: 'setBuyer', buyerId: v })}
                options={[{ value: '', label: 'Select...' }, ...buyers.map((b) => ({ value: b.id, label: b.name }))]}
                error={errors.selectedBuyer}
                className="w-full"
              />
              <SelectDropdown
                id="size-group"
                name="sizeGroup"
                label="Size Group"
                value={headerState.sizeGroupSelection}
                onChange={(v: string) => onSizeGroupChange(v)}
                options={[
                  { value: '', label: headerState.selectedBuyer ? 'Select...' : 'Select Buyer First' },
                  ...sizeGroupDropdownOptions,
                ]}
                error={errors.selectedSizeGroup}
                className="w-full"
              />
            </div>

            <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
              <SelectDropdown
                id="garment-type"
                name="garmentType"
                label="Product Type"
                value={headerState.garmentType}
                onChange={(v: string) => setField('garmentType', v)}
                options={[{ value: '', label: 'Select...' }, ...garmentTypes.map((t) => ({ value: t, label: t }))]}
                className="w-full"
              />
              <SelectDropdown
                id="merchant-name"
                name="merchantName"
                label="Merchant Name"
                value={headerState.merchantName}
                onChange={(v: string) => setField('merchantName', v)}
                options={[{ value: '', label: 'Select...' }, ...merchantNames.map((m) => ({ value: m, label: m }))]}
                className="w-full"
              />
              <Input
                id="sewing-sam"
                name="sewingSam"
                label="Sewing SAM (reference)"
                type="number"
                placeholder="e.g. 12.5"
                value={headerState.sewingSam}
                onChange={(e: React.ChangeEvent<HTMLInputElement>) => setField('sewingSam', e.target.value)}
                className="bg-white"
              />
            </div>

            <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
              <SelectDropdown
                id="season"
                name="season"
                label="Season"
                value={headerState.season}
                onChange={(v: string) => setField('season', v)}
                options={[{ value: '', label: 'Select...' }, ...seasons.map((s) => ({ value: s, label: s }))]}
                className="w-full"
              />
              <LabeledDatePicker
                label="Order Received Date"
                value={headerState.orderDate}
                onChange={(v: string) => setField('orderDate', v)}
                labelClassName={fieldLabelClass}
                variant="pill"
              />
              <LabeledDatePicker
                label="Job Card Date"
                value={headerState.jobCardDate}
                onChange={(v: string) => setField('jobCardDate', v)}
                labelClassName={fieldLabelClass}
                variant="pill"
              />
            </div>

            <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
              <div>
                <SelectDropdown
                  id="priority"
                  name="priority"
                  label="Priority"
                  value={headerState.priority}
                  onChange={(v: string) => setField('priority', v as OrderPriority)}
                  options={[
                    { value: 'normal', label: 'Normal' },
                    { value: 'high', label: 'High' },
                    { value: 'critical', label: 'Critical' },
                  ]}
                  className="w-full"
                />
                {headerState.priority === 'high' && (
                  <p className="mt-1 text-[10px] font-semibold text-amber-600">⚑ High priority order</p>
                )}
                {headerState.priority === 'critical' && (
                  <p className="mt-1 text-[10px] font-semibold text-red-600">⚑ Critical — expedite this order</p>
                )}
              </div>
              <Input
                id="cutting-allowance"
                name="cuttingAllowance"
                label="Cutting Allowance %"
                type="number"
                placeholder="e.g. 2"
                value={headerState.cuttingAllowance}
                onChange={(e: React.ChangeEvent<HTMLInputElement>) =>
                  setField('cuttingAllowance', parseFloat(e.target.value) || 0)
                }
                className="bg-white"
              />
              <div>
                <label className={fieldLabelClass} style={fieldLabelStyle}>
                  Shipment Allowance
                </label>
                <div
                  className="mt-1 flex items-center h-7 px-2 rounded-lg border border-slate-200 bg-white gap-2.5 cursor-pointer select-none"
                  onClick={() => setField('applyExtraAllowance', !headerState.applyExtraAllowance)}
                >
                  <input
                    type="checkbox"
                    checked={headerState.applyExtraAllowance}
                    readOnly
                    className="w-3.5 h-3.5 rounded accent-blue-600 cursor-pointer shrink-0"
                  />
                  <span className="text-[11px] text-slate-700 leading-none">
                    Apply{' '}
                    <span className={`font-bold ${headerState.applyExtraAllowance ? 'text-blue-700' : 'text-slate-400'}`}>
                      {buyers.find((b) => b.id === headerState.selectedBuyer)?.overShipmentAllowance || 0}%
                    </span>{' '}
                    over-shipment
                  </span>
                </div>
              </div>
            </div>

            <p className="text-[11px] text-slate-500 bg-slate-50 border border-slate-100 rounded-lg px-3 py-2">
              Routing is assigned per color in Planning after the order is saved.
            </p>
          </div>
        </Card>
      </div>

      <div className="w-full lg:w-[30%] shrink-0 flex flex-col min-h-[20rem]">
        <Card title="Style Image" className="shadow-sm border-slate-200 flex flex-col p-0 h-full min-h-[20rem] overflow-hidden" noPadding>
          <div className="flex flex-col h-full min-h-[20rem] overflow-hidden rounded-xl">
            <div className="bg-slate-50 relative group flex items-center justify-center flex-[4] min-h-[12rem] w-full overflow-hidden">
              {headerState.styleImage && !headerState.showImageInput ? (
                <>
                  <img src={headerState.styleImage} alt="Style" className="absolute inset-0 w-full h-full object-cover" />
                  <div className="absolute inset-0 bg-black/40 opacity-0 group-hover:opacity-100 transition-opacity flex items-center justify-center">
                    <Button variant="secondary" size="sm" onClick={() => headerDispatch({ type: 'setImage', image: headerState.styleImage, showInput: true })}>
                      Change URL
                    </Button>
                  </div>
                </>
              ) : (
                <div className="p-4 flex flex-col items-center justify-center w-full h-full">
                  {!headerState.showImageInput ? (
                    <div
                      onClick={() => headerDispatch({ type: 'setImage', image: headerState.styleImage, showInput: true })}
                      className="cursor-pointer text-center text-slate-400 hover:text-blue-500 transition-colors flex flex-col items-center justify-center h-full select-none"
                    >
                      <Upload size={32} className="mb-3 text-slate-300" />
                      <span className="text-[10px] font-bold uppercase tracking-wider">Click to Add Image</span>
                    </div>
                  ) : (
                    <div className="w-full space-y-3">
                      <Input
                        id="style-image-url"
                        name="styleImage"
                        placeholder="Image URL..."
                        value={headerState.styleImage}
                        onChange={(e: React.ChangeEvent<HTMLInputElement>) =>
                          headerDispatch({ type: 'setImage', image: e.target.value, showInput: true })
                        }
                        autoFocus
                        className="bg-white"
                      />
                      <div className="flex gap-2">
                        <Button size="sm" onClick={() => headerDispatch({ type: 'setImage', image: headerState.styleImage, showInput: false })} className="flex-1 h-8 text-[10px]">
                          Load
                        </Button>
                        <Button
                          size="sm"
                          variant="ghost"
                          onClick={() => headerDispatch({ type: 'setImage', image: '', showInput: false })}
                          className="h-8 text-[10px]"
                        >
                          Clear
                        </Button>
                      </div>
                    </div>
                  )}
                </div>
              )}
            </div>
            <div className="flex-[1] min-h-[4.5rem] border-t border-slate-200 flex flex-col bg-white rounded-b-xl pb-3">
              <label htmlFor="order-remarks" className="px-3 pt-2 text-[9px] font-bold uppercase tracking-wide text-slate-400 shrink-0">
                Remarks
              </label>
              <textarea
                id="order-remarks"
                name="remarks"
                className="flex-1 w-full bg-transparent border-0 px-3 pb-1 pt-1 text-[11px] text-slate-700 focus:outline-none resize-none shadow-none min-h-[3rem]"
                placeholder="Production notes…"
                value={headerState.remarks}
                onChange={(e: React.ChangeEvent<HTMLTextAreaElement>) => setField('remarks', e.target.value)}
              />
            </div>
          </div>
        </Card>
      </div>
    </div>
  );
};
