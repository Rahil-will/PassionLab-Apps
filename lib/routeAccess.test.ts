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
});
