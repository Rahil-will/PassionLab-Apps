import React, { useEffect, useMemo, useState } from 'react';
import {
  Plus,
  Trash2,
  Pencil,
  X,
  ClipboardList,
  Factory,
  Package,
  CheckCircle,
  FileText,
  ArrowRightLeft,
  Users,
  Warehouse,
  Building2,
  Truck,
} from 'lucide-react';
import { Button, Input, SelectDropdown } from '../ui';
import {
  CatalogTable,
  CatalogTableCell,
  CatalogTablePanel,
  CatalogTableRow,
  catalogSerialCellClass,
} from './CatalogTablePanel';
import { EditorSplitLayout } from './EditorSplitLayout';
import { DesktopWriteGate } from '../DesktopWriteGate';
import {
  OPERATION_STEP_TYPE_LABELS,
  type OperationRow,
  type OperationStepType,
} from '../../lib/operationsDb';
import {
  captureAppsForOperation,
  defaultCaptureAppForDepartment,
  isOriginDepartment,
  isOutsourceDepartment,
  isTerminalDepartment,
  operationFieldsLocked,
  stepTypeUsesCaptureApp,
  stepTypesForDepartment,
} from '../../lib/departmentOperationOptions';
import { isStoragePlanningDepartment } from '../../lib/departmentFilters';
import { labelForCaptureApp, labelForDeptApp, DEPT_APP_OPTIONS, OUTSOURCE_CAPTURE_APP } from '../../lib/floorApps';
import type { DeptAppId } from '../../lib/floorApps';
import type { DepartmentEntity, DepartmentPlanningMode } from '../../types/settings';

interface DepartmentOperationsPanelProps {
  factoryId: string;
  departmentId: string;
  departmentRole?: DepartmentEntity['role'];
  departmentPlanningMode?: DepartmentPlanningMode;
  departmentApps?: string[];
  rows: OperationRow[];
  factoryAllowedApps: Record<OperationStepType, string[]> | null;
  onOperationsChange: (rows: OperationRow[]) => void;
  readOnly?: boolean;
  showAudit?: boolean;
  showSupervisor?: boolean;
  terminalShipmentApps?: DeptAppId[];
}

function FloorAppCard({
  icon: Icon,
  title,
  description,
  accent,
}: {
  icon: React.ComponentType<{ size?: number; className?: string }>;
  title: string;
  description: string;
  accent?: 'emerald' | 'amber' | 'sky' | 'default';
}) {
  const iconCls =
    accent === 'emerald'
      ? 'bg-emerald-100 text-emerald-700'
      : accent === 'amber'
        ? 'bg-amber-100 text-amber-700'
        : accent === 'sky'
          ? 'bg-sky-100 text-sky-700'
          : 'bg-slate-100 text-slate-600';
  return (
    <div className="flex flex-col rounded-lg border border-slate-200 bg-white p-3 h-full min-h-[5.5rem]">
      <div className={`w-8 h-8 rounded-lg flex items-center justify-center shrink-0 mb-2 ${iconCls}`}>
        <Icon size={16} />
      </div>
      <div className="text-[11px] font-semibold text-slate-800 leading-tight">{title}</div>
      <p className="text-[10px] text-slate-500 mt-1 leading-relaxed flex-1">{description}</p>
    </div>
  );
}

type FloorAppsVariant = 'origin' | 'production' | 'outsource' | 'store' | 'terminal';

function TerminalShipmentAppsHeader({ shipmentApps }: { shipmentApps: DeptAppId[] }) {
  const cards = shipmentApps.map((appId) => {
    const opt = DEPT_APP_OPTIONS.find((o) => o.id === appId);
    return {
      icon: Truck,
      title: opt?.label ?? labelForDeptApp(appId),
      description: opt?.description
        ?? 'Shipment / QA screen on the terminal Dispatch operation.',
      accent: 'emerald' as const,
    };
  });

  return (
    <div>
      <p className="text-[9px] font-bold uppercase tracking-wide text-slate-400 mb-2">Floor apps</p>
      <div
        className="grid gap-2"
        style={{ gridTemplateColumns: `repeat(${Math.max(cards.length, 1)}, minmax(0, 1fr))` }}
      >
        {cards.map((card) => (
          <FloorAppCard key={card.title} {...card} />
        ))}
      </div>
      <p className="text-[10px] text-slate-400 mt-2">
        Dispatch uses one capture app — Shipment / QA — covering all entitled shipment screens on the floor.
      </p>
    </div>
  );
}

