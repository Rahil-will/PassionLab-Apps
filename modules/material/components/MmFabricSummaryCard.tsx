import React, { useEffect, useState } from 'react';
import { Image as ImageIcon, Layers, type LucideIcon } from 'lucide-react';
import { Card } from '../../../components/ui';

export interface MmFabricSummary {
  style_name?: string | null;
  style_ref?: string | null;
  color_name?: string | null;
  color_ref?: string | null;
  fabric_color?: string | null;
  buyer_name?: string | null;
  po_number?: string | null;
  image_url?: string | null;
  fabric_name?: string | null;
  fabric_code?: string | null;
  fabric_type?: string | null;
  fabric_category?: string | null;
  fabric_ref_name?: string | null;
  batch_no?: string | null;
  lot_no?: string | null;
}

export function MmSummaryMetric({
  icon: Icon,
  label,
  primary,
  secondary,
  tone = 'default',
}: {
  icon: LucideIcon;
  label: string;
  primary: string;
  secondary?: string;
  tone?: 'default' | 'blue';
}) {
  const blue = tone === 'blue';
  return (
    <div
      className={`rounded-xl px-3 py-2.5 min-w-0 flex items-start gap-2.5 ${
        blue ? 'border border-blue-100 bg-blue-50/70' : 'border border-slate-200 bg-slate-50/70'
      }`}
    >
      <span
        className={`w-8 h-8 rounded-full flex items-center justify-center shrink-0 mt-0.5 ${
          blue ? 'bg-white border border-blue-100' : 'bg-white border border-slate-200'
        }`}
      >
        <Icon size={14} className={blue ? 'text-blue-600' : 'text-slate-500'} />
      </span>
      <div className="min-w-0">
        <p className={`text-[10px] font-semibold uppercase tracking-wide ${blue ? 'text-blue-600' : 'text-slate-400'}`}>
          {label}
        </p>
        <p className={`text-[13px] font-semibold mt-0.5 truncate ${blue ? 'text-slate-900' : 'text-slate-800'}`} title={primary}>
          {primary || '—'}
        </p>
        {secondary ? (
          <p className={`text-[11px] mt-0.5 truncate ${blue ? 'text-blue-800/80' : 'text-slate-500'}`} title={secondary}>
            {secondary}
          </p>
        ) : null}
      </div>
    </div>
  );
}

function typeCategoryLine(data?: MmFabricSummary | null): string {
  return fabricTypeCategoryLine(data?.fabric_type, data?.fabric_category);
}

export function fabricTypeCategoryLine(
  type?: string | null,
  category?: string | null,
): string {
  const typeName = (type ?? '').trim();
  const raw = (category ?? '').trim();
  const catalog = !raw || raw.toLowerCase() === 'fabric' || raw.toLowerCase() === 'trim' ? '' : raw;
  if (typeName && catalog && typeName.toLowerCase() !== catalog.toLowerCase()) {
    return `${typeName} | ${catalog}`;
  }
  return typeName || catalog || '—';
}

function Chip({ children }: { children: React.ReactNode }) {
  return (
    <span className="px-2 py-0.5 rounded-full border border-slate-200 bg-white text-[10px] font-medium text-slate-600">
      {children}
    </span>
  );
}

