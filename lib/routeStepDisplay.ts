import type { OperationStepType } from './operationsDb';
import { OPERATION_STEP_TYPE_LABELS } from './operationsDb';
import { parseRoutingStepType } from './orderRoutingEditor';
import { labelForCaptureApp } from './floorApps';

export function routeStepTypeDisplay(
  stepType: string | undefined,
  isTerminalDept: boolean,
): string {
  if (isTerminalDept) return 'Produce';
  const t = (stepType || 'produce') as OperationStepType;
  return OPERATION_STEP_TYPE_LABELS[t] || stepType || 'Produce';
}

export function routeAppDisplay(
  captureApp: string | undefined,
  stepType: string | undefined,
  isTerminalDept: boolean,
): string {
  const typedStep = parseRoutingStepType(stepType);
  if (typedStep === 'outsource') return 'Outsource';
  if (isTerminalDept && captureApp) {
    return labelForCaptureApp(captureApp, typedStep);
  }
  if (isTerminalDept) return 'Shipment / QA';
  if (!captureApp || captureApp === 'transaction') return '—';
  return labelForCaptureApp(captureApp, typedStep);
}