function FloorAppsReferenceGrid({
  variant,
  showAudit,
  showSupervisor,
}: {
  variant: FloorAppsVariant;
  showAudit: boolean;
  showSupervisor: boolean;
}) {
  const cards =
    variant === 'origin'
      ? [
          { icon: Package, title: 'Cutting lay', description: 'Lay report — bundles and workforce headcount per category, captured inside each lay session.' },
          { icon: ArrowRightLeft, title: 'Transaction', description: 'Handover between work centers. Supervisors use this only — no supervisory workforce allocation.' },
        ]
      : variant === 'store'
        ? [
            { icon: Warehouse, title: 'Store', description: 'No piece capture — send in from the previous work center, receive internally, then send to the next.', accent: 'amber' as const },
            { icon: ArrowRightLeft, title: 'Transaction', description: 'Challan in from upstream, receive at store, challan out to the next department.', accent: 'emerald' as const },
          ]
        : variant === 'outsource'
          ? [
              { icon: Building2, title: 'Outsource', description: 'Vendor send and receive — logged against the outsource capture app on this operation.', accent: 'sky' as const },
              { icon: ArrowRightLeft, title: 'Transaction', description: 'Out-challan to vendor, return-challan on receipt, then handover to the next department.', accent: 'emerald' as const },
            ]
          : [
              { icon: Factory, title: 'Hourly', description: 'Count capture on produce and loading.' },
              { icon: CheckCircle, title: 'Quality check', description: 'Piece-wise QC on assigned operations.' },
              { icon: Package, title: 'Batch', description: 'Batch-wise logs per session. Workforce logged inside each batch.' },
              { icon: ArrowRightLeft, title: 'Transaction', description: 'Handover between work centers. Always on.', accent: 'emerald' as const },
              ...(showSupervisor
                ? [{ icon: Users, title: 'Supervisory app', description: 'Supervisors allocate workforce and review style performance on Production paths.' }]
                : []),
              ...(showAudit
                ? [{ icon: FileText, title: 'Quality audit', description: 'Department AQL — always on, separate from production QC.' }]
                : []),
            ];

  return (
    <div>
      <p className="text-[9px] font-bold uppercase tracking-wide text-slate-400 mb-2">Floor apps</p>
      <div
        className="grid gap-2"
        style={{ gridTemplateColumns: `repeat(${cards.length}, minmax(0, 1fr))` }}
      >
        {cards.map((card) => (
          <FloorAppCard key={card.title} {...card} />
        ))}
      </div>
      <p className="text-[10px] text-slate-400 mt-2">
        {variant === 'production'
          ? 'Assign capture per operation below. Department apps are derived on save.'
          : variant === 'origin'
            ? 'Lay report captures output and workforce headcount. Supervisors handle handover only.'
            : variant === 'outsource'
              ? 'Transaction handles send and receive. Outsource work centers also expose the Outsource capture app for vendor movements.'
              : 'Transaction handles send and receive — no hourly, batch, or QC capture on this work center.'}
      </p>
    </div>
  );
}

type DraftStepType = OperationStepType | '';

function emptyDraft(
  role?: DepartmentEntity['role'],
  planningMode?: DepartmentPlanningMode,
): {
  name: string;
  step_type: DraftStepType;
  capture_app: string;
} {
  if (isOriginDepartment(role)) {
    return { name: '', step_type: 'produce', capture_app: 'cutting_lay' };
  }
  if (isOutsourceDepartment(role, planningMode)) {
    return { name: '', step_type: 'outsource', capture_app: OUTSOURCE_CAPTURE_APP };
  }
  if (isStoragePlanningDepartment({ role, planning_mode: planningMode })) {
    return { name: '', step_type: 'store', capture_app: '' };
  }
  return { name: '', step_type: '', capture_app: '' };
}