export function MmFabricSummaryCard({
  data,
  extraMetrics,
  onStyleClick,
  imageSize = 'default',
  hideImage = false,
  splitColours = false,
  title = 'Fabric details',
  showFabric = true,
}: {
  data?: MmFabricSummary | null;
  extraMetrics?: React.ReactNode;
  onStyleClick?: () => void;
  imageSize?: 'default' | 'large';
  hideImage?: boolean;
  /** Style colour sits with the style ref. Fabric colour sits after the fabric name. */
  splitColours?: boolean;
  title?: string;
  showFabric?: boolean;
}) {
  const [imageError, setImageError] = useState(false);
  useEffect(() => {
    setImageError(false);
  }, [data?.image_url]);

  const heading = hideImage
    ? (data?.fabric_ref_name || data?.fabric_name || data?.fabric_type || '—')
    : (data?.style_name || '—');
  const colorLine = hideImage
    ? (data?.color_ref || data?.color_name || '—')
    : (data?.color_name || data?.color_ref || '—');
  const styleMeta = [data?.style_ref, data?.color_name].map((part) => (part ?? '').trim()).filter(Boolean).join(' · ');
  const fabricColor = (data?.fabric_color || data?.color_ref || '').trim();
  const fabricSecondary = [
    splitColours && fabricColor ? `Fabric color ${fabricColor}` : null,
    typeCategoryLine(data) === '—' ? null : typeCategoryLine(data),
  ].filter(Boolean).join(' · ');

  return (
    <Card className="shadow-sm border-slate-200 h-full" noPadding>
      <div className="px-5 py-4 h-full flex flex-col">
        <h4 className="text-[13px] font-semibold text-slate-900 flex items-center gap-2 mb-3">
          <Layers size={16} className="text-primary-600" />
          {title}
        </h4>
        <div className="flex items-stretch gap-4 flex-1 min-h-0">
          {hideImage ? null : (
            <div
              className={`rounded-2xl border border-slate-200 bg-slate-50 overflow-hidden shrink-0 self-stretch flex items-center justify-center ${
                imageSize === 'large' ? 'w-[6.75rem]' : 'w-32'
              }`}
            >
              {data?.image_url && !imageError ? (
                <img
                  src={data.image_url}
                  alt=""
                  className="w-full h-full object-cover object-top"
                  onError={() => setImageError(true)}
                />
              ) : (
                <ImageIcon size={imageSize === 'large' ? 32 : 24} className="text-slate-300" />
              )}
            </div>
          )}
          <div className="min-w-0 flex-1 flex flex-col">
            {onStyleClick && !hideImage && data?.style_name ? (
              <button
                type="button"
                className="text-[15px] font-bold text-slate-900 leading-tight truncate max-w-full hover:text-primary-700 hover:underline text-left"
                title={data.style_name}
                onClick={onStyleClick}
              >
                {data.style_name}
              </button>
            ) : (
              <p className="text-[15px] font-bold text-slate-900 leading-tight truncate" title={heading}>
                {heading}
              </p>
            )}
            <p className="text-[12px] text-slate-500 mt-0.5 truncate">
              {splitColours && !hideImage ? (styleMeta || '—') : colorLine}
            </p>
            <div className="flex flex-wrap gap-1.5 mt-2">
              {hideImage ? (
                <>
                  {data?.fabric_type ? <Chip>{data.fabric_type}</Chip> : null}
                  {data?.fabric_ref_name ? <Chip>Ref {data.fabric_ref_name}</Chip> : null}
                  {data?.color_ref ? <Chip>Color {data.color_ref}</Chip> : null}
                  {data?.lot_no ? <Chip>Lot {data.lot_no}</Chip> : null}
                  {data?.batch_no ? <Chip>Batch {data.batch_no}</Chip> : null}
                </>
              ) : (
                <>
                  {data?.buyer_name ? <Chip>{data.buyer_name}</Chip> : null}
                  {splitColours ? null : (data?.style_ref ? <Chip>{data.style_ref}</Chip> : null)}
                  {data?.po_number ? <Chip>PO {data.po_number}</Chip> : null}
                  {data?.fabric_ref_name ? <Chip>Ref {data.fabric_ref_name}</Chip> : null}
                  {splitColours ? null : (data?.color_ref ? <Chip>Color {data.color_ref}</Chip> : null)}
                </>
              )}
            </div>
            {showFabric || extraMetrics ? (
              <div className="mt-auto pt-3 flex flex-col gap-2.5">
                {showFabric ? (
                  <MmSummaryMetric
                    icon={Layers}
                    label="Fabric"
                    primary={
                      data?.fabric_code
                        ? `${data.fabric_code}${data.fabric_name ? ` · ${data.fabric_name}` : ''}`
                        : (data?.fabric_name || data?.fabric_ref_name || '—')
                    }
                    secondary={splitColours ? (fabricSecondary || undefined) : typeCategoryLine(data)}
                  />
                ) : null}
                {extraMetrics}
              </div>
            ) : null}
          </div>
        </div>
      </div>
    </Card>
  );
}
