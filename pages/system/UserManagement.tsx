import React, { useState, useMemo } from 'react';
import { useNavigationStore, useNotificationStore } from '../../stores';
import { useDepartmentsCatalog, useFactoryProfileCatalog, useCatalogOperations } from '../../lib/queries/settingsSlices';
import { Users, Plus, Search, Trash2, X, Mail, User, Shield, CheckCircle, XCircle, Lock, Check, AlertTriangle, Loader2, Filter, Building2, Download, Eye, EyeOff } from 'lucide-react';
import { Button, Modal, SelectDropdown } from '../../components/ui';
import { Pagination } from '../../components/Pagination';
import { PageShell } from '../../components/layout/PageShell';
import { usePagination } from '../../hooks/usePagination';
import { supabase } from '../../lib/supabase';
import { createFactoryUser } from '../../lib/createFactoryUser';
import { updateFactoryUser, type UpdateFactoryUserInput } from '../../lib/updateFactoryUser';
import { deleteFactoryUser } from '../../lib/deleteFactoryUser';
import { labelForCaptureApp, labelForDeptApp, type DeptAppId } from '../../lib/floorApps';
import {
    clampAssignedOperationIds,
    clampFloorDeptFlags,
    clampSupervisorFloorFlags,
    clampTerminalShipmentApps,
    defaultAssignedOperationIds,
    defaultTerminalAssignedOperationIds,
    deriveAssignedAppsForUser,
    dispatchOperationForDepartment,
    floorDeptFlagsFromAssignedApps,
    formatAssignedAppsLabel,
    formatAssignedOperationsLabel,
    isTerminalDepartment,
    isFloorLoginRole,
    labelForFloorDeptFlag,
    normalizeAssignedAppsForDb,
    operatorOptionalFloorExtrasForDepartment,
    operatorExtraFlagsFromAssignedApps,
    operationsSelectableForDepartment,
    parseAssignedApps,
    parseAssignedOperationIds,
    SHIPMENT_QA_LABEL,
    formatUserRoleLabel,
    supervisorFloorExtrasForDepartment,
    type FloorDeptFlag,
    userIsSupervisorOnly,
    isSupervisorFloorUser,
    validateFloorUserPayload,
} from '../../lib/floorUserUtils';
import {
    departmentSupervisorEligible,
    isNativeCuttingDepartment,
    isPassiveSupervisorOnlyDepartment,
} from '../../lib/departmentFilters';
import {
    fetchFloorUserOperationIdsByProfile,
    fetchFloorUserArchivedOperations,
    floorFlagsToProfileColumns,
    profileFloorFlagsFromRow,
    profileShipmentQaFromRow,
    userFloorFlagsFromProfile,
    type FloorUserArchivedOp,
} from '../../lib/floorUserAccessDb';

interface UserProfile {
    id: string;
    fullName: string;
    email: string;
    userRole: 'superadmin' | 'admin' | 'quality_manager' | 'supervisor' | 'auditor' | 'operator' | 'viewer';
    factoryId: string;
    status: 'Active' | 'Inactive';
    departmentId: string | null;
    floorPin: string;
    assignedApps: DeptAppId[];
    assignedOperationIds: string[];
    handoverEnabled: boolean;
    workforceEnabled: boolean;
    auditEnabled: boolean;
    shipmentQaEnabled: boolean;
    createdAt: string;
    updatedAt: string | null;
}

/** Floor flags on `profiles`; produce ops in `floor_user_access`. */
const PROFILE_COLUMNS =
    'id, full_name, email, user_role, factory_id, status, created_at, updated_at, department_id, can_produce, handover_enabled, workforce_enabled, audit_enabled, shipment_qa_enabled, preferred_resource_ids' as const;