export function DepartmentOperationsPanel({
  factoryId,
  departmentId,
  departmentRole = 'standard',
  departmentPlanningMode,
  departmentApps = [],
  rows,
  factoryAllowedApps,
  onOperationsChange,
  readOnly = false,
  showAudit = true,
  showSupervisor = false,
  terminalShipmentApps = [],
}: DepartmentOperationsPanelProps) {
  const [draft, setDraft] = useState(() => emptyDraft(departmentRole, departmentPlanningMode));
  const [editingId, setEditingId] = useState<string | null>(null);

  const allowedAppsConfig = factoryAllowedApps ?? {
    loading: ['hourly'],
    produce: ['hourly', 'qc_log', 'batch', 'cutting_lay'],
    store: [],
    outsource: [],
  };

  const isOrigin = isOriginDepartment(departmentRole);
  const isOutsource = isOutsourceDepartment(departmentRole, departmentPlanningMode);
  const isStore = isStoragePlanningDepartment({
    role: departmentRole,
    planning_mode: departmentPlanningMode,
  });
  const isTerminal = isTerminalDepartment(departmentRole);
  const locked = operationFieldsLocked(departmentRole, departmentPlanningMode);
  const panelReadOnly = readOnly || isTerminal || isStore;
  const floorAppsVariant: FloorAppsVariant = isTerminal
    ? 'terminal'
    : isOrigin
      ? 'origin'
      : isStore
        ? 'store'
        : isOutsource
          ? 'outsource'
          : 'production';

  useEffect(() => {
    if (!editingId) {
      setDraft(emptyDraft(departmentRole, departmentPlanningMode));
    }
  }, [departmentRole, departmentPlanningMode, editingId]);

  const appsForStep = useMemo(() => {
    if (!draft.step_type) return [];
    return captureAppsForOperation(
      draft.step_type as OperationStepType,
      departmentApps,
      allowedAppsConfig,
      departmentRole,
    );
  }, [allowedAppsConfig, departmentApps, departmentRole, draft.step_type]);

  const stepTypeOptions = useMemo(
    () =>
      stepTypesForDepartment(departmentRole, departmentPlanningMode).map((t) => ({
        value: t,
        label: OPERATION_STEP_TYPE_LABELS[t],
      })),
    [departmentRole, departmentPlanningMode],
  );

  const usesCapture = draft.step_type
    ? stepTypeUsesCaptureApp(draft.step_type as OperationStepType)
    : false;

  const captureAppOptions = useMemo(() => {
    if (!usesCapture) {
      return [{ value: '', label: 'Date window only' }];
    }
    if (locked.captureApp && isOrigin) {
      return [{ value: 'cutting_lay', label: labelForCaptureApp('cutting_lay', 'produce') }];
    }
    if (locked.captureApp && isTerminal) {
      return [{ value: 'shipment_qa', label: labelForCaptureApp('shipment_qa', 'produce') }];
    }
    if (locked.captureApp && isOutsource) {
      return [{ value: OUTSOURCE_CAPTURE_APP, label: labelForCaptureApp(OUTSOURCE_CAPTURE_APP, 'outsource') }];
    }
    if (appsForStep.length === 0) {
      return [{ value: '', label: 'No capture apps entitled' }];
    }
    return appsForStep.map((a) => ({
      value: a,
      label: labelForCaptureApp(a, draft.step_type as OperationStepType),
    }));
  }, [appsForStep, draft.step_type, isOrigin, isTerminal, locked.captureApp, usesCapture]);

  const resetDraft = () => {
    setDraft(emptyDraft(departmentRole, departmentPlanningMode));
    setEditingId(null);
  };

  const startEdit = (row: OperationRow) => {
    setEditingId(row.id);
    const apps = captureAppsForOperation(row.step_type, departmentApps, allowedAppsConfig, departmentRole);
    setDraft({
      name: row.name,
      step_type: row.step_type,
      capture_app: row.capture_app || apps[0] || defaultCaptureAppForDepartment(departmentRole, departmentApps, departmentPlanningMode),
    });
  };

  const submitOperation = () => {
    if (!draft.name.trim() || !draft.step_type || panelReadOnly) return;
    const stepType = draft.step_type as OperationStepType;
    const captureApp = stepType === 'outsource'
      ? OUTSOURCE_CAPTURE_APP
      : stepTypeUsesCaptureApp(stepType)
        ? (appsForStep.length > 0 ? draft.capture_app || appsForStep[0] : null)
        : null;

    if (editingId) {
      onOperationsChange(
        rows.map((r) =>
          r.id === editingId
            ? {
                ...r,
                name: draft.name.trim(),
                step_type: stepType,
                capture_app: captureApp,
              }
            : r,
        ),
      );
    } else {
      const newRow: OperationRow = {
        id: `temp_op_${crypto.randomUUID()}`,
        factory_id: factoryId,
        department_id: departmentId,
        name: draft.name.trim(),
        step_type: stepType,
        capture_app: captureApp,
        is_active: true,
      };
      onOperationsChange([...rows, newRow]);
    }
    resetDraft();
  };

  const removeEditingOperation = () => {
    if (!editingId || panelReadOnly || isTerminal) return;
    onOperationsChange(rows.filter((r) => r.id !== editingId));
    resetDraft();
  };

  const outsourceHint = draft.step_type === 'outsource' || isOutsource
    ? 'Outsource operations use the Outsource capture app — vendor send/receive on the floor, plus handover to the next work center.'
    : null;

  return (
    <div className="space-y-3">
      {isTerminal ? (
        <TerminalShipmentAppsHeader shipmentApps={terminalShipmentApps} />
      ) : (
        <FloorAppsReferenceGrid
          variant={floorAppsVariant}
          showAudit={showAudit}
          showSupervisor={showSupervisor}
        />
      )}

      {isTerminal ? (
        <div className="rounded-xl border border-slate-200 bg-white overflow-hidden min-h-[12rem]">
          <CatalogTablePanel
            title="Operations catalog"
            subtitle="Fixed Dispatch operation — cannot add more"
            icon={ClipboardList}
            isEmpty={rows.length === 0}
            emptyMessage="Dispatch operation is created automatically for terminal work centers."
          >
            <CatalogTable headers={['S.No', 'Name', 'Step type', 'Capture app']}>
              {rows.map((row, idx) => (
                <CatalogTableRow key={row.id}>
                  <CatalogTableCell className={catalogSerialCellClass}>{idx + 1}</CatalogTableCell>
                  <CatalogTableCell className="font-medium text-slate-800 min-w-0 truncate">{row.name}</CatalogTableCell>
                  <CatalogTableCell className="capitalize min-w-0">
                    {OPERATION_STEP_TYPE_LABELS[row.step_type]}
                  </CatalogTableCell>
                  <CatalogTableCell className="min-w-0">
                    {row.capture_app ? labelForCaptureApp(row.capture_app, row.step_type) : '—'}
                  </CatalogTableCell>
                </CatalogTableRow>
              ))}
            </CatalogTable>
          </CatalogTablePanel>
        </div>
      ) : isStore ? (
        <div className="rounded-xl border border-slate-200 bg-white overflow-hidden min-h-[12rem]">
          <CatalogTablePanel
            title="Operations catalog"
            subtitle="Fixed Store reference operation — used in routing and transaction reports"
            icon={ClipboardList}
            isEmpty={rows.length === 0}
            emptyMessage="Store operation is created automatically when this work center is saved."
          >
            <CatalogTable headers={['S.No', 'Name', 'Step type', 'Planning']}>
              {rows.map((row, idx) => (
                <CatalogTableRow key={row.id}>
                  <CatalogTableCell className={catalogSerialCellClass}>{idx + 1}</CatalogTableCell>
                  <CatalogTableCell className="font-medium text-slate-800 min-w-0 truncate">{row.name}</CatalogTableCell>
                  <CatalogTableCell className="capitalize min-w-0">
                    {OPERATION_STEP_TYPE_LABELS[row.step_type]}
                  </CatalogTableCell>
                  <CatalogTableCell className="min-w-0 text-slate-500">
                    Transaction window
                  </CatalogTableCell>
                </CatalogTableRow>
              ))}
            </CatalogTable>
          </CatalogTablePanel>
        </div>
      ) : (
        <EditorSplitLayout
        scrollable={false}
        left={(
          <DesktopWriteGate>
          <div className="space-y-3">
            <div>
              <h5 className="text-xs font-bold text-slate-800 flex items-center gap-2">
                {editingId ? <Pencil size={14} /> : <Plus size={14} />}
                {editingId ? 'Edit operation' : 'Add operation'}
              </h5>
              <p className="text-[10px] text-slate-500 mt-1">
                {isOrigin
                  ? 'Origin cutting — produce with lay report capture only.'
                  : isOutsource
                    ? 'Outsource work center — operations are outsource steps only (transaction handoffs).'
                    : 'Production work center — loading and produce steps only. Outsource steps belong on outsource work centers.'}
              </p>
            </div>
            <Input
              label="Operation name"
              value={draft.name}
              onChange={(e) => setDraft((d) => ({ ...d, name: e.target.value }))}
              placeholder={isOrigin ? 'e.g. Marker lay' : isOutsource ? 'e.g. Embroidery out' : 'e.g. Fixed Cutting'}
              className="bg-white w-full"
              disabled={panelReadOnly}
            />
            <SelectDropdown
              label="Step type"
              value={draft.step_type}
              options={stepTypeOptions}
              placeholder="Select step type..."
              disabled={readOnly || locked.stepType}
              labelVariant="form"
              onChange={(step_type) => {
                if (!step_type || locked.stepType) return;
                const typed = step_type as OperationStepType;
                const apps = captureAppsForOperation(typed, departmentApps, allowedAppsConfig, departmentRole);
                setDraft((d) => ({
                  ...d,
                  step_type: typed,
                  capture_app: apps[0] ?? '',
                }));
              }}
              className="w-full"
            />
            <SelectDropdown
              label={usesCapture ? 'Capture app' : 'Planning'}
              value={usesCapture ? draft.capture_app : ''}
              options={captureAppOptions}
              disabled={readOnly || !draft.step_type || locked.captureApp || (usesCapture && appsForStep.length === 0)}
              labelVariant="form"
              onChange={(capture_app) => {
                if (locked.captureApp) return;
                setDraft((d) => ({ ...d, capture_app }));
              }}
              className="w-full"
            />
            {outsourceHint && (
              <p className="text-[10px] text-slate-500 px-1 leading-relaxed">{outsourceHint}</p>
            )}
            {!panelReadOnly && (
              <div className="flex flex-col gap-2 pt-1">
                <Button
                  size="sm"
                  type="button"
                  onClick={submitOperation}
                  disabled={!draft.name.trim() || !draft.step_type}
                  className="w-full"
                >
                  {editingId ? 'Update in list' : 'Add to list'}
                </Button>
                {editingId && (
                  <>
                    <Button
                      size="sm"
                      variant="danger-light"
                      type="button"
                      onClick={removeEditingOperation}
                      className="w-full"
                    >
                      <Trash2 size={14} className="mr-1.5" />
                      Delete operation
                    </Button>
                    <Button size="sm" variant="secondary" type="button" onClick={resetDraft} className="w-full">
                      <X size={14} className="mr-1.5" />
                      Cancel
                    </Button>
                  </>
                )}
              </div>
            )}
          </div>
          </DesktopWriteGate>
        )}
        right={(
          <div className="flex flex-col min-h-[280px] max-h-[min(360px,42vh)]">
            <CatalogTablePanel
              title="Operations catalog"
              icon={ClipboardList}
              isEmpty={rows.length === 0}
              emptyMessage="No operations yet. Add one on the left."
            >
              <CatalogTable headers={['S.No', 'Name', 'Step type', 'Capture / window']}>
                {rows.map((row, idx) => (
                  <CatalogTableRow
                    key={row.id}
                    onClick={panelReadOnly ? undefined : () => startEdit(row)}
                    selected={editingId === row.id}
                  >
                    <CatalogTableCell className={catalogSerialCellClass}>{idx + 1}</CatalogTableCell>
                    <CatalogTableCell className="font-medium text-slate-800 min-w-0 truncate">{row.name}</CatalogTableCell>
                    <CatalogTableCell className="capitalize min-w-0">
                      {OPERATION_STEP_TYPE_LABELS[row.step_type]}
                    </CatalogTableCell>
                    <CatalogTableCell className="min-w-0">
                      {row.capture_app
                        ? labelForCaptureApp(row.capture_app, row.step_type)
                        : row.step_type === 'store' || row.step_type === 'outsource'
                          ? 'Transaction window'
                          : '—'}
                    </CatalogTableCell>
                  </CatalogTableRow>
                ))}
              </CatalogTable>
            </CatalogTablePanel>
          </div>
        )}
      />
      )}
    </div>
  );
}

/** Read-only floor apps reference for store work centers (no operations tab). */
export function StoreFloorAppsReference() {
  return (
    <FloorAppsReferenceGrid variant="store" showAudit={false} showSupervisor={false} />
  );
}
