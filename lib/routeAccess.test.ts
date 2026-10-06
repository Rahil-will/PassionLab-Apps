import { describe, expect, it } from 'vitest';
import { RoutePath } from '../types';
import {
  canAccessRoute,
  isDesktopWriteRole,
} from './routeAccess';

describe('isDesktopWriteRole', () => {
  it('allows admin and superadmin', () => {
    expect(isDesktopWriteRole('admin')).toBe(true);
    expect(isDesktopWriteRole('superadmin')).toBe(true);
  });

  it('denies viewer and unknown roles', () => {
    expect(isDesktopWriteRole('viewer')).toBe(false);
    expect(isDesktopWriteRole('floor')).toBe(false);
    expect(isDesktopWriteRole(null)).toBe(false);
    expect(isDesktopWriteRole(undefined)).toBe(false);
  });
});

describe('canAccessRoute', () => {
  it('grants admin access to settings and order creation', () => {
    expect(canAccessRoute('admin', RoutePath.SETTINGS)).toBe(true);
    expect(canAccessRoute('superadmin', RoutePath.CREATE_ORDER)).toBe(true);
    expect(canAccessRoute('admin', RoutePath.USER_MANAGEMENT)).toBe(true);
    expect(canAccessRoute('admin', '#/create-order/step-2')).toBe(true);
    expect(canAccessRoute('admin', RoutePath.CREATE_ORDER_COLOR)).toBe(true);
  });

  it('grants viewer read routes but blocks admin-only pages', () => {
    expect(canAccessRoute('viewer', RoutePath.DASHBOARD)).toBe(true);
    expect(canAccessRoute('viewer', RoutePath.REPORTS_DAY)).toBe(true);
    expect(canAccessRoute('viewer', RoutePath.STATUS_TRACKER)).toBe(true);
    expect(canAccessRoute('viewer', '#/style-details/ord-1')).toBe(true);

    expect(canAccessRoute('viewer', RoutePath.SETTINGS)).toBe(false);
    expect(canAccessRoute('viewer', RoutePath.CREATE_ORDER)).toBe(false);
    expect(canAccessRoute('viewer', RoutePath.ADMIN)).toBe(false);
    expect(canAccessRoute('viewer', '#/create-order/step-2')).toBe(false);
  });

  it('denies unknown roles', () => {
    expect(canAccessRoute('floor', RoutePath.DASHBOARD)).toBe(false);
    expect(canAccessRoute(null, RoutePath.DASHBOARD)).toBe(false);
  });

  it('allows admin Material Management', () => {
    expect(canAccessRoute('admin', RoutePath.MATERIAL_MANAGEMENT)).toBe(true);
    expect(canAccessRoute('admin', RoutePath.WORK_CENTER_MATERIAL)).toBe(true);
  });

  it('allows admin mill and warehouse when Material is on', () => {
    const ctx = { modulesEnabled: { material: true } };
    expect(canAccessRoute('admin', RoutePath.MATERIAL_PROCESS, ctx)).toBe(true);
    expect(canAccessRoute('admin', RoutePath.MATERIAL_PROCESS_DETAIL, ctx)).toBe(true);
    expect(canAccessRoute('admin', RoutePath.MATERIAL_MILL, ctx)).toBe(true);
    expect(canAccessRoute('admin', RoutePath.MATERIAL_WAREHOUSE, ctx)).toBe(true);
    expect(canAccessRoute('admin', RoutePath.MATERIAL_WAREHOUSE_STORE, ctx)).toBe(true);
    expect(canAccessRoute('admin', RoutePath.MATERIAL_WAREHOUSE_DISPATCH, ctx)).toBe(true);
    expect(canAccessRoute('admin', RoutePath.MATERIAL_WAREHOUSE_DISPATCH_LINE, ctx)).toBe(true);
    expect(canAccessRoute('admin', RoutePath.MATERIAL_WAREHOUSE_DISPATCH_SEND, ctx)).toBe(true);
    expect(canAccessRoute('admin', RoutePath.MATERIAL_WAREHOUSE_STYLE, ctx)).toBe(true);
    expect(canAccessRoute('admin', RoutePath.MATERIAL_WAREHOUSE_STYLES, ctx)).toBe(true);
    expect(canAccessRoute('admin', RoutePath.MATERIAL_WAREHOUSE_TESTING, ctx)).toBe(true);
    expect(canAccessRoute('admin', RoutePath.MATERIAL_WAREHOUSE_TESTING_DETAIL, ctx)).toBe(true);
    expect(canAccessRoute('admin', RoutePath.MATERIAL_WAREHOUSE_RACKS, ctx)).toBe(true);
    expect(canAccessRoute('admin', RoutePath.MATERIAL_WAREHOUSE_RACKS_MOVE, ctx)).toBe(true);
    expect(canAccessRoute('admin', RoutePath.MATERIAL_WAREHOUSE_STOCK, ctx)).toBe(true);
    expect(canAccessRoute('admin', RoutePath.MATERIAL_WAREHOUSE_RETURNS, ctx)).toBe(true);
    expect(canAccessRoute('admin', RoutePath.MATERIAL_WAREHOUSE_RETURNS_DETAIL, ctx)).toBe(true);
    expect(canAccessRoute('admin', RoutePath.MATERIAL_WAREHOUSE_END_BITS, ctx)).toBe(true);
    expect(canAccessRoute('admin', RoutePath.MATERIAL_WAREHOUSE_MOVEMENTS, ctx)).toBe(true);
    expect(canAccessRoute('admin', RoutePath.MATERIAL_WAREHOUSE_EXPECTED, ctx)).toBe(true);
    expect(canAccessRoute('admin', RoutePath.MATERIAL_WAREHOUSE_RECEIVE_UNALLOCATED, ctx)).toBe(true);
    expect(canAccessRoute('admin', RoutePath.MATERIAL_MILL_UNALLOCATED, ctx)).toBe(true);
    expect(canAccessRoute('admin', RoutePath.MATERIAL_MILL_UNALLOCATED_ALLOCATE, ctx)).toBe(true);
    expect(canAccessRoute('admin', RoutePath.MATERIAL_MILL_UNALLOCATED_LINE, ctx)).toBe(true);
    expect(canAccessRoute('admin', RoutePath.MATERIAL_MILL_STOCK, ctx)).toBe(true);
    expect(canAccessRoute('admin', RoutePath.MATERIAL_MILL_STYLES, ctx)).toBe(true);
    expect(canAccessRoute('admin', RoutePath.MATERIAL_MILL_HISTORY, ctx)).toBe(true);
    expect(canAccessRoute('admin', RoutePath.MATERIAL_MILL, { modulesEnabled: { material: false } })).toBe(false);
  });

  it('blocks viewer from Material Management', () => {
    expect(canAccessRoute('viewer', RoutePath.MATERIAL_MANAGEMENT)).toBe(false);
    expect(canAccessRoute('viewer', RoutePath.WORK_CENTER_MATERIAL)).toBe(false);
    expect(canAccessRoute('viewer', RoutePath.MATERIAL_MILL, { modulesEnabled: { material: true } })).toBe(false);
    expect(canAccessRoute('viewer', RoutePath.MATERIAL_WAREHOUSE, { modulesEnabled: { material: true } })).toBe(false);
  });
});
