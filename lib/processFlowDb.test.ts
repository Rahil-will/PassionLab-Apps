import { describe, expect, it } from 'vitest';
import { mapProcessFlowFromDbInline } from './processFlowDb';
import type { OperationRow } from './operationsDb';

describe('mapProcessFlowFromDbInline', () => {
  const operations: OperationRow[] = [
    {
      id: 'op-cut',
      factory_id: 'f1',
      department_id: 'dept-cut',
      name: 'Cut panels',
      step_type: 'produce',
      capture_app: 'cutting_output',
      is_active: true,
    },
    {
      id: 'op-sew',
      factory_id: 'f1',
      department_id: 'dept-sew',
      name: 'Sew body',
      step_type: 'produce',
      capture_app: 'sewing_output',
      is_active: true,
    },
  ];

  const departments = [
    { id: 'dept-cut', name: 'Cutting', role: 'origin' as const },
    { id: 'dept-sew', name: 'Sewing', role: 'standard' as const },
  ];

  it('hydrates inline steps jsonb with catalog operations and visit ids', () => {
    const flow = mapProcessFlowFromDbInline(
      {
        id: 'flow-1',
        factory_id: 'f1',
        name: 'Standard',
        description: null,
        steps: [
          { seq: 1, operation_def_id: 'op-cut', name: 'Cut panels', visit_number: 1 },
          { seq: 2, operation_def_id: 'op-sew', name: 'Sew body', visit_number: 2 },
        ],
      },
      operations,
      departments,
    );

    expect(flow.steps).toHaveLength(2);
    expect(flow.steps[0].dept_id).toBe('dept-cut');
    expect(flow.steps[0].step_label).toBe('Cut panels');
    expect(flow.steps[0].visit_id).toBe('visit_1');
    expect(flow.steps[1].visit_id).toBe('visit_2');
    expect(new Set(flow.steps.map((s) => s.visit_id)).size).toBe(2);
  });

  it('returns empty steps when inline jsonb is missing (legacy join shape)', () => {
    const flow = mapProcessFlowFromDbInline(
      {
        id: 'flow-2',
        factory_id: 'f1',
        name: 'Legacy row',
        process_flow_steps: [],
      },
      operations,
      departments,
    );
    expect(flow.steps).toEqual([]);
  });
});
