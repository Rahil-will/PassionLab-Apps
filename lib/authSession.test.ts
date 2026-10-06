import { describe, expect, it } from 'vitest';
import {
  desktopAccessError,
  parseMyProfile,
  profileToUserProfile,
  type RpcProfileRow,
} from './authSession';

const activeAdminProfile: RpcProfileRow = {
  id: 'user-1',
  factory_id: 'factory-1',
  full_name: 'Jane Admin',
  email: 'jane@factory.com',
  user_role: 'admin',
  status: 'Active',
};

describe('parseMyProfile', () => {
  it('returns null for invalid payloads', () => {
    expect(parseMyProfile(null)).toBeNull();
    expect(parseMyProfile(undefined)).toBeNull();
    expect(parseMyProfile('bad')).toBeNull();
    expect(parseMyProfile({})).toBeNull();
  });

  it('returns profile when id is present', () => {
    expect(parseMyProfile(activeAdminProfile)).toEqual(activeAdminProfile);
  });
});

describe('profileToUserProfile', () => {
  it('maps rpc profile fields', () => {
    expect(profileToUserProfile(activeAdminProfile, 'fallback@example.com')).toEqual({
      id: 'user-1',
      fullName: 'Jane Admin',
      email: 'jane@factory.com',
      userRole: 'admin',
      assignedApps: [],
    });
  });

  it('maps assigned_apps when present', () => {
    expect(
      profileToUserProfile(
        { ...activeAdminProfile, assigned_apps: ['mm_reports', 'mm_qc'] },
        'fallback@example.com',
      ).assignedApps,
    ).toEqual(['mm_reports', 'mm_qc']);
  });

  it('falls back to email when name or email are missing', () => {
    const profile: RpcProfileRow = {
      ...activeAdminProfile,
      full_name: null,
      email: null,
      user_role: '',
    };
    expect(profileToUserProfile(profile, 'ops@factory.com')).toEqual({
      id: 'user-1',
      fullName: 'ops',
      email: 'ops@factory.com',
      userRole: 'viewer',
      assignedApps: [],
    });
  });
});

describe('desktopAccessError', () => {
  it('returns null for a valid desktop profile', () => {
    expect(desktopAccessError(activeAdminProfile)).toBeNull();
    expect(
      desktopAccessError({ ...activeAdminProfile, user_role: 'viewer' }),
    ).toBeNull();
  });

  it('blocks profiles without a factory', () => {
    expect(
      desktopAccessError({ ...activeAdminProfile, factory_id: null }),
    ).toMatch(/No factory assigned/);
  });

  it('blocks inactive accounts', () => {
    expect(
      desktopAccessError({ ...activeAdminProfile, status: 'Inactive' }),
    ).toMatch(/inactive/i);
  });

  it('blocks floor-only roles', () => {
    expect(
      desktopAccessError({ ...activeAdminProfile, user_role: 'floor' }),
    ).toMatch(/floor mobile app/i);
  });
});