export const UserManagement: React.FC = () => {
    const { showNotification } = useNotificationStore();
    const { userProfile: currentUser, factoryId } = useNavigationStore();
    const { departments } = useDepartmentsCatalog(factoryId, 'full');
    const { factoryEntitlements } = useFactoryProfileCatalog(factoryId);
    const { catalogOperations } = useCatalogOperations(factoryId);
    const [users, setUsers] = useState<UserProfile[]>([]);
    const [loading, setLoading] = useState(true);
    const [saving, setSaving] = useState(false);
    const [showPanel, setShowPanel] = useState(false);
    const [panelDirty, setPanelDirty] = useState(false);
    const [showDiscardDialog, setShowDiscardDialog] = useState(false);
    const [showDeleteDialog, setShowDeleteDialog] = useState(false);
    const [deleteTarget, setDeleteTarget] = useState<{ id: string; userRole: string; label: string } | null>(null);
    const [editingUser, setEditingUser] = useState<UserProfile | null>(null);
    const [searchQuery, setSearchQuery] = useState('');
    const [filterRole, setFilterRole] = useState<string>('All');
    const [filterDepartment, setFilterDepartment] = useState<string>('All');
    const [filterStatus, setFilterStatus] = useState<string>('All');
    // Form state
    const [formData, setFormData] = useState({
        fullName: '',
        email: '',
        userRole: 'operator' as UserProfile['userRole'],
        departmentId: '',
        floorPin: '',
        password: '',
        assignedOperationIds: [] as string[],
        floorDeptFlags: [] as FloorDeptFlag[],
        assignedApps: [] as DeptAppId[],
        workforceOnly: false,
        supervisorOnly: false,
        status: 'Active' as UserProfile['status']
    });
    const [archivedOps, setArchivedOps] = useState<FloorUserArchivedOp[]>([]);
    const [showViewerPassword, setShowViewerPassword] = useState(false);

    const archivedCaptureLabel = (op: FloorUserArchivedOp): string | null => {
        const cap = op.captureApp;
        if (!cap || cap === 'transaction' || cap === 'none') return null;
        return labelForCaptureApp(cap, op.stepType);
    };

    React.useEffect(() => {
        if (!editingUser?.id || !factoryId) {
            setArchivedOps([]);
            return;
        }
        let cancelled = false;
        void fetchFloorUserArchivedOperations(factoryId, editingUser.id)
            .then((rows) => {
                if (!cancelled) setArchivedOps(rows);
            })
            .catch(() => {
                if (!cancelled) setArchivedOps([]);
            });
        return () => {
            cancelled = true;
        };
    }, [editingUser?.id, factoryId]);

    // Check if editing an admin
    const isEditingAdmin = editingUser?.userRole === 'admin';

    const selectedDept = departments.find((d) => d.id === formData.departmentId);
    const isTerminalDept = isTerminalDepartment(selectedDept);

    const resolveProfilePayloadForSave = (): { assignedApps: DeptAppId[]; assignedOperationIds: string[] } => {
        const isSupervisor = formData.supervisorOnly || formData.workforceOnly;
        const opIds = clampAssignedOperationIds(
            isTerminalDept
                ? (formData.assignedOperationIds.length > 0
                    ? formData.assignedOperationIds
                    : defaultTerminalAssignedOperationIds(catalogOperations, formData.departmentId))
                : formData.assignedOperationIds,
            catalogOperations,
            formData.departmentId,
        );
        const flags = (formData.supervisorOnly || formData.workforceOnly)
            ? clampSupervisorFloorFlags(formData.floorDeptFlags, selectedDept)
            : clampFloorDeptFlags(
                formData.floorDeptFlags,
                selectedDept?.apps,
                factoryEntitlements,
                selectedDept,
            );
        const assignedApps = deriveAssignedAppsForUser({
            operationIds: opIds,
            operations: catalogOperations,
            floorFlags: flags,
            deptApps: selectedDept?.apps,
            entitlements: factoryEntitlements,
            workforceOnly: formData.supervisorOnly || formData.workforceOnly,
            supervisorOnly: formData.supervisorOnly || formData.workforceOnly,
            deptRole: selectedDept?.role,
            dept: selectedDept,
        });
        return {
            assignedApps: normalizeAssignedAppsForDb(assignedApps, {
                deptRole: selectedDept?.role,
                entitlements: factoryEntitlements,
            }),
            assignedOperationIds: opIds,
        };
    };

    React.useEffect(() => {
        void fetchUsers();
    }, [factoryId]);

    const fetchUsers = async () => {
        if (!factoryId) {
            setUsers([]);
            setLoading(false);
            return;
        }
        setLoading(true);
        try {
            const [profilesRes, opsByProfile] = await Promise.all([
                supabase
                    .from('profiles')
                    .select(PROFILE_COLUMNS)
                    .eq('factory_id', factoryId)
                    .order('created_at', { ascending: false }),
                fetchFloorUserOperationIdsByProfile(factoryId),
            ]);

            const { data, error } = profilesRes;
            
            if (error) {
                throw error;
            }

            const mappedUsers: UserProfile[] = (data || []).map(u => {
                const opIds = opsByProfile.get(u.id) ?? [];
                const departmentId = (u.department_id as string) || null;
                const flags = profileFloorFlagsFromRow(u as Record<string, unknown>);
                const shipmentQaEnabled = profileShipmentQaFromRow(u as Record<string, unknown>);
                const dept = departments.find((d) => d.id === departmentId);
                const assignedApps = departmentId
                    ? normalizeAssignedAppsForDb(
                        deriveAssignedAppsForUser({
                            operationIds: opIds,
                            operations: catalogOperations,
                            floorFlags: userFloorFlagsFromProfile(flags),
                            deptApps: dept?.apps,
                            entitlements: factoryEntitlements,
                            terminalShipmentApps: shipmentQaEnabled ? factoryEntitlements.shipment : [],
                            deptRole: dept?.role,
                            dept,
                        }),
                        { deptRole: dept?.role, entitlements: factoryEntitlements },
                    )
                    : [];
                return {
                id: u.id,
                fullName: u.full_name || '',
                email: u.email || '',
                userRole: u.user_role || 'operator',
                factoryId: u.factory_id || '',
                status: u.status || 'Active',
                departmentId,
                floorPin: '',
                assignedApps,
                assignedOperationIds: opIds,
                handoverEnabled: flags.handoverEnabled,
                workforceEnabled: flags.workforceEnabled,
                auditEnabled: flags.auditEnabled,
                shipmentQaEnabled,
                createdAt: u.created_at,
                updatedAt: u.updated_at,
                };
            });
            
            setUsers(mappedUsers);
        } catch (error) {
            showNotification('Failed to fetch users', 'error');
        } finally {
            setLoading(false);
        }
    };

    const patchFormData = (patch: Partial<typeof formData>) => {
        setPanelDirty(true);
        setFormData((prev) => ({ ...prev, ...patch }));
    };

    const forceClosePanel = () => {
        setShowPanel(false);
        setPanelDirty(false);
        setEditingUser(null);
        setArchivedOps([]);
        resetForm();
    };

    const requestClosePanel = () => {
        if (panelDirty) {
            setShowDiscardDialog(true);
            return;
        }
        forceClosePanel();
    };

    const cancelDiscardDialog = () => {
        setShowDiscardDialog(false);
    };

    const confirmDiscardPanel = () => {
        setShowDiscardDialog(false);
        forceClosePanel();
    };

    const confirmSaveAndClosePanel = async () => {
        const saved = editingUser ? await handleUpdateUser() : await handleCreateUser();
        if (saved) {
            setShowDiscardDialog(false);
        }
    };

    const handleCreateUser = async (): Promise<boolean> => {
        const dept = selectedDept;
        const isViewer = formData.userRole === 'viewer';
        if (!isViewer) {
            const validationError = validateFloorUserPayload({
            fullName: formData.fullName,
            email: formData.email,
            floorPin: formData.floorPin,
            departmentId: formData.departmentId,
            assignedOperationIds: formData.assignedOperationIds,
            floorDeptFlags: formData.floorDeptFlags,
            assignedApps: formData.assignedApps,
            deptApps: dept?.apps,
            dept,
            deptRole: dept?.role,
            entitlements: factoryEntitlements,
            operations: catalogOperations,
            workforceOnly: formData.supervisorOnly || formData.workforceOnly,
            supervisorOnly: formData.supervisorOnly || formData.workforceOnly,
            });
            if (validationError) {
                showNotification(validationError, 'error');
                return false;
            }
        } else if (!formData.fullName.trim()) {
            showNotification('Full name is required', 'error');
            return false;
        } else if (!formData.email.trim().includes('@')) {
            showNotification('Valid email is required', 'error');
            return false;
        } else if (formData.password.trim().length < 6) {
            showNotification('Password must be at least 6 characters', 'error');
            return false;
        }

        setSaving(true);
        try {
            if (!factoryId) throw new Error('No factory selected');

            const normalizedEmail = formData.email.trim().toLowerCase();
            const { assignedApps, assignedOperationIds } = isViewer
                ? { assignedApps: [] as DeptAppId[], assignedOperationIds: [] as string[] }
                : resolveProfilePayloadForSave();
            const floorFlags = isViewer
                ? { handoverEnabled: false, workforceEnabled: false, auditEnabled: false }
                : floorFlagsToProfileColumns(
                (formData.supervisorOnly || formData.workforceOnly)
                    ? clampSupervisorFloorFlags(formData.floorDeptFlags, selectedDept)
                    : clampFloorDeptFlags(formData.floorDeptFlags, selectedDept?.apps, factoryEntitlements, selectedDept),
            );
            const created = await createFactoryUser({
                    factoryId,
                    fullName: formData.fullName,
                    email: normalizedEmail,
                    floorPin: isViewer ? '' : formData.floorPin,
                    departmentId: isViewer ? null : formData.departmentId,
                    assignedApps: isViewer ? [] : assignedApps,
                    assignedOperationIds: isViewer ? [] : assignedOperationIds,
                    handoverEnabled: isViewer ? false : floorFlags.handoverEnabled,
                    workforceEnabled: isViewer ? false : floorFlags.workforceEnabled,
                    auditEnabled: isViewer ? false : floorFlags.auditEnabled,
                    shipmentQaEnabled: isViewer ? false : isTerminalDept,
                    userRole: floorUserRoleForSave,
                    status: formData.status,
                    password: isViewer ? formData.password.trim() : undefined,
            });

            const optimisticUser: UserProfile = {
                id: created.id,
                fullName: formData.fullName.trim(),
                email: normalizedEmail,
                userRole: floorUserRoleForSave,
                factoryId,
                status: formData.status,
                departmentId: isViewer ? null : (formData.departmentId || null),
                floorPin: isViewer ? '' : formData.floorPin,
                assignedApps: isViewer ? [] : assignedApps,
                assignedOperationIds: isViewer ? [] : assignedOperationIds,
                handoverEnabled: isViewer ? false : floorFlags.handoverEnabled,
                workforceEnabled: isViewer ? false : floorFlags.workforceEnabled,
                auditEnabled: isViewer ? false : floorFlags.auditEnabled,
                shipmentQaEnabled: isViewer ? false : isTerminalDept,
                createdAt: new Date().toISOString(),
                updatedAt: null,
            };
            setUsers((prev) => [optimisticUser, ...prev]);

            showNotification('User created successfully', 'success');
            forceClosePanel();
            return true;
        } catch (error: unknown) {
            const msg = error instanceof Error ? error.message : 'Failed to create user';
            const hint =
              msg.includes('Function not found') ||
              msg.includes('Failed to send a request to the Edge Function')
                ? ' Deploy Supabase Edge Functions: supabase functions deploy admin-create-user admin-delete-user'
                : '';
            showNotification(msg + hint, 'error');
            return false;
        } finally {
            setSaving(false);
        }
    };

    const requestDeleteUser = (userId: string, userRole: string, label: string) => {
        if (userId === currentUser?.id) {
            showNotification('You cannot delete your own account', 'error');
            return;
        }
        if (userRole === 'admin') {
            showNotification('Cannot delete admin users', 'error');
            return;
        }
        setDeleteTarget({ id: userId, userRole, label });
        setShowDeleteDialog(true);
    };

    const cancelDeleteUser = () => {
        setShowDeleteDialog(false);
        setDeleteTarget(null);
    };

    const confirmDeleteUser = async () => {
        if (!deleteTarget) return;
        const { id: userId } = deleteTarget;

        setSaving(true);
        try {
            if (!factoryId) throw new Error('No factory selected');

            const { authDeleted } = await deleteFactoryUser(userId, factoryId);

            showNotification(
                authDeleted
                    ? 'User deleted successfully'
                    : 'Profile removed. Auth account may still exist — configure admin API for full delete.',
                authDeleted ? 'success' : 'error',
            );
            setShowDeleteDialog(false);
            setDeleteTarget(null);
            forceClosePanel();
            void fetchUsers();
        } catch (error: unknown) {
            const message = error instanceof Error ? error.message : 'Failed to delete user';
            showNotification(message, 'error');
        } finally {
            setSaving(false);
        }
    };

    const handleDeleteUser = (userId: string, userRole: string, label: string) => {
        requestDeleteUser(userId, userRole, label);
    };


    const handleToggleStatus = async (userId: string, currentStatus: string) => {
        if (userId === currentUser?.id) {
            showNotification('You cannot deactivate your own account', 'error');
            return;
        }
        const newStatus = currentStatus === 'Active' ? 'Inactive' : 'Active';
        try {
            if (!factoryId) throw new Error('No factory selected');
            await updateFactoryUser({ factoryId, userId, status: newStatus as 'Active' | 'Inactive' });

            // Update local state
            setUsers(prev => prev.map(u => u.id === userId ? { ...u, status: newStatus as 'Active' | 'Inactive' } : u));
            showNotification(`User ${newStatus === 'Active' ? 'activated' : 'deactivated'}`, 'success');
        } catch (error: any) {
            showNotification(error.message || 'Failed to update status', 'error');
        }
    };

    const openEditPanel = (user: UserProfile) => {
        setEditingUser(user);
        const dept = departments.find((d) => d.id === user.departmentId);
        const isTerminal = isTerminalDepartment(dept);
        const passiveDept = isPassiveSupervisorOnlyDepartment(dept);
        const supervisorOnly = user.userRole === 'supervisor' || passiveDept;
        const assignedApps = isTerminal
            ? clampTerminalShipmentApps(user.assignedApps, factoryEntitlements)
            : user.assignedApps;
        const assignedOperationIds = isTerminal
            ? (user.assignedOperationIds.length > 0
                ? user.assignedOperationIds
                : defaultTerminalAssignedOperationIds(catalogOperations, user.departmentId || ''))
            : clampAssignedOperationIds(
                user.assignedOperationIds.length > 0
                    ? user.assignedOperationIds
                    : supervisorOnly
                        ? []
                        : defaultAssignedOperationIds(catalogOperations, user.departmentId || ''),
                catalogOperations,
                user.departmentId || '',
                { activeOnly: true },
            );
        const resolvedOperationIds = assignedOperationIds.length > 0
            ? assignedOperationIds
            : defaultAssignedOperationIds(catalogOperations, user.departmentId || '');
        const canonicalFlags = userFloorFlagsFromProfile({
            handoverEnabled: user.handoverEnabled,
            workforceEnabled: user.workforceEnabled,
            auditEnabled: user.auditEnabled,
        });
        const floorDeptFlags = !isTerminal
            ? supervisorOnly
                ? clampSupervisorFloorFlags(
                    canonicalFlags.length > 0 ? canonicalFlags : floorDeptFlagsFromAssignedApps(user.assignedApps),
                    dept,
                )
                : clampFloorDeptFlags(
                    canonicalFlags.length > 0 ? canonicalFlags : floorDeptFlagsFromAssignedApps(user.assignedApps),
                    dept?.apps,
                    factoryEntitlements,
                    dept,
                )
            : [];
        setFormData({
            fullName: user.fullName,
            email: user.email,
            userRole: user.userRole,
            departmentId: user.departmentId || '',
            floorPin: user.floorPin,
            password: '',
            assignedOperationIds: isTerminal ? assignedOperationIds : resolvedOperationIds,
            floorDeptFlags,
            assignedApps,
            workforceOnly: supervisorOnly,
            supervisorOnly,
            status: user.status
        });
        setPanelDirty(false);
        setShowPanel(true);
    };

    const openAddPanel = () => {
        setEditingUser(null);
        resetForm();
        setSearchQuery('');
        setPanelDirty(false);
        setShowPanel(true);
    };

    const handleUpdateUser = async (): Promise<boolean> => {
        if (!editingUser) return false;

        if (editingUser.id === currentUser?.id && formData.status === 'Inactive') {
            showNotification('You cannot deactivate your own account', 'error');
            return false;
        }

        if (editingUser.userRole !== 'admin' && formData.userRole !== 'viewer' && isFloorLoginRole(formData.userRole)) {
            const validationError = validateFloorUserPayload({
                fullName: formData.fullName,
                email: formData.email,
                floorPin: formData.floorPin,
                requirePin: false,
                departmentId: formData.departmentId,
                assignedOperationIds: formData.assignedOperationIds,
                floorDeptFlags: formData.floorDeptFlags,
                assignedApps: formData.assignedApps,
                deptApps: selectedDept?.apps,
                dept: selectedDept,
                deptRole: selectedDept?.role,
                entitlements: factoryEntitlements,
                operations: catalogOperations,
                workforceOnly: formData.supervisorOnly || formData.workforceOnly,
                supervisorOnly: formData.supervisorOnly || formData.workforceOnly,
            });
            if (validationError) {
                showNotification(validationError, 'error');
                return false;
            }
        } else if (formData.userRole === 'viewer') {
            if (!formData.fullName.trim()) {
                showNotification('Full name is required', 'error');
                return false;
            }
            if (formData.password.trim().length < 6) {
                showNotification('Password must be at least 6 characters', 'error');
                return false;
            }
        }

        setSaving(true);
        try {
            if (!factoryId) throw new Error('No factory selected');

            const isAdmin = editingUser.userRole === 'admin';
            const { assignedApps, assignedOperationIds } = resolveProfilePayloadForSave();
            const normalizedEmail = formData.email.trim().toLowerCase();

            const updateBody: UpdateFactoryUserInput = {
                factoryId,
                userId: editingUser.id,
                fullName: formData.fullName,
                status: formData.status as 'Active' | 'Inactive',
            };

            if (normalizedEmail !== editingUser.email) {
                updateBody.email = normalizedEmail;
            }

            if (!isAdmin) {
                updateBody.userRole = floorUserRoleForSave;
                if (formData.userRole === 'viewer') {
                    updateBody.departmentId = null;
                    updateBody.assignedApps = [];
                    updateBody.assignedOperationIds = [];
                    updateBody.password = formData.password.trim();
                } else {
                    updateBody.departmentId = formData.departmentId || null;
                    updateBody.assignedApps = assignedApps;
                    updateBody.assignedOperationIds = assignedOperationIds;
                    if (formData.floorPin?.trim()) {
                        updateBody.floorPin = formData.floorPin.trim();
                    }
                }
            }

            await updateFactoryUser(updateBody);

            const savedFlags = isTerminalDept
                ? { handoverEnabled: false, workforceEnabled: false, auditEnabled: false }
                : floorFlagsToProfileColumns(
                    isSupervisorAssignment
                        ? clampSupervisorFloorFlags(formData.floorDeptFlags, selectedDept)
                        : clampFloorDeptFlags(
                            formData.floorDeptFlags,
                            selectedDept?.apps,
                            factoryEntitlements,
                            selectedDept,
                        ),
                );

            showNotification('User updated successfully', 'success');
            setUsers((prev) =>
                prev.map((u) =>
                    u.id === editingUser.id
                        ? {
                            ...u,
                            fullName: formData.fullName,
                            status: formData.status,
                            email: (updateBody.email as string) ?? u.email,
                            userRole: (updateBody.userRole as UserProfile['userRole']) ?? u.userRole,
                            floorPin: (updateBody.floorPin as string) ?? u.floorPin,
                            ...(!isAdmin
                                ? {
                                    departmentId: formData.departmentId || null,
                                    assignedApps,
                                    assignedOperationIds,
                                    handoverEnabled: savedFlags.handoverEnabled,
                                    workforceEnabled: savedFlags.workforceEnabled,
                                    auditEnabled: savedFlags.auditEnabled,
                                    shipmentQaEnabled: isTerminalDept,
                                }
                                : {}),
                            updatedAt: new Date().toISOString(),
                        }
                        : u,
                ),
            );
            forceClosePanel();
            return true;
        } catch (error: unknown) {
            const message = error instanceof Error ? error.message : 'Failed to update user';
            showNotification(message, 'error');
            return false;
        } finally {
            setSaving(false);
        }
    };

    const resetForm = () => {
        setShowViewerPassword(false);
        setFormData({
            fullName: '',
            email: '',
            userRole: 'operator',
            departmentId: '',
            floorPin: '',
            password: '',
            assignedOperationIds: [],
            floorDeptFlags: [],
            assignedApps: [],
            workforceOnly: false,
            supervisorOnly: false,
            status: 'Active'
        });
    };

    const selectableOperations = useMemo(() => {
        if (!formData.departmentId) return [];
        return operationsSelectableForDepartment(catalogOperations, formData.departmentId, {
            activeOnly: true,
        });
    }, [catalogOperations, formData.departmentId]);

    const availableDeptFlags = useMemo(
        () => operatorOptionalFloorExtrasForDepartment(selectedDept?.apps, factoryEntitlements, selectedDept),
        [selectedDept, factoryEntitlements],
    );

    const factoryShipmentApps = factoryEntitlements.shipment;

    const terminalDispatchOp = useMemo(() => {
        if (!formData.departmentId || !isTerminalDept) return undefined;
        return dispatchOperationForDepartment(catalogOperations, formData.departmentId);
    }, [catalogOperations, formData.departmentId, isTerminalDept]);

    const canAssignSupervisor = Boolean(formData.departmentId)
        && !isTerminalDept
        && departmentSupervisorEligible(selectedDept);

    const isOriginCuttingDept = isNativeCuttingDepartment(selectedDept);
    const isPassiveSupervisorOnlyDept = isPassiveSupervisorOnlyDepartment(selectedDept);

    const isSupervisorAssignment = formData.supervisorOnly || formData.workforceOnly;
    const isViewerAccount = formData.userRole === 'viewer';

    const roleOptions = useMemo(() => [
        { value: 'operator', label: 'Operator — production capture' },
        {
            value: 'supervisor',
            label: isOriginCuttingDept
                ? 'Supervisor — handover only'
                : 'Supervisor — handover & workforce',
        },
        { value: 'viewer', label: 'Viewer — desktop read-only' },
    ], [isOriginCuttingDept]);

    const selectedRoleValue =
        formData.userRole === 'viewer'
            ? 'viewer'
            : isSupervisorAssignment
                ? 'supervisor'
                : 'operator';

    const floorUserRoleForSave: UserProfile['userRole'] = isViewerAccount
        ? 'viewer'
        : isTerminalDept
            ? 'quality_manager'
            : isSupervisorAssignment
                ? 'supervisor'
                : 'operator';

    const supervisorLockedFlags = useMemo(
        () => supervisorFloorExtrasForDepartment(selectedDept),
        [selectedDept],
    );

    const toggleAssignedOperation = (operationId: string) => {
        setPanelDirty(true);
        setFormData((prev) => {
            const next = prev.assignedOperationIds.includes(operationId)
                ? prev.assignedOperationIds.filter((id) => id !== operationId)
                : [...prev.assignedOperationIds, operationId];
            return {
                ...prev,
                assignedOperationIds: next,
            };
        });
    };

    const toggleFloorDeptFlag = (flag: FloorDeptFlag) => {
        setPanelDirty(true);
        setFormData((prev) => {
            const next = prev.floorDeptFlags.includes(flag)
                ? prev.floorDeptFlags.filter((f) => f !== flag)
                : [...prev.floorDeptFlags, flag];
            return { ...prev, floorDeptFlags: next };
        });
    };

    // Get unique roles from users data
    const uniqueRoles = useMemo(() => {
        const roles = Array.from(new Set(users.map(u => u.userRole).filter(Boolean)));
        return roles.sort();
    }, [users]);

    const filteredUsers = useMemo(() => {
        return users.filter(u => {
            const matchesSearch = u.fullName.toLowerCase().includes(searchQuery.toLowerCase()) ||
                                  u.email.toLowerCase().includes(searchQuery.toLowerCase());
            const matchesRole = filterRole === 'All' || u.userRole === filterRole;
            const matchesStatus = filterStatus === 'All' || u.status === filterStatus;
            const matchesDepartment = filterDepartment === 'All'
                || (filterDepartment === '__unassigned__' && !u.departmentId && u.userRole !== 'admin')
                || (filterDepartment === '__admins__' && u.userRole === 'admin')
                || u.departmentId === filterDepartment;
            return matchesSearch && matchesRole && matchesStatus && matchesDepartment;
        });
    }, [users, searchQuery, filterRole, filterStatus, filterDepartment]);

    const sortedUsers = useMemo(() => {
        const deptOrder = new Map(
            [...departments]
                .sort((a, b) => (a.sequence ?? 999) - (b.sequence ?? 999) || a.name.localeCompare(b.name))
                .map((d, i) => [d.id, i]),
        );
        return [...filteredUsers].sort((a, b) => {
            if (a.userRole === 'admin' && b.userRole !== 'admin') return -1;
            if (b.userRole === 'admin' && a.userRole !== 'admin') return 1;
            const aDept = a.departmentId ? (deptOrder.get(a.departmentId) ?? 9999) : 10000;
            const bDept = b.departmentId ? (deptOrder.get(b.departmentId) ?? 9999) : 10000;
            if (aDept !== bDept) return aDept - bDept;
            const aDeptName = departments.find((d) => d.id === a.departmentId)?.name ?? '';
            const bDeptName = departments.find((d) => d.id === b.departmentId)?.name ?? '';
            if (aDeptName !== bDeptName) return aDeptName.localeCompare(bDeptName);
            return a.fullName.localeCompare(b.fullName);
        });
    }, [filteredUsers, departments]);

    const { paginatedItems: pageUsers, ...pagination } = usePagination(sortedUsers, 20);

    const handleExportCsv = () => {
        const header = ['Name', 'Email', 'Role', 'Department', 'Operations', 'Status'];
        const rows = sortedUsers.map((user) => {
            const dept = departments.find((d) => d.id === user.departmentId);
            const ops =
                user.userRole === 'admin'
                    ? '-'
                    : isSupervisorFloorUser(user.userRole, user.assignedOperationIds, user.assignedApps)
                    ? [
                          formatAssignedOperationsLabel(
                              user.assignedOperationIds,
                              catalogOperations,
                              supervisorFloorExtrasForDepartment(dept),
                              { supervisorOnly: true },
                          ),
                          supervisorFloorExtrasForDepartment(dept).map(labelForFloorDeptFlag).join(', '),
                      ].filter(Boolean).join(' · ')
                    : user.assignedOperationIds.length
                    ? formatAssignedOperationsLabel(
                          user.assignedOperationIds,
                          catalogOperations,
                          operatorExtraFlagsFromAssignedApps(user.assignedApps),
                      )
                    : user.assignedApps.length
                    ? formatAssignedAppsLabel(user.assignedApps)
                    : '-';
            return [
                user.fullName,
                user.email,
                formatUserRoleLabel(user.userRole),
                user.userRole === 'admin' ? '-' : (dept?.name || '-'),
                ops,
                user.status,
            ];
        });
        const csv = [header, ...rows]
            .map((r) => r.map((c) => `"${String(c ?? '').replace(/"/g, '""')}"`).join(','))
            .join('\n');
        const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
        const url = URL.createObjectURL(blob);
        const link = document.createElement('a');
        link.href = url;
        link.download = `users-${factoryId || 'export'}.csv`;
        document.body.appendChild(link);
        link.click();
        document.body.removeChild(link);
        URL.revokeObjectURL(url);
    };


    const departmentFilterOptions = useMemo(() => {
        const sorted = [...departments].sort(
            (a, b) => (a.sequence ?? 999) - (b.sequence ?? 999) || a.name.localeCompare(b.name),
        );
        return [
            { value: 'All', label: 'All work centers' },
            { value: '__admins__', label: 'Factory admins' },
            ...sorted.map((d) => ({ value: d.id, label: d.name })),
            { value: '__unassigned__', label: 'Unassigned' },
        ];
    }, [departments]);

    return (
        <PageShell loading={loading} skeleton="table" className="w-full pb-20">

            {/* Table with integrated filters */}
            <div className="bg-white rounded-xl border border-slate-200 shadow-sm overflow-hidden">
                {/* Filters Bar */}
                <div className="px-4 py-2 border-b border-slate-100 flex items-center justify-between">
                    {/* Search - Left Side */}
                    <div className="flex items-center gap-1">
                        <Search size={14} className="text-slate-400" />
                        <input 
                            className="text-xs bg-transparent border-b border-slate-200 focus:border-blue-500 focus:outline-none py-1 w-80" 
                            placeholder="Search by name or email..." 
                            value={searchQuery}
                            onChange={(e) => setSearchQuery(e.target.value)}
                            autoComplete="off"
                        />
                    </div>
                    {/* Filters - Right Side */}
                    <div className="flex items-center gap-2 flex-wrap justify-end">
                        <SelectDropdown
                            value={filterDepartment}
                            onChange={setFilterDepartment}
                            options={departmentFilterOptions}
                            icon={Building2}
                            shape="pill"
                            menuExpand
                            className="w-[9.5rem]"
                        />
                        <SelectDropdown
                            value={filterRole}
                            onChange={setFilterRole}
                            options={[
                                { value: 'All', label: 'All roles' },
                                ...uniqueRoles.map((role) => ({
                                    value: role,
                                    label: formatUserRoleLabel(role),
                                })),
                            ]}
                            icon={Shield}
                            shape="pill"
                            menuExpand
                            className="w-[8.5rem]"
                        />
                        <SelectDropdown
                            value={filterStatus}
                            onChange={setFilterStatus}
                            options={[
                                { value: 'All', label: 'All status' },
                                { value: 'Active', label: 'Active' },
                                { value: 'Inactive', label: 'Inactive' },
                            ]}
                            icon={Filter}
                            shape="pill"
                            menuExpand
                            className="w-[7.5rem]"
                        />
                        <button
                            onClick={handleExportCsv}
                            disabled={sortedUsers.length === 0}
                            className="p-1.5 hover:bg-slate-100 rounded-lg transition-colors text-slate-600 disabled:opacity-40 disabled:pointer-events-none"
                            title="Export CSV"
                        >
                            <Download size={16} />
                        </button>
                        <button
                            onClick={openAddPanel}
                            className="p-1.5 hover:bg-blue-50 rounded-lg transition-colors text-blue-600"
                            title="Add New User"
                        >
                            <Plus size={16} />
                        </button>
                    </div>
                </div>
                <div className="overflow-x-auto">
                    <table className="w-full min-w-[720px] table-fixed text-[10px] text-left border-collapse">
                        <thead className="bg-slate-50 text-slate-500 font-semibold text-[9px] uppercase border-b border-slate-200">
                            <tr>
                                <th className="w-[20%] px-4 py-3 text-left">Name</th>
                                <th className="w-[24%] px-4 py-3 text-left">Email</th>
                                <th className="w-[11%] px-4 py-3 text-left">Role</th>
                                <th className="w-[14%] px-4 py-3 text-left">Department</th>
                                <th className="w-[23%] px-4 py-3 text-left">Operations</th>
                                <th className="w-[8%] px-4 py-3 text-center">Active</th>
                            </tr>
                        </thead>
                        <tbody className="divide-y divide-slate-100">
                            {pageUsers.map((user) => {
                                const dept = departments.find(d => d.id === user.departmentId);
                                return (
                                    <tr 
                                        key={user.id} 
                                        className="hover:bg-slate-50 cursor-pointer group"
                                        onClick={() => openEditPanel(user)}
                                    >
                                        <td className="px-4 py-3 text-left truncate">
                                            <div className="flex items-center gap-2 min-w-0">
                                                <div className={`w-8 h-8 rounded-full flex items-center justify-center flex-shrink-0 ${user.userRole === 'admin' ? 'bg-blue-600 text-white' : 'bg-slate-100 text-slate-600'}`}>
                                                    {user.userRole === 'admin' ? <Shield size={14} /> : <User size={14} />}
                                                </div>
                                                <span className="font-medium text-slate-900 truncate">{user.fullName}</span>
                                            </div>
                                        </td>
                                        <td className="px-4 py-3 text-left text-slate-600 truncate" title={user.email}>{user.email}</td>
                                        <td className="px-4 py-3 text-left text-slate-600 truncate">{formatUserRoleLabel(user.userRole)}</td>
                                        <td className="px-4 py-3 text-left text-slate-600 truncate">{user.userRole === 'admin' ? '-' : (dept?.name || '-')}</td>
                                        <td className="px-4 py-3 text-left text-slate-500 text-[9px] truncate" title={
                                            user.userRole === 'admin' ? undefined : (
                                                isSupervisorFloorUser(user.userRole, user.assignedOperationIds, user.assignedApps)
                                                    ? [
                                                        formatAssignedOperationsLabel(
                                                            user.assignedOperationIds,
                                                            catalogOperations,
                                                            supervisorFloorExtrasForDepartment(dept),
                                                            { supervisorOnly: true },
                                                        ),
                                                        supervisorFloorExtrasForDepartment(dept).map(labelForFloorDeptFlag).join(', '),
                                                    ].filter(Boolean).join(' · ')
                                                    : user.assignedOperationIds.length
                                                    ? formatAssignedOperationsLabel(
                                                        user.assignedOperationIds,
                                                        catalogOperations,
                                                        operatorExtraFlagsFromAssignedApps(user.assignedApps),
                                                    )
                                                    : (user.assignedApps.length
                                                        ? formatAssignedAppsLabel(user.assignedApps)
                                                        : '-')
                                            )
                                        }>
                                            {user.userRole === 'admin' ? '-' : (
                                                isSupervisorFloorUser(user.userRole, user.assignedOperationIds, user.assignedApps)
                                                    ? [
                                                        formatAssignedOperationsLabel(
                                                            user.assignedOperationIds,
                                                            catalogOperations,
                                                            supervisorFloorExtrasForDepartment(dept),
                                                            { supervisorOnly: true },
                                                        ),
                                                        supervisorFloorExtrasForDepartment(dept).map(labelForFloorDeptFlag).join(', '),
                                                    ].filter(Boolean).join(' · ')
                                                    : user.assignedOperationIds.length
                                                    ? formatAssignedOperationsLabel(
                                                        user.assignedOperationIds,
                                                        catalogOperations,
                                                        operatorExtraFlagsFromAssignedApps(user.assignedApps),
                                                    )
                                                    : (user.assignedApps.length
                                                        ? formatAssignedAppsLabel(user.assignedApps)
                                                        : '-')
                                            )}
                                        </td>
                                        <td className="px-4 py-3 text-center">
                                            <div className="flex items-center justify-center gap-2">
                                                {user.userRole !== 'admin' ? (
                                                    <button
                                                        onClick={(e) => { e.stopPropagation(); handleToggleStatus(user.id, user.status); }}
                                                        className={`relative inline-flex h-5 w-9 items-center rounded-full transition-colors ${user.status === 'Active' ? 'bg-emerald-500' : 'bg-slate-300'}`}
                                                        title={user.status === 'Active' ? 'Click to deactivate' : 'Click to activate'}
                                                    >
                                                        <span className={`inline-block h-3.5 w-3.5 transform rounded-full bg-white shadow-sm transition-transform ${user.status === 'Active' ? 'translate-x-5' : 'translate-x-1'}`} />
                                                    </button>
                                                ) : (
                                                    <span className="inline-flex items-center gap-1 text-emerald-600 text-[10px] font-medium">
                                                        <CheckCircle size={14} /> Active
                                                    </span>
                                                )}
                                            </div>
                                        </td>
                                    </tr>
                                );
                            })}
                            {sortedUsers.length === 0 && (
                                <tr>
                                    <td colSpan={7} className="px-4 py-12 text-center text-slate-400">
                                        <Users size={48} className="mx-auto mb-3 text-slate-300" />
                                        <p>No users found</p>
                                    </td>
                                </tr>
                            )}
                        </tbody>
                    </table>
                    <Pagination {...pagination} />
                </div>
            </div>

            {/* Side Panel - Add/Edit User */}
            {showPanel && (
                <>
                    <div className="fixed inset-0 bg-black/40 z-40 animate-in fade-in duration-200" onClick={requestClosePanel} />
                    <div className="fixed right-0 top-0 h-full w-96 bg-white shadow-2xl z-50 animate-in slide-in-from-right duration-300 flex flex-col">
                        {/* Header */}
                        <div className="p-5 border-b border-slate-100 bg-slate-50">
                            <div className="flex items-center justify-between">
                                <div className="flex items-center gap-3">
                                    <div className={`w-10 h-10 rounded-xl flex items-center justify-center ${editingUser ? (isEditingAdmin ? 'bg-blue-600 text-white' : 'bg-slate-200 text-slate-600') : 'bg-emerald-100 text-emerald-600'}`}>
                                        {editingUser ? (isEditingAdmin ? <Shield size={20} /> : <User size={20} />) : <Plus size={20} />}
                                    </div>
                                    <div>
                                        <h3 className="font-bold text-slate-900">{editingUser ? 'Edit User' : 'Add New User'}</h3>
                                        <p className="text-[10px] text-slate-400">{editingUser ? editingUser.email : 'Create a new account'}</p>
                                    </div>
                                </div>
                                <div className="flex items-center gap-1">
                                    {editingUser && !isEditingAdmin && (
                                        <button 
                                            onClick={() => handleDeleteUser(editingUser.id, editingUser.userRole, editingUser.fullName || editingUser.email)}
                                            className="p-2 hover:bg-red-100 rounded-lg transition-colors text-slate-400 hover:text-red-500"
                                            title="Delete User"
                                        >
                                            <Trash2 size={18} />
                                        </button>
                                    )}
                                    <button onClick={requestClosePanel} className="p-2 hover:bg-slate-200 rounded-lg transition-colors">
                                        <X size={18} className="text-slate-500" />
                                    </button>
                                </div>
                            </div>
                        </div>

                        {/* Admin Badge */}
                        {isEditingAdmin && (
                            <div className="mx-5 mt-4 p-3 bg-blue-50 border border-blue-200 rounded-lg flex items-center gap-2">
                                <Lock size={14} className="text-blue-600" />
                                <span className="text-xs text-blue-700 font-medium">Admin account - Limited editing available</span>
                            </div>
                        )}

                        {/* Form */}
                        <form className="flex-1 overflow-y-auto p-5 space-y-4" autoComplete="off" onSubmit={(e) => e.preventDefault()}>
                            {/* Full Name */}
                            <div>
                                <label className="block text-xs font-semibold text-slate-600 mb-1.5">Full Name</label>
                                <div className="relative">
                                    <User className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" size={16} />
                                    <input
                                        type="text"
                                        className="pl-10 pr-4 py-2.5 w-full border border-slate-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-100 focus:border-blue-400 text-xs"
                                        placeholder="John Doe"
                                        value={formData.fullName}
                                        onChange={(e) => patchFormData({ fullName: e.target.value })}
                                    />
                                </div>
                            </div>

                            {!isEditingAdmin && (
                                <p className="text-[10px] text-slate-500 bg-slate-50 border border-slate-200 rounded-lg px-3 py-2">
                                    {isViewerAccount
                                        ? <>Viewer accounts sign in to the <strong>desktop app</strong> with email and password (read-only).</>
                                        : <>Floor users sign in on the mobile app with <strong>email and PIN</strong>.</>}
                                </p>
                            )}

                            {/* Email - Read only when editing */}
                            <div>
                                <label className="block text-xs font-semibold text-slate-600 mb-1.5">Email</label>
                                <div className="relative">
                                    <Mail className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" size={16} />
                                    <input
                                        type="email"
                                        className={`pl-10 pr-4 py-2.5 w-full border border-slate-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-100 focus:border-blue-400 text-xs ${editingUser ? 'bg-slate-50 text-slate-500' : ''}`}
                                        placeholder="john@example.com"
                                        value={formData.email}
                                        onChange={(e) => patchFormData({ email: e.target.value })}
                                        disabled={!!editingUser}
                                        autoComplete="off"
                                    />
                                </div>
                            </div>

                            {isEditingAdmin ? (
                                <div>
                                    <label className="block text-xs font-semibold text-slate-600 mb-1.5">App Role</label>
                                    <div className="px-4 py-2.5 bg-blue-50 border border-blue-200 rounded-lg text-xs text-blue-700 font-medium flex items-center gap-2">
                                        <Shield size={14} /> Admin
                                    </div>
                                </div>
                            ) : (
                                <>
                                    {!isTerminalDept && (
                                        <div>
                                            <SelectDropdown
                                                id="user-role"
                                                label="Role"
                                                value={selectedRoleValue}
                                                onChange={(mode) => {
                                                    if (isPassiveSupervisorOnlyDept && mode === 'operator') return;
                                                    setPanelDirty(true);
                                                    if (mode === 'viewer') {
                                                        setFormData((prev) => ({
                                                            ...prev,
                                                            userRole: 'viewer',
                                                            supervisorOnly: false,
                                                            workforceOnly: false,
                                                            departmentId: '',
                                                            assignedOperationIds: [],
                                                            floorDeptFlags: [],
                                                            assignedApps: [],
                                                            floorPin: '',
                                                            password: '',
                                                        }));
                                                        return;
                                                    }
                                                    if (mode === 'supervisor') {
                                                        setFormData((prev) => {
                                                            const dept = departments.find((d) => d.id === prev.departmentId);
                                                            return {
                                                                ...prev,
                                                                userRole: 'supervisor',
                                                                password: '',
                                                                supervisorOnly: true,
                                                                workforceOnly: true,
                                                                assignedOperationIds: prev.departmentId
                                                                    ? (prev.assignedOperationIds.length > 0
                                                                        ? prev.assignedOperationIds
                                                                        : defaultAssignedOperationIds(
                                                                            catalogOperations,
                                                                            prev.departmentId,
                                                                        ))
                                                                    : [],
                                                                floorDeptFlags: dept
                                                                    ? supervisorFloorExtrasForDepartment(dept)
                                                                    : [],
                                                            };
                                                        });
                                                        return;
                                                    }
                                                    setFormData((prev) => {
                                                        const dept = departments.find((d) => d.id === prev.departmentId);
                                                        const extras = dept
                                                            ? operatorOptionalFloorExtrasForDepartment(
                                                                dept.apps,
                                                                factoryEntitlements,
                                                                dept,
                                                            )
                                                            : [];
                                                        return {
                                                            ...prev,
                                                            userRole: 'operator',
                                                            password: '',
                                                            supervisorOnly: false,
                                                            workforceOnly: false,
                                                            assignedOperationIds: prev.departmentId
                                                                ? (prev.assignedOperationIds.length > 0
                                                                    ? prev.assignedOperationIds
                                                                    : defaultAssignedOperationIds(
                                                                        catalogOperations,
                                                                        prev.departmentId,
                                                                    ))
                                                                : [],
                                                            floorDeptFlags: extras.includes('audit') ? ['audit'] : [],
                                                        };
                                                    });
                                                }}
                                                options={roleOptions}
                                                className="w-full"
                                            />
                                        </div>
                                    )}

                                    {isViewerAccount && (
                                        <div>
                                            <label className="block text-xs font-semibold text-slate-600 mb-1.5">
                                                Password
                                            </label>
                                            <div className="relative">
                                                <Lock className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" size={16} />
                                                <input
                                                    type={showViewerPassword ? 'text' : 'password'}
                                                    required
                                                    className="pl-10 pr-10 py-2.5 w-full border border-slate-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-100 focus:border-blue-400 text-xs"
                                                    placeholder="Enter sign-in password"
                                                    value={formData.password}
                                                    onChange={(e) => patchFormData({ password: e.target.value })}
                                                    autoComplete="new-password"
                                                />
                                                <button
                                                    type="button"
                                                    onClick={() => setShowViewerPassword((prev) => !prev)}
                                                    className="absolute right-3 top-1/2 -translate-y-1/2 text-slate-400 hover:text-slate-600"
                                                    aria-label={showViewerPassword ? 'Hide password' : 'Show password'}
                                                >
                                                    {showViewerPassword ? <EyeOff size={16} /> : <Eye size={16} />}
                                                </button>
                                            </div>
                                            <p className="text-[10px] text-slate-400 mt-1">
                                                At least 6 characters. Required for viewer desktop sign-in.
                                            </p>
                                        </div>
                                    )}

                                    {!isViewerAccount && (
                                    <>
                                    <div>
                                        <SelectDropdown
                                            id="user-work-center"
                                            label="Work center"
                                            value={formData.departmentId}
                                            onChange={(deptId) => {
                                                const dept = departments.find((d) => d.id === deptId);
                                                const terminal = isTerminalDepartment(dept);
                                                const passive = isPassiveSupervisorOnlyDepartment(dept);
                                                setPanelDirty(true);
                                                if (terminal) {
                                                    setFormData({
                                                        ...formData,
                                                        departmentId: deptId,
                                                        userRole: 'quality_manager',
                                                        workforceOnly: false,
                                                        supervisorOnly: false,
                                                        assignedOperationIds: defaultTerminalAssignedOperationIds(catalogOperations, deptId),
                                                        floorDeptFlags: [],
                                                        assignedApps: [],
                                                    });
                                                    return;
                                                }
                                                if (passive) {
                                                    setFormData({
                                                        ...formData,
                                                        departmentId: deptId,
                                                        userRole: 'supervisor',
                                                        workforceOnly: true,
                                                        supervisorOnly: true,
                                                        assignedOperationIds: defaultAssignedOperationIds(catalogOperations, deptId),
                                                        floorDeptFlags: supervisorFloorExtrasForDepartment(dept),
                                                        assignedApps: [],
                                                    });
                                                    return;
                                                }
                                                setFormData({
                                                    ...formData,
                                                    departmentId: deptId,
                                                    userRole: 'operator',
                                                    workforceOnly: false,
                                                    supervisorOnly: false,
                                                    assignedOperationIds: defaultAssignedOperationIds(catalogOperations, deptId),
                                                    floorDeptFlags: [],
                                                    assignedApps: [],
                                                });
                                            }}
                                            options={[
                                                { value: '', label: 'Select work center…' },
                                                ...departments.map((dept) => ({
                                                    value: dept.id,
                                                    label: `${dept.name}${dept.role === 'terminal' ? ' (Terminal)' : ''}`,
                                                })),
                                            ]}
                                            className="w-full"
                                        />
                                    </div>

                                    {isTerminalDept && !isEditingAdmin && terminalDispatchOp && (
                                        <div>
                                            <label className="block text-xs font-semibold text-slate-600 mb-1.5">Production</label>
                                            <p className="text-[10px] text-slate-400 mb-2">
                                                Terminal users are assigned the Dispatch operation. Shipment / QA covers all factory shipment screens.
                                            </p>
                                            <div className="flex items-start gap-3 p-3 rounded-lg border border-blue-400 bg-blue-50 text-left">
                                                <div className="w-4 h-4 rounded border flex-shrink-0 mt-0.5 flex items-center justify-center bg-blue-600 border-blue-600 text-white">
                                                    <Check size={10} strokeWidth={3} />
                                                </div>
                                                <div>
                                                    <div className="text-xs font-semibold text-slate-800">
                                                        {terminalDispatchOp.name}
                                                    </div>
                                                    <div className="text-[10px] text-slate-500 mt-0.5">
                                                        {SHIPMENT_QA_LABEL}
                                                        {factoryShipmentApps.length > 0 && (
                                                            <span className="text-slate-400">
                                                                {' '}
                                                                ({factoryShipmentApps.map(labelForDeptApp).join(', ')})
                                                            </span>
                                                        )}
                                                    </div>
                                                </div>
                                            </div>
                                        </div>
                                    )}

                                    {isTerminalDept && !isEditingAdmin && !terminalDispatchOp && formData.departmentId && (
                                        <p className="text-[10px] text-amber-700 bg-amber-50 border border-amber-100 rounded-lg px-3 py-2">
                                            Dispatch operation is missing on this terminal work center. Run migrations or open Work centers to seed it.
                                        </p>
                                    )}

                                    {!isTerminalDept && !isEditingAdmin && isSupervisorAssignment && supervisorLockedFlags.length > 0 && (
                                        <div>
                                            <label className="block text-xs font-semibold text-slate-600 mb-1.5">Visit apps</label>
                                            {!isPassiveSupervisorOnlyDept && (
                                                <p className="text-[10px] text-slate-400 mb-2">
                                                    {isOriginCuttingDept
                                                        ? 'Origin supervisors hand over cut pieces to the next department. Operators capture lay reports — they do not get handover.'
                                                        : 'Locked for supervisors — handover and workforce cannot be turned off.'}
                                                </p>
                                            )}
                                            <div className="grid gap-2">
                                                {supervisorLockedFlags.map((flag) => (
                                                    <div
                                                        key={flag}
                                                        className="flex items-start gap-3 p-3 rounded-lg border border-blue-400 bg-blue-50 text-left cursor-not-allowed"
                                                    >
                                                        <div className="w-4 h-4 rounded border flex-shrink-0 mt-0.5 flex items-center justify-center bg-blue-600 border-blue-600 text-white">
                                                            <Check size={10} strokeWidth={3} />
                                                        </div>
                                                        <div className="flex-1 min-w-0">
                                                            <div className="text-xs font-semibold text-slate-800 flex items-center gap-1.5">
                                                                {labelForFloorDeptFlag(flag)}
                                                                <Lock size={10} className="text-slate-400 flex-shrink-0" />
                                                            </div>
                                                        </div>
                                                    </div>
                                                ))}
                                            </div>
                                        </div>
                                    )}

                                    {!isTerminalDept && !isEditingAdmin && selectableOperations.length > 0 && (
                                        <div>
                                            <label className="block text-xs font-semibold text-slate-600 mb-1.5">
                                                {isSupervisorAssignment ? 'Supervision scope' : 'Production'}
                                            </label>
                                            <p className="text-[10px] text-slate-400 mb-2">
                                                {isSupervisorAssignment
                                                    ? isPassiveSupervisorOnlyDept
                                                        ? 'Handover scope for this work center.'
                                                        : 'Select which visits/operations this supervisor handles handover and workforce for (e.g. Block Cutting vs Fixed Cutting).'
                                                    : isOriginCuttingDept
                                                        ? 'Operators capture lay reports. Handover is supervisor-only — assign a separate supervisor user on this work center.'
                                                        : 'Each selected operation grants its capture app (hourly, QC, batch, lay report).'}
                                            </p>
                                            <div className="grid gap-2 max-h-48 overflow-y-auto">
                                                {selectableOperations.map((op) => {
                                                    const checked = formData.assignedOperationIds.includes(op.id);
                                                    return (
                                                        <button
                                                            key={op.id}
                                                            type="button"
                                                            onClick={() => toggleAssignedOperation(op.id)}
                                                            className={`flex items-start gap-3 p-3 rounded-lg border text-left transition-colors ${
                                                                checked
                                                                    ? 'border-blue-400 bg-blue-50'
                                                                    : 'border-slate-200 bg-white hover:bg-slate-50'
                                                            }`}
                                                        >
                                                            <div className={`w-4 h-4 rounded border flex-shrink-0 mt-0.5 flex items-center justify-center ${
                                                                checked ? 'bg-blue-600 border-blue-600 text-white' : 'border-slate-300'
                                                            }`}>
                                                                {checked && <Check size={10} strokeWidth={3} />}
                                                            </div>
                                                            <div>
                                                                <div className="text-xs font-semibold text-slate-800">
                                                                    {op.name}
                                                                </div>
                                                                <div className="text-[10px] text-slate-500 mt-0.5">
                                                                    {labelForCaptureApp(op.capture_app || 'transaction', op.step_type)}
                                                                </div>
                                                            </div>
                                                        </button>
                                                    );
                                                })}
                                            </div>
                                        </div>
                                    )}

                                    {!isTerminalDept && !isEditingAdmin && selectableOperations.length === 0 && formData.departmentId && (
                                        <p className="text-[10px] text-amber-700 bg-amber-50 border border-amber-100 rounded-lg px-3 py-2">
                                            {isSupervisorAssignment
                                                ? 'No operations on this work center yet. Add operations in Work centers first, then assign supervisor scope.'
                                                : isOriginCuttingDept
                                                    ? 'No cutting operations on this work center yet. Add operations in Work centers, or assign a supervisor for handover only.'
                                                    : 'No operations on this work center yet. Assign as supervisor, or add operations in Work centers first.'}
                                        </p>
                                    )}

                                    {!isTerminalDept && !isEditingAdmin && !isSupervisorAssignment && availableDeptFlags.length > 0 && (
                                        <div>
                                            <label className="block text-xs font-semibold text-slate-600 mb-1.5">Other apps</label>
                                            <p className="text-[10px] text-slate-400 mb-2">
                                                Optional audit access on top of production operations.
                                            </p>
                                            <div className="grid gap-2">
                                                {availableDeptFlags.map((flag) => {
                                                    const checked = formData.floorDeptFlags.includes(flag);
                                                    return (
                                                        <button
                                                            key={flag}
                                                            type="button"
                                                            onClick={() => toggleFloorDeptFlag(flag)}
                                                            className={`flex items-start gap-3 p-3 rounded-lg border text-left transition-colors ${
                                                                checked
                                                                    ? 'border-blue-400 bg-blue-50'
                                                                    : 'border-slate-200 bg-white hover:bg-slate-50'
                                                            }`}
                                                        >
                                                            <div className={`w-4 h-4 rounded border flex-shrink-0 mt-0.5 flex items-center justify-center ${
                                                                checked ? 'bg-blue-600 border-blue-600 text-white' : 'border-slate-300'
                                                            }`}>
                                                                {checked && <Check size={10} strokeWidth={3} />}
                                                            </div>
                                                            <div className="text-xs font-semibold text-slate-800">
                                                                {labelForFloorDeptFlag(flag)}
                                                            </div>
                                                        </button>
                                                    );
                                                })}
                                            </div>
                                        </div>
                                    )}

                                    {!isTerminalDept && !isEditingAdmin && (
                                        <div>
                                            <label className="block text-xs font-semibold text-slate-600 mb-1.5">Floor PIN (4 digits)</label>
                                            <input
                                                type="text"
                                                inputMode="numeric"
                                                maxLength={4}
                                                className="w-full px-3 py-2.5 text-xs border border-slate-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-100 focus:border-blue-400 font-mono tracking-widest"
                                                placeholder="e.g. 1234"
                                                value={formData.floorPin}
                                                onChange={(e) => patchFormData({ floorPin: e.target.value.replace(/\D/g, '').slice(0, 4) })}
                                            />
                                        </div>
                                    )}
                                    </>
                                    )}
                                </>
                            )}

                            {/* Status */}
                            <div>
                                <SelectDropdown
                                    id="user-status"
                                    label="Status"
                                    value={formData.status}
                                    onChange={(v) => patchFormData({ status: v as 'Active' | 'Inactive' })}
                                    options={[
                                        { value: 'Active', label: 'Active' },
                                        { value: 'Inactive', label: 'Inactive' },
                                    ]}
                                    className="w-full"
                                />
                            </div>

                            {editingUser && archivedOps.length > 0 && (
                                <div>
                                    <label className="block text-xs font-semibold text-slate-600 mb-1.5">
                                        Deactivated operations
                                    </label>
                                    <p className="text-[10px] text-slate-400 mb-2">
                                        Deactivated catalog operations this user was previously granted.
                                    </p>
                                    <div className="grid gap-2">
                                        {archivedOps.map((op) => {
                                            const capture = archivedCaptureLabel(op);
                                            return (
                                                <div
                                                    key={op.operationId}
                                                    className="flex items-start gap-3 p-3 rounded-lg border border-red-200 bg-red-50 text-left"
                                                >
                                                    <div className="w-4 h-4 rounded border border-red-300 bg-red-100 flex-shrink-0 mt-0.5" />
                                                    <div>
                                                        <div className="text-xs font-semibold text-red-900">
                                                            {op.name}
                                                        </div>
                                                        {capture ? (
                                                            <div className="text-[10px] text-red-700/80 mt-0.5">
                                                                {capture}
                                                            </div>
                                                        ) : null}
                                                    </div>
                                                </div>
                                            );
                                        })}
                                    </div>
                                </div>
                            )}
                        </form>

                        {/* Footer */}
                        <div className="p-5 border-t border-slate-100 bg-slate-50 space-y-2">
                            <Button
                                onClick={editingUser ? handleUpdateUser : handleCreateUser}
                                disabled={saving}
                                className="w-full"
                            >
                                {saving ? 'Saving...' : (editingUser ? 'Save Changes' : 'Create User')}
                            </Button>
                            <Button
                                variant="secondary"
                                onClick={requestClosePanel}
                                className="w-full"
                            >
                                Cancel
                            </Button>
                        </div>
                    </div>
                </>
            )}

            <Modal isOpen={showDiscardDialog} onClose={cancelDiscardDialog}>
                <div className="relative">
                    <button
                        onClick={cancelDiscardDialog}
                        className="absolute top-4 right-4 text-slate-400 hover:text-red-600 transition-colors p-1 hover:bg-red-50 rounded-full"
                    >
                        <X size={20} />
                    </button>

                    <div className="flex flex-col items-center p-8 pb-4 text-center">
                        <div className="w-16 h-16 bg-amber-100 text-amber-600 rounded-2xl flex items-center justify-center mb-4 shadow-sm ring-4 ring-amber-50">
                            <AlertTriangle size={32} />
                        </div>
                        <h3 className="text-base font-bold text-slate-900 mb-2">Unsaved Changes</h3>
                        <p className="text-slate-500 text-xs max-w-[260px] leading-relaxed">
                            You have unsaved modifications. What would you like to do?
                        </p>
                    </div>

                    <div className="p-6 pt-2 flex flex-col gap-3">
                        <Button
                            onClick={confirmSaveAndClosePanel}
                            disabled={saving}
                            className="w-full shadow-lg shadow-blue-100 py-2.5 text-xs"
                        >
                            {saving ? <Loader2 size={14} className="animate-spin mx-auto" /> : 'Save Changes'}
                        </Button>
                        <Button
                            variant="danger-light"
                            onClick={confirmDiscardPanel}
                            className="w-full text-xs"
                        >
                            Discard & Close
                        </Button>
                    </div>
                </div>
            </Modal>

            <Modal isOpen={showDeleteDialog} onClose={cancelDeleteUser}>
                <div className="relative">
                    <button
                        onClick={cancelDeleteUser}
                        className="absolute top-4 right-4 text-slate-400 hover:text-red-600 transition-colors p-1 hover:bg-red-50 rounded-full"
                    >
                        <X size={20} />
                    </button>

                    <div className="flex flex-col items-center p-8 pb-4 text-center">
                        <div className="w-16 h-16 bg-red-100 text-red-600 rounded-2xl flex items-center justify-center mb-4 shadow-sm ring-4 ring-red-50">
                            <Trash2 size={32} />
                        </div>
                        <h3 className="text-base font-bold text-slate-900 mb-2">Delete User?</h3>
                        <p className="text-slate-500 text-xs max-w-[280px] leading-relaxed">
                            <span className="font-medium text-slate-700">{deleteTarget?.label}</span> will be
                            permanently removed. This cannot be undone.
                        </p>
                    </div>

                    <div className="p-6 pt-2 flex flex-col gap-3">
                        <Button
                            variant="danger"
                            onClick={confirmDeleteUser}
                            disabled={saving}
                            className="w-full py-2.5 text-xs"
                        >
                            {saving ? <Loader2 size={14} className="animate-spin mx-auto" /> : 'Delete'}
                        </Button>
                        <Button variant="secondary" onClick={cancelDeleteUser} className="w-full text-xs">
                            Cancel
                        </Button>
                    </div>
                </div>
            </Modal>

        </PageShell>
    );
};
