import React, { useEffect, useMemo, useRef, useState } from 'react';
import { get, set, del } from 'idb-keyval';
import { useNavigationStore, useDataStore, useNotificationStore } from '../../stores';
import {
    allowOrderDraftWrites,
    clearOrderDraft,
    consumeOrderDraftDiscarded,
    currentOrderDraftEpoch,
    isOrderDraftWriteBlocked,
    markOrderDraftDiscarded,
    orderDraftStorageKey,
    shouldSkipOrderDraftHydrate,
} from '../../lib/orderDraftStorage';
import { useOrderFormSettings } from '../../lib/queries/settingsSlices';
import { RoutePath } from '../../types';
import { Trash2, CheckCircle2, AlertTriangle, Loader2 } from 'lucide-react';
import { OrderMasterDetailSkeleton } from '../../components/production/OrderMasterDetailSkeleton';
import { ShipmentPlanPanel, type ShipmentPlanPanelHandle } from '../../components/production/ShipmentPlanPanel';
import { Button, Card, Modal } from '../../components/ui';
import { UnsavedChangesModal } from '../../components/settings/UnsavedChangesModal';
import { DesktopWriteGate } from '../../components/DesktopWriteGate';
import { PageShell } from '../../components/layout/PageShell';
import { usePageHeader } from '../../components/Breadcrumb';
import { daysBetween, formatDateDDMMYYYY, todayIso } from '../../lib/orderDateUtils';
import { previewInternalOrderNo } from '../../lib/internalOrderNo';
import { supabase } from '../../lib/supabase';
import { sizeAdjQty, sizeOrderQty, sumSizeAdjQty, sumSizeOrderQty, orderedSizeKeys } from '../../lib/colorwaySizesUtils';
import { dropdownValuesForCategory } from '../../lib/supportDropdownValues';
import { useOrderForEdit } from '../../hooks/useOrderForEdit';
import {
  findOrderColorConflictDb,
  findPoNumberConflict,
  useInternalOrderNumbers,
} from '../../lib/orderFormQueries';
import {
    SIZE_GROUP_SNAPSHOT,
    buildSizeGroupDropdownOptions,
    collectSizeKeysFromColorways,
    displaySizesForOrder,
    formatSizeLabels,
    mergeTemplateSizesIntoColorways,
    parseSizeGroupTemplateValue,
    parseSizeLabels,
    pruneSizeColumnIfAllZero,
    pruneOrphanSizesFromTemplate,
    sizeGroupTemplateValue,
} from '../../lib/orderSizeGroupSelection';
import {
    EMPTY_ORDER_SHIPMENT_PLAN,
    expandShipmentPlanLines,
    isActiveShipmentLine,
    planTotalQty,
    planBalanceTotal,
    primaryShipmentDate,
    pruneShipmentPlan,
    rowTotal,
    parseOrderShipmentPlan,
    type OrderShipmentPlan,
    validateShipmentPlanQty,
} from '../../lib/orderShipmentPlan';
import { OrderHeaderSection } from './create-order/components/OrderHeaderSection';
import { OrderValidationSummary } from './create-order/components/OrderValidationSummary';
import { ColorwayWorkspaceSection } from './create-order/components/ColorwayWorkspaceSection';
import { ShipmentPlanSection } from './create-order/components/ShipmentPlanSection';
import { useHeaderReducer } from './create-order/hooks/useHeaderReducer';
import { useColorwayReducer } from './create-order/hooks/useColorwayReducer';
import { useShipmentReducer } from './create-order/hooks/useShipmentReducer';
import { useValidationReducer } from './create-order/hooks/useValidationReducer';
import { useModuleEnabled } from '../../core/modules/useModuleEnabled';
import {
    type OrderWizardStage,
    isMaterialsStepFilled,
    isShipmentsStepFilled,
    isStyleStepFilled,
    resolveOrderWizardStage,
} from './create-order/orderWizardStages';
import { OrderWizardFooter } from './create-order/components/OrderWizardFooter';
import { MaterialsStageSection } from './create-order/components/MaterialsStageSection';
import { OrderReviewSummary } from './create-order/components/OrderReviewSummary';
import { groupLegacyFabricLines } from '../../lib/styleFabricLines';
import { reloadOrderFromDb } from '../../lib/reloadOrderFromDb';
import type { StyleOrder } from '../../types';

type OrderDraftPayload = {
    id: string;
    header: Record<string, unknown>;
    colorways: StyleOrder['colorways'];
    shipmentPlan: OrderShipmentPlan;
    epoch?: number;
};

export const CreateOrderMaster: React.FC = () => {
    const {
        navigate,
        routeParams,
        isUnsaved,
        setUnsaved,
        setPendingSaveAction,
        setPendingDiscardAction,
    } = useNavigationStore();
    const factoryId = useNavigationStore((s) => s.factoryId);
    const { addOrder, updateOrder, deleteOrder, wipOrder, setWipOrder } = useDataStore();
    const { sizeGroups, buyers, supportDropdowns, loading: settingsLoading } = useOrderFormSettings(factoryId);
    const { showNotification } = useNotificationStore();

    const editOrderId = routeParams?.id ?? null;
    const isEditingExistingOrder = Boolean(editOrderId);
    const { data: internalOrderNumbers = [], isLoading: internalNosLoading } = useInternalOrderNumbers(
        factoryId,
        !isEditingExistingOrder,
    );

    const {
        order: editOrder,
        loading: editOrderLoading,
    } = useOrderForEdit(factoryId, editOrderId);

    const hydratedIdRef = useRef<string | null>(null);
    const skipAllowanceRecalcRef = useRef(false);
    const handleConfirmOrderRef = useRef<(options?: { silent?: boolean }) => Promise<boolean>>(async () => false);
    const draftOrderIdRef = useRef<string | null>(null);
    const shipmentPlanRef = useRef<ShipmentPlanPanelHandle>(null);

    const materialOn = useModuleEnabled('material');
    const styleFabricsRef = useRef<HTMLDivElement | null>(null);

    const { state: header, dispatch: headerDispatch } = useHeaderReducer();
    usePageHeader(
        isEditingExistingOrder
            ? {
                title: 'Edit Order',
                subtitle: header.styleName.trim()
                    ? header.styleName.trim()
                    : 'Update this production order',
            }
            : {
                title: 'Create Order',
                subtitle: 'Create a new production order',
            },
        isEditingExistingOrder ? `edit:${editOrderId}:${header.styleName}` : 'create',
    );
    const { state: colorway, dispatch: colorwayDispatch } = useColorwayReducer();
    const { state: shipment, dispatch: shipmentDispatch } = useShipmentReducer();
    const { state: errors, dispatch: validationDispatch } = useValidationReducer();

    const [orderHydrated, setOrderHydrated] = useState(!editOrderId);
    const [successModalOpen, setSuccessModalOpen] = useState(false);
    const [savedOrderId, setSavedOrderId] = useState<string | null>(null);
    const [deleteModalOpen, setDeleteModalOpen] = useState(false);
    const [deleteLoading, setDeleteLoading] = useState(false);
    const [showDiscardDialog, setShowDiscardDialog] = useState(false);
    const [saving, setSaving] = useState(false);
    const [fabricWarnings, setFabricWarnings] = useState<string[]>([]);
    const [stage, setStage] = useState<OrderWizardStage>(() => resolveOrderWizardStage(routeParams?.stage));

    const headerDispatchWithUnsaved = React.useCallback(
        (action: Parameters<typeof headerDispatch>[0]) => {
            headerDispatch(action);
            if (hydratedIdRef.current) setUnsaved(true);
        },
        [headerDispatch, setUnsaved],
    );

    const colorwayDispatchWithUnsaved = React.useCallback(
        (action: Parameters<typeof colorwayDispatch>[0]) => {
            colorwayDispatch(action);
            if (hydratedIdRef.current) setUnsaved(true);
        },
        [colorwayDispatch, setUnsaved],
    );

    const shipmentDispatchWithUnsaved = React.useCallback(
        (action: Parameters<typeof shipmentDispatch>[0]) => {
            shipmentDispatch(action);
            if (hydratedIdRef.current) setUnsaved(true);
        },
        [shipmentDispatch, setUnsaved],
    );

    const resolveNewOrderId = (): string => {
        if (isEditingExistingOrder && editOrderId) return editOrderId;
        if (wipOrder?.id) return wipOrder.id;
        if (!draftOrderIdRef.current) draftOrderIdRef.current = crypto.randomUUID();
        return draftOrderIdRef.current;
    };

    const clearDraft = (factoryIdToUse = factoryId) => {
        void clearOrderDraft(factoryIdToUse);
    };

    const populateState = (order: StyleOrder) => {
        skipAllowanceRecalcRef.current = true;
        const buyerObj =
            buyers.find((b) => b.id === order.buyerId) ||
            buyers.find((b) => b.name === order.buyer);
        const snapshottedSizeKeys = order.sizeLabels
            ? parseSizeLabels(order.sizeLabels)
            : orderedSizeKeys(order.colorways?.[0]?.sizes, collectSizeKeysFromColorways(order.colorways || []));
        const matchedGroup = order.sizeGroup
            ? sizeGroups.find((g) => g.id === order.sizeGroup)
            : sizeGroups.find((g) => g.name === order.sizeGroupName);
        const restoredSizeGroup = isEditingExistingOrder
            ? SIZE_GROUP_SNAPSHOT
            : matchedGroup
                ? sizeGroupTemplateValue(matchedGroup.id)
                : order.sizeGroup
                    ? sizeGroupTemplateValue(order.sizeGroup)
                    : (order.sizeLabels || (order.colorways?.length ?? 0) > 0)
                        ? SIZE_GROUP_SNAPSHOT
                        : '';

        headerDispatch({
            type: 'hydrate',
            header: {
                styleName: order.styleName || '',
                styleRef: order.styleRef || '',
                poNumber: order.poNumber || '',
                selectedBuyer: buyerObj?.id || '',
                orderDate: order.orderDate || '',
                jobCardDate: order.jobCardDate || order.orderDate || todayIso(),
                sizeGroupSelection: restoredSizeGroup,
                snapshottedGroupName: order.sizeGroupName || '',
                snapshottedSizeKeys,
                sewingSam: order.sewingSam?.toString() || order.sam?.toString() || '',
                priority: order.priority ?? 'normal',
                garmentType: order.garmentType || '',
                merchantName: order.merchantName || '',
                orderType: order.orderType ?? 'new',
                season: order.season || '',
                internalOrderNo: order.internalOrderNo || '',
                styleImage: order.image || '',
                showImageInput: false,
                cuttingAllowance: order.cuttingAllowance ?? 2,
                applyExtraAllowance: (order.shipmentAllowance ?? 0) > 0,
                remarks: order.remarks || '',
            },
        });
        colorwayDispatch({
            type: 'hydrate',
            colorways: order.colorways || [],
            selectedColorId: order.colorways?.[0]?.id ?? null,
            snapshot: order.colorways || [],
        });
        shipmentDispatch({ type: 'hydrate', plan: parseOrderShipmentPlan(order.shipmentPlan) });
    };

    const populateDraft = (draft: OrderDraftPayload) => {
        skipAllowanceRecalcRef.current = true;
        const { factoryCode: _, ...headerWithoutFactory } = draft.header || {};
        headerDispatch({ type: 'hydrate', header: headerWithoutFactory });
        colorwayDispatch({
            type: 'hydrate',
            colorways: draft.colorways || [],
            selectedColorId: draft.colorways?.[0]?.id ?? null,
            snapshot: draft.colorways || [],
        });
        shipmentDispatch({ type: 'hydrate', plan: draft.shipmentPlan || { ...EMPTY_ORDER_SHIPMENT_PLAN } });
        draftOrderIdRef.current = draft.id || crypto.randomUUID();
    };

    useEffect(() => {
        if (editOrderId) {
            const wipMatches = Boolean(wipOrder) && wipOrder.id === editOrderId;
            if (wipMatches && wipOrder) {
                const wipKey = `wip:${wipOrder.id}`;
                if (hydratedIdRef.current === wipKey) return;
                draftOrderIdRef.current = wipOrder.id;
                populateState(wipOrder);
                hydratedIdRef.current = wipKey;
                setOrderHydrated(true);
                setUnsaved(true);
            }
            return;
        }

        if (!factoryId) return;

        if (shouldSkipOrderDraftHydrate(factoryId)) {
            useDataStore.getState().setWipOrder(null);
            allowOrderDraftWrites();
            void clearOrderDraft(factoryId).then(() => consumeOrderDraftDiscarded(factoryId));
            if (hydratedIdRef.current !== 'new' || wipOrder) {
                headerDispatch({ type: 'reset' });
                colorwayDispatch({ type: 'reset' });
                shipmentDispatch({ type: 'reset' });
                validationDispatch({ type: 'reset' });
            }
            draftOrderIdRef.current = crypto.randomUUID();
            hydratedIdRef.current = 'new';
            setUnsaved(false);
            setOrderHydrated(true);
            return;
        }

        if (wipOrder) {
            const wipKey = `wip:${wipOrder.id}`;
            if (hydratedIdRef.current === wipKey) return;
            draftOrderIdRef.current = wipOrder.id;
            populateState(wipOrder);
            hydratedIdRef.current = wipKey;
            setOrderHydrated(true);
            setUnsaved(true);
            return;
        }

        if (hydratedIdRef.current === 'new') return;

        allowOrderDraftWrites();

        let cancelled = false;
        const storageKey = orderDraftStorageKey(factoryId);

        void (async () => {
            let draft: OrderDraftPayload | null = null;

            try {
                const fromIdb = await get<OrderDraftPayload>(storageKey);
                if (fromIdb && typeof fromIdb === 'object') {
                    draft = fromIdb;
                }
            } catch {
                // ignore corrupt IDB draft
            }

            if (!draft) {
                const legacyRaw = localStorage.getItem(storageKey);
                if (legacyRaw) {
                    try {
                        draft = JSON.parse(legacyRaw) as OrderDraftPayload;
                        localStorage.removeItem(storageKey);
                        if (draft) {
                            try {
                                await set(storageKey, draft);
                            } catch {
                                // session-only fallback if IDB write fails
                            }
                        }
                    } catch {
                        localStorage.removeItem(storageKey);
                    }
                }
            }

            if (cancelled) return;

            const draftIsStale = typeof draft?.epoch === 'number' && draft.epoch < currentOrderDraftEpoch();
            if (draft && !draftIsStale) {
                populateDraft(draft);
            } else {
                if (draft) {
                    void del(storageKey);
                    localStorage.removeItem(storageKey);
                }
                draftOrderIdRef.current = crypto.randomUUID();
            }
            hydratedIdRef.current = 'new';
            setOrderHydrated(true);
        })();

        return () => { cancelled = true; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [editOrderId, wipOrder?.id, factoryId]);

    useEffect(() => {
        const wipMatches = Boolean(wipOrder) && (!editOrderId || wipOrder.id === editOrderId);
        if (wipMatches) return;
        if (!editOrderId) return;
        const existing = editOrder;
        if (!existing) return;
        if (hydratedIdRef.current === editOrderId) return;

        populateState(existing);
        hydratedIdRef.current = editOrderId;
        setOrderHydrated(true);
        setUnsaved(false);
    // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [editOrderId, editOrder, buyers, wipOrder]);

    useEffect(() => {
        if (!factoryId) return;
        let cancelled = false;
        void (async () => {
            const { data } = await supabase.from('factories').select('code').eq('id', factoryId).maybeSingle();
            if (!cancelled && data?.code) {
                headerDispatch({ type: 'setField', field: 'factoryCode', value: String(data.code) });
            }
        })();
        return () => { cancelled = true; };
    }, [factoryId, headerDispatch]);

    const garmentTypes = useMemo(
        () => dropdownValuesForCategory(supportDropdowns, 'garment_type'),
        [supportDropdowns],
    );
    const merchantNames = useMemo(
        () => dropdownValuesForCategory(supportDropdowns, 'merchant_name'),
        [supportDropdowns],
    );
    const seasons = useMemo(
        () => dropdownValuesForCategory(supportDropdowns, 'season'),
        [supportDropdowns],
    );

    const newOrderHasContent = useMemo(() => {
        if (isEditingExistingOrder) return false;
        return Boolean(
            header.styleName.trim()
            || header.styleRef.trim()
            || header.poNumber.trim()
            || header.selectedBuyer
            || header.sizeGroupSelection
            || header.merchantName.trim()
            || header.season.trim()
            || header.remarks.trim()
            || header.garmentType
            || header.sewingSam.trim()
            || header.styleImage
            || colorway.colorways.length > 0,
        );
    }, [
        isEditingExistingOrder,
        header.styleName,
        header.styleRef,
        header.poNumber,
        header.selectedBuyer,
        header.sizeGroupSelection,
        header.merchantName,
        header.season,
        header.remarks,
        header.garmentType,
        header.sewingSam,
        header.styleImage,
        colorway.colorways.length,
    ]);

    useEffect(() => {
        if (isEditingExistingOrder) return;
        setUnsaved(newOrderHasContent);
    }, [isEditingExistingOrder, newOrderHasContent, setUnsaved]);

    const selectedBuyerObj = useMemo(
        () => buyers.find((b) => b.id === header.selectedBuyer),
        [buyers, header.selectedBuyer],
    );
    const buyerExtraPct = selectedBuyerObj?.overShipmentAllowance || 0;

    const shipModes = useMemo(() => {
        const fromBuyer = selectedBuyerObj?.shipModeOptions?.filter(Boolean) ?? [];
        if (fromBuyer.length > 0) return fromBuyer;
        return dropdownValuesForCategory(supportDropdowns, 'ship_mode');
    }, [selectedBuyerObj, supportDropdowns]);
    const shipmentTypes = useMemo(() => {
        const fromBuyer = selectedBuyerObj?.shipmentTypeOptions?.filter(Boolean) ?? [];
        if (fromBuyer.length > 0) return fromBuyer;
        return dropdownValuesForCategory(supportDropdowns, 'shipment_type');
    }, [selectedBuyerObj, supportDropdowns]);
    const destinationCountries = useMemo(
        () => selectedBuyerObj?.destinationCountries ?? [],
        [selectedBuyerObj],
    );

    const templateGroupId = parseSizeGroupTemplateValue(header.sizeGroupSelection);
    const activeTemplateGroup = useMemo(
        () => (templateGroupId ? sizeGroups.find((sg) => sg.id === templateGroupId) : undefined),
        [sizeGroups, templateGroupId],
    );

    const displaySizes = useMemo(
        () => displaySizesForOrder(colorway.colorways, header.sizeGroupSelection, activeTemplateGroup?.sizes),
        [colorway.colorways, header.sizeGroupSelection, activeTemplateGroup],
    );

    const hasSizeContext = header.sizeGroupSelection === SIZE_GROUP_SNAPSHOT || Boolean(templateGroupId);

    const filteredSizeGroups = useMemo(() => {
        return sizeGroups.filter((sg) =>
            !sg.buyerId || (header.selectedBuyer && sg.buyerId === header.selectedBuyer),
        );
    }, [sizeGroups, header.selectedBuyer]);

    const sizeGroupDropdownOptions = useMemo(
        () =>
            buildSizeGroupDropdownOptions({
                isEditing: isEditingExistingOrder,
                snapshottedName: header.snapshottedGroupName,
                storedSizeKeys: header.snapshottedSizeKeys,
                filteredGroups: filteredSizeGroups,
            }),
        [isEditingExistingOrder, header.snapshottedGroupName, header.snapshottedSizeKeys, filteredSizeGroups],
    );

    const previewInternalNo = useMemo(() => {
        if (isEditingExistingOrder && header.internalOrderNo) return header.internalOrderNo;
        const ready = Boolean(factoryId) && !internalNosLoading && header.factoryCode !== '';
        if (!ready) return '—';
        return previewInternalOrderNo(header.factoryCode, internalOrderNumbers);
    }, [isEditingExistingOrder, header.internalOrderNo, factoryId, internalNosLoading, header.factoryCode, internalOrderNumbers]);

    const totalAllowancePct = header.cuttingAllowance + (header.applyExtraAllowance ? buyerExtraPct : 0);

    const existingOrder = editOrderId ? (editOrder ?? null) : null;
    const wipMatchesEdit = Boolean(wipOrder) && (!editOrderId || wipOrder.id === editOrderId);
    const isOrderLoading = Boolean(editOrderId)
        && !wipMatchesEdit
        && (settingsLoading || editOrderLoading || !orderHydrated || !existingOrder);
    const isOrderMissing = Boolean(editOrderId)
        && !wipMatchesEdit
        && !settingsLoading
        && !editOrderLoading
        && !existingOrder;

    useEffect(() => {
        if (colorway.colorways.length === 0) return;
        if (skipAllowanceRecalcRef.current) {
            skipAllowanceRecalcRef.current = false;
            return;
        }
        colorwayDispatch({ type: 'applyAllowance', totalAllowancePct, displaySizes });
    // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [totalAllowancePct]);

    useEffect(() => {
        if (colorway.colorways.length === 0 && displaySizes.length === 0) return;
        shipmentDispatch({
            type: 'prune',
            colorwayIds: colorway.colorways.map((c) => c.id),
            displaySizes,
        });
    // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [colorway.colorways, displaySizes]);

    useEffect(() => {
        if (!factoryId || editOrderId) return;
        if (isOrderDraftWriteBlocked()) return;
        const epoch = currentOrderDraftEpoch();
        const timeout = setTimeout(() => {
            if (isOrderDraftWriteBlocked()) return;
            if (epoch !== currentOrderDraftEpoch()) return;
            const payload: OrderDraftPayload = {
                id: draftOrderIdRef.current || '',
                header: (({ factoryCode: _, ...rest }) => rest)(header),
                colorways: colorway.colorways,
                shipmentPlan: shipment.plan,
                epoch: currentOrderDraftEpoch(),
            };
            const key = orderDraftStorageKey(factoryId);
            const writeEpoch = currentOrderDraftEpoch();
            void (async () => {
                try {
                    if (isOrderDraftWriteBlocked() || writeEpoch !== currentOrderDraftEpoch()) return;
                    await set(key, payload);
                    if (isOrderDraftWriteBlocked() || writeEpoch !== currentOrderDraftEpoch()) {
                        await del(key);
                        localStorage.removeItem(key);
                    }
                } catch {
                    // session-only fallback if IDB write fails
                }
            })();
        }, 1000);
        return () => clearTimeout(timeout);
    // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [header, colorway.colorways, shipment.plan, factoryId, editOrderId]);

    const handleSizeGroupChange = (value: string) => {
        headerDispatchWithUnsaved({ type: 'setSizeGroup', value });

        if (value === SIZE_GROUP_SNAPSHOT) {
            colorwayDispatchWithUnsaved({ type: 'setColorways', colorways: colorway.savedSnapshot });
            return;
        }

        const nextTemplateId = parseSizeGroupTemplateValue(value);
        if (!nextTemplateId) return;
        const sg = sizeGroups.find((g) => g.id === nextTemplateId);
        if (!sg) return;

        const snapshottedGroupName = !header.snapshottedGroupName ? sg.name : header.snapshottedGroupName;
        headerDispatchWithUnsaved({
            type: 'setSizeGroup',
            value,
            snapshottedGroupName,
            snapshottedSizeKeys: header.snapshottedSizeKeys,
        });

        if (colorway.colorways.length > 0) {
            const templateSizes = (sg.sizes || []).filter(Boolean);
            let updated = mergeTemplateSizesIntoColorways(colorway.colorways, templateSizes);
            const templateSet = new Set(templateSizes);
            for (const size of collectSizeKeysFromColorways(updated)) {
                if (!templateSet.has(size)) {
                    updated = pruneSizeColumnIfAllZero(updated, size);
                }
            }
            updated = pruneOrphanSizesFromTemplate(updated, templateSizes);
            colorwayDispatchWithUnsaved({ type: 'setColorways', colorways: updated });
        }
    };

    const constructOrderObject = (): StyleOrder => {
        const finalShipmentAllowance = header.applyExtraAllowance ? buyerExtraPct : 0;

        const finalColorways = colorway.colorways.map((cw) => {
            const bySize = new Map(cw.sizes.map((s) => [s.size, s]));
            const newSizes = displaySizes.map((label) => {
                const s = bySize.get(label);
                const orderQty = s ? sizeOrderQty(s) : 0;
                const adjQty = s && sizeAdjQty(s) > 0
                    ? sizeAdjQty(s)
                    : Math.round(orderQty * (1 + totalAllowancePct / 100));
                return { size: label, order_qty: orderQty, adj_qty: adjQty };
            });
            const cwOrderQty = sumSizeOrderQty(newSizes);
            const cwAdjQty = sumSizeAdjQty(newSizes);
            return {
                ...cw,
                sizes: newSizes,
                orderQty: cwOrderQty,
                adjQty: cwAdjQty,
                totalQty: cwOrderQty,
            };
        });

        const orderQty = finalColorways.reduce((acc, c) => acc + (c.orderQty || 0), 0);
        const adjQty = finalColorways.reduce((acc, c) => acc + (c.adjQty || 0), 0);

        return {
            id: resolveNewOrderId(),
            styleId: '',
            styleName: header.styleName,
            styleRef: header.styleRef,
            buyer: selectedBuyerObj?.name || '',
            buyerId: header.selectedBuyer,
            poNumber: header.poNumber,
            orderQty,
            adjQty,
            totalQty: orderQty,
            orderDate: header.orderDate,
            season: header.season.trim() || undefined,
            jobCardDate: header.jobCardDate,
            garmentType: header.garmentType,
            sewingSam: header.sewingSam ? Number(header.sewingSam) : null,
            priority: header.priority,
            sizeGroupName: header.snapshottedGroupName || activeTemplateGroup?.name || '',
            sizeLabels: formatSizeLabels(displaySizes),
            currentDept: existingOrder?.currentDept ?? 'Planned',
            status: existingOrder?.status ?? 'Not Started',
            image: header.styleImage,
            colorways: finalColorways,
            remarks: header.remarks,
            orderType: header.orderType,
            merchantName: header.merchantName,
            internalOrderNo: isEditingExistingOrder ? (header.internalOrderNo || undefined) : undefined,
            shipmentPlan: shipment.plan,
            cuttingAllowance: header.cuttingAllowance,
            shipmentAllowance: finalShipmentAllowance,
            sizeGroup: templateGroupId || undefined,
            routingSteps: existingOrder?.routingSteps ?? [],
        };
    };

    const changeStage = (next: OrderWizardStage) => {
        setStage(next);
    };

    const softValidateStyle = (): boolean => {
        if (!header.styleName.trim()) {
            showNotification('Style name is required', 'error');
            return false;
        }
        if (!header.styleRef.trim()) {
            showNotification('Style reference is required', 'error');
            return false;
        }
        if (!header.selectedBuyer) {
            showNotification('Buyer is required', 'error');
            return false;
        }
        if (!hasSizeContext) {
            showNotification('Size group is required', 'error');
            return false;
        }
        if (colorway.colorways.length === 0 || !colorway.colorways.some((c) => c.name.trim())) {
            showNotification('Add at least one colour with a name', 'error');
            return false;
        }
        if (colorway.colorways.every((c) => sumSizeOrderQty(c.sizes) === 0)) {
            showNotification('Enter order quantities for at least one colour', 'error');
            return false;
        }
        return true;
    };

    const validateHeader = async () => {
        const newErrors: Record<string, string> = {};
        if (!header.styleName.trim()) newErrors.styleName = 'Style name is required';
        if (!header.styleRef.trim()) newErrors.styleRef = 'Style reference is required';
        if (!header.selectedBuyer) newErrors.selectedBuyer = 'Buyer is required';
        if (!hasSizeContext) newErrors.selectedSizeGroup = 'Size group is required';

        const poKey = header.poNumber.trim();
        if (poKey && factoryId) {
            try {
                const dup = await findPoNumberConflict(
                    factoryId,
                    poKey,
                    isEditingExistingOrder && editOrderId ? editOrderId : undefined,
                );
                if (dup) {
                    newErrors.poNumber = `PO number already used in order ${dup.internalOrderNo || dup.styleName || dup.id.slice(0, 6)}`;
                }
            } catch {
                newErrors.poNumber = 'Could not verify PO number uniqueness';
            }
        }

        validationDispatch({ type: 'set', errors: newErrors });
        return Object.keys(newErrors).length === 0;
    };

    const handleConfirmOrder = async (options?: { silent?: boolean }): Promise<boolean> => {
        if (saving) return false;
        setFabricWarnings([]);
        if (!(await validateHeader())) {
            showNotification('Please fill in all required fields highlighted in red.', 'error');
            return false;
        }
        if (colorway.colorways.length === 0) {
            showNotification('Add at least one color with quantities before saving.', 'error');
            return false;
        }
        const emptyColor = colorway.colorways.find((c) => !c.name.trim());
        if (emptyColor) {
            showNotification('All color rows must have a name.', 'error');
            return false;
        }
        const seenNames = new Set<string>();
        for (const cw of colorway.colorways) {
            const key = cw.name.trim().toLowerCase();
            if (seenNames.has(key)) {
                showNotification(`Duplicate color name "${cw.name.trim()}" — each color must be unique.`, 'error');
                return false;
            }
            seenNames.add(key);
        }
        const zeroQty = colorway.colorways.every((c) => sumSizeOrderQty(c.sizes) === 0);
        if (zeroQty) {
            showNotification('Enter quantities in the size breakdown.', 'error');
            return false;
        }

        const orderForValidation = constructOrderObject();
        const shipmentQtyError = validateShipmentPlanQty(
            shipment.plan,
            orderForValidation.colorways,
            displaySizes,
        );
        if (shipmentQtyError) {
            showNotification(shipmentQtyError, 'error');
            return false;
        }

        if (factoryId) {
            const colorConflict = await findOrderColorConflictDb(
                factoryId,
                header.styleName,
                header.poNumber,
                colorway.colorways,
                isEditingExistingOrder ? editOrderId ?? undefined : undefined,
            );
            if (colorConflict) {
                showNotification(colorConflict, 'error');
                return false;
            }
        }

        // Material module — plan fabrics must have a SKU picked
        if (materialOn) {
            const planFabrics = (colorway.materialPlan ?? []).filter((p) => p.kind === 'Fabric');
            for (let i = 0; i < planFabrics.length; i++) {
                if (!planFabrics[i].fabricId) {
                    showNotification(`Fabric line ${i + 1}: pick a fabric`, 'error');
                    changeStage('materials');
                    styleFabricsRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' });
                    return false;
                }
            }
            const legacyGroups = groupLegacyFabricLines(colorway.colorways);
            const legacyCount = legacyGroups.reduce((n, g) => n + g.colorwayNames.length, 0);
            setFabricWarnings(
                legacyCount > 0
                    ? [
                        `${legacyCount} legacy fabric row${legacyCount === 1 ? '' : 's'} not linked to the fabric master`,
                      ]
                    : [],
            );
        } else {
            setFabricWarnings([]);
        }

        setSaving(true);
        try {
            const finalOrder = orderForValidation;
            const saved = isEditingExistingOrder
                ? await updateOrder(editOrderId, finalOrder)
                : await addOrder(finalOrder);
            if (!saved) return false;
            const newOrderId = isEditingExistingOrder ? editOrderId : finalOrder.id;

            // Reload from DB so reqQty reflects server-computed total_cons
            let colorwaysForHydrate = finalOrder.colorways;
            if (factoryId && newOrderId) {
                try {
                    const reloaded = await reloadOrderFromDb(factoryId, newOrderId);
                    if (reloaded) colorwaysForHydrate = reloaded.colorways;
                } catch {
                    // Non-critical: keep draft colorways
                }
            }

            colorwayDispatch({
                type: 'hydrate',
                colorways: colorwaysForHydrate,
                selectedColorId: colorway.selectedColorId,
                snapshot: colorwaysForHydrate,
            });
            headerDispatch({
                type: 'setSizeGroup',
                value: isEditingExistingOrder ? SIZE_GROUP_SNAPSHOT : header.sizeGroupSelection,
                snapshottedGroupName: finalOrder.sizeGroupName || '',
                snapshottedSizeKeys: [...displaySizes],
            });

            setUnsaved(false);
            setWipOrder(null);
            clearDraft();
            setSavedOrderId(newOrderId);

            if (!isEditingExistingOrder) {
                resetForm();
            } else {
                showNotification('Order updated successfully', 'success');
                if (!options?.silent && newOrderId) {
                    navigate(RoutePath.STYLE_DETAILS, { id: newOrderId });
                }
            }
            if (!options?.silent && !isEditingExistingOrder) {
                setSuccessModalOpen(true);
            }
            return true;
        } catch (error) {
            if (error instanceof Error && error.message.startsWith('LINE_MISMATCH:')) {
                showNotification(
                    'A fabric line differs between colours. Edit it from Style Fabrics.',
                    'error',
                );
                changeStage('materials');
                styleFabricsRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' });
            } else {
                showNotification('Failed to save order. Please try again.', 'error');
            }
            return false;
        } finally {
            setSaving(false);
        }
    };

    handleConfirmOrderRef.current = handleConfirmOrder;

    const resetForm = () => {
        headerDispatch({ type: 'reset' });
        colorwayDispatch({ type: 'reset' });
        shipmentDispatch({ type: 'reset' });
        validationDispatch({ type: 'reset' });
        draftOrderIdRef.current = null;
        hydratedIdRef.current = editOrderId ? hydratedIdRef.current : 'new';
        setUnsaved(false);
        setWipOrder(null);
        void clearOrderDraft(useNavigationStore.getState().factoryId);
    };

    useEffect(() => {
        setPendingSaveAction(async () => {
            return handleConfirmOrderRef.current({ silent: true });
        });
        setPendingDiscardAction(() => {
            markOrderDraftDiscarded(useNavigationStore.getState().factoryId);
            resetForm();
        });
        return () => {
            setPendingSaveAction(null);
            setPendingDiscardAction(null);
        };
    }, [setPendingSaveAction, setPendingDiscardAction]);

    const performCancel = () => {
        resetForm();
        if (isEditingExistingOrder && editOrderId) {
            navigate(RoutePath.STYLE_DETAILS, { id: editOrderId });
        } else {
            showNotification('Order form cleared', 'success');
        }
    };

    const handleCancel = () => {
        if (isUnsaved) {
            setShowDiscardDialog(true);
            return;
        }
        performCancel();
    };

    const cancelDiscardDialog = () => {
        setShowDiscardDialog(false);
    };

    const confirmDiscardCancel = () => {
        setShowDiscardDialog(false);
        markOrderDraftDiscarded(useNavigationStore.getState().factoryId);
        setWipOrder(null);
        performCancel();
    };

    const confirmSaveAndCloseCancel = async () => {
        const saved = await handleConfirmOrder();
        if (saved) {
            setShowDiscardDialog(false);
            if (isEditingExistingOrder && editOrderId) {
                navigate(RoutePath.STYLE_DETAILS, { id: editOrderId });
            }
        }
    };

    const handleDeleteOrder = async () => {
        if (!editOrderId) return;
        setDeleteLoading(true);
        try {
            await deleteOrder(editOrderId);
            setDeleteModalOpen(false);
            setUnsaved(false);
            resetForm();
            navigate(RoutePath.STATUS_TRACKER);
        } catch (error) {
            const message = error instanceof Error ? error.message : 'Failed to delete order';
            showNotification(message, 'error');
        } finally {
            setDeleteLoading(false);
        }
    };

    const handleGoToPlanning = () => {
        setSuccessModalOpen(false);
        if (savedOrderId) {
            const firstColor = colorway.colorways[0]?.name;
            navigate(
                RoutePath.PLANNING_DETAIL,
                firstColor
                    ? { orderId: savedOrderId, color: firstColor }
                    : { orderId: savedOrderId },
            );
        }
    };

    const handleSuccessRedirect = () => {
        setSuccessModalOpen(false);
        if (savedOrderId) {
            navigate(RoutePath.STYLE_DETAILS, { id: savedOrderId });
        } else {
            navigate(RoutePath.STATUS_TRACKER);
        }
    };

    const handleCreateAnother = () => {
        setSuccessModalOpen(false);
        resetForm();
        setSavedOrderId(null);
        navigate(RoutePath.CREATE_ORDER);
    };

    const aggregateSizeData = useMemo(() => {
        const sizes = displaySizes;
        const data: Record<string, { order: number; adjusted: number }> = {};
        sizes.forEach((s) => { data[s] = { order: 0, adjusted: 0 }; });
        colorway.colorways.forEach((cw) => {
            cw.sizes.forEach((s) => {
                if (!data[s.size]) data[s.size] = { order: 0, adjusted: 0 };
                data[s.size].order += sizeOrderQty(s);
                data[s.size].adjusted += sizeAdjQty(s);
            });
        });
        return { data, sizes };
    }, [colorway.colorways, displaySizes]);

    const totalOrderQty = Object.values(aggregateSizeData.data).reduce((a, b) => a + b.order, 0);
    const totalAdjustedQty = Object.values(aggregateSizeData.data).reduce((a, b) => a + b.adjusted, 0);

    const overallLeadDays = useMemo(
        () => daysBetween(header.orderDate, primaryShipmentDate(shipment.plan)),
        [header.orderDate, shipment.plan],
    );
    const productionLeadDays = useMemo(
        () => daysBetween(header.jobCardDate, primaryShipmentDate(shipment.plan)),
        [header.jobCardDate, shipment.plan],
    );

    const shipmentPlanTotal = useMemo(() => planTotalQty(shipment.plan), [shipment.plan]);
    const shipmentBalance = useMemo(
        () => planBalanceTotal(shipment.plan, colorway.colorways, displaySizes),
        [shipment.plan, colorway.colorways, displaySizes],
    );

    // ── shared summary card content (rendered inside every stage footer) ────────
    const completedStages = useMemo(() => {
        const done = new Set<OrderWizardStage>();
        if (isStyleStepFilled({
            styleName: header.styleName,
            styleRef: header.styleRef,
            buyerId: header.selectedBuyer,
            hasSizeContext,
            colorways: colorway.colorways.map((c) => ({
                name: c.name,
                orderQty: sumSizeOrderQty(c.sizes),
            })),
        })) done.add('style');
        if (isMaterialsStepFilled(colorway.materialPlan ?? [])) done.add('materials');
        if (isShipmentsStepFilled(shipment.plan.lines.map((line) => ({
            active: isActiveShipmentLine(line),
            shipmentDate: line.shipmentDate,
            qty: rowTotal(line),
        })))) done.add('shipments');
        return done;
    }, [
        header.styleName,
        header.styleRef,
        header.selectedBuyer,
        hasSizeContext,
        colorway.colorways,
        colorway.materialPlan,
        shipment.plan.lines,
    ]);

    const summarySubtitle =
        colorway.colorways.length > 0 && totalOrderQty > 0
            ? `${colorway.colorways.length} color${colorway.colorways.length !== 1 ? 's' : ''} · ${totalOrderQty.toLocaleString()} pcs order · ${totalAdjustedQty.toLocaleString()} pcs adjusted`
            : 'Complete style details and add colours to continue';

    const summaryAction = (
        <span className={`inline-flex items-center gap-1.5 px-3 py-1 rounded-full text-[10px] font-bold border ${
            colorway.colorways.length > 0 && totalOrderQty > 0
                ? 'bg-emerald-50 text-emerald-700 border-emerald-200'
                : 'bg-amber-50 text-amber-700 border-amber-200'
        }`}>
            <span className={`w-1.5 h-1.5 rounded-full ${colorway.colorways.length > 0 && totalOrderQty > 0 ? 'bg-emerald-500' : 'bg-amber-400'}`} />
            {colorway.colorways.length > 0 && totalOrderQty > 0 ? 'Ready to save' : 'Incomplete'}
        </span>
    );

    const summarySharedContent = (
        <>
            <div className="grid grid-cols-[repeat(6,minmax(0,1fr))] gap-3 pb-4 border-b border-slate-100 min-w-0">
                <div className="rounded-lg bg-slate-50 border border-slate-200 px-3 py-2 flex flex-col gap-0.5 min-w-0">
                    <span className="text-[9px] font-bold uppercase tracking-wide text-slate-400">Job no.</span>
                    <span className="text-[1.05rem] font-extrabold text-slate-900 leading-tight truncate">{previewInternalNo || '—'}</span>
                    <span className="text-[9px] text-slate-400 truncate">{header.styleName || 'New order'}</span>
                </div>
                <div className="rounded-lg bg-slate-50 border border-slate-200 px-3 py-2 flex flex-col gap-0.5 min-w-0">
                    <span className="text-[9px] font-bold uppercase tracking-wide text-slate-400">Order Qty</span>
                    <span className="text-[1.05rem] font-extrabold tabular-nums text-slate-900 leading-tight">{totalOrderQty.toLocaleString()} <span className="text-[10px] font-semibold text-slate-400">pcs</span></span>
                    <span className="text-[9px] text-slate-400">{colorway.colorways.length} color{colorway.colorways.length !== 1 ? 's' : ''} · {displaySizes.length} sizes</span>
                </div>
                <div className="rounded-lg bg-blue-50 border border-blue-100 px-3 py-2 flex flex-col gap-0.5 min-w-0">
                    <span className="text-[9px] font-bold uppercase tracking-wide text-blue-500">Adjusted Qty</span>
                    <span className="text-[1.05rem] font-extrabold tabular-nums text-blue-900 leading-tight">{totalAdjustedQty.toLocaleString()} <span className="text-[10px] font-semibold text-blue-400">pcs</span></span>
                    <span className="text-[9px] text-blue-400 truncate">
                        {totalAllowancePct === 0
                            ? 'No allowance'
                            : [
                                header.cuttingAllowance > 0 ? `Cut ${header.cuttingAllowance}%` : null,
                                header.applyExtraAllowance && buyerExtraPct > 0 ? `Ship +${buyerExtraPct}%` : null,
                              ].filter(Boolean).join(' · ')}
                    </span>
                </div>
                <div className="rounded-lg bg-violet-50 border border-violet-100 px-3 py-2 flex flex-col gap-0.5 min-w-0">
                    <span className="text-[9px] font-bold uppercase tracking-wide text-violet-500">Lead Days</span>
                    <span className="text-[1.05rem] font-extrabold tabular-nums text-violet-900 leading-tight">
                        {productionLeadDays != null ? productionLeadDays : '—'}
                        <span className="text-[10px] font-semibold text-violet-400"> days</span>
                    </span>
                    <span className="text-[9px] text-violet-400 truncate">
                        {overallLeadDays != null ? `${overallLeadDays}d order→ship` : 'No shipment date'}
                    </span>
                </div>
                <div className="rounded-lg bg-slate-50 border border-slate-200 px-3 py-2 flex flex-col gap-0.5 min-w-0">
                    <span className="text-[9px] font-bold uppercase tracking-wide text-slate-500">Shipment Plan Total</span>
                    <span className="text-[1.05rem] font-extrabold tabular-nums text-slate-900 leading-tight">
                        {shipmentPlanTotal.toLocaleString()} <span className="text-[10px] font-semibold text-slate-400">pcs</span>
                    </span>
                    <span className="text-[9px] text-slate-400">
                        {shipment.plan.lines.length} line{shipment.plan.lines.length !== 1 ? 's' : ''}
                    </span>
                </div>
                <div className="rounded-lg bg-amber-50 border border-amber-100 px-3 py-2 flex flex-col gap-0.5 min-w-0">
                    <span className="text-[9px] font-bold uppercase tracking-wide text-amber-600">Shipment Balance</span>
                    <span className="text-[1.05rem] font-extrabold tabular-nums text-amber-900 leading-tight">
                        {shipmentBalance.toLocaleString()} <span className="text-[10px] font-semibold text-amber-500">pcs</span>
                    </span>
                    <span className="text-[9px] text-amber-600 truncate">Not yet in plan</span>
                </div>
            </div>

            {(() => {
                const today = new Date(); today.setHours(0,0,0,0);
                const msPerDay = 86400000;
                type Milestone = {
                    label: string;
                    sublabel?: string;
                    date: string;
                    color: 'slate' | 'blue' | 'violet' | 'amber' | 'grey';
                    rescheduled?: boolean;
                };
                const milestones: Milestone[] = [];
                if (header.orderDate) milestones.push({ label: 'Order', sublabel: formatDateDDMMYYYY(header.orderDate), date: header.orderDate, color: 'slate' });
                if (header.jobCardDate) milestones.push({ label: 'Job Card', sublabel: formatDateDDMMYYYY(header.jobCardDate), date: header.jobCardDate, color: 'violet' });

                const activeShipDates = [...new Set(
                    shipment.plan.lines
                        .filter(isActiveShipmentLine)
                        .map((l) => l.shipmentDate)
                        .filter(Boolean),
                )].sort();
                const lastActiveDate = activeShipDates.at(-1) ?? '';

                const shipDateMap = new Map<string, { activeQty: number; rescheduledQty: number }>();
                for (const line of expandShipmentPlanLines(shipment.plan.lines)) {
                    if (!line.shipmentDate) continue;
                    const entry = shipDateMap.get(line.shipmentDate) ?? { activeQty: 0, rescheduledQty: 0 };
                    const qty = rowTotal(line);
                    if (isActiveShipmentLine(line)) entry.activeQty += qty;
                    else if (line.status === 'rescheduled') entry.rescheduledQty += qty;
                    shipDateMap.set(line.shipmentDate, entry);
                }

                let activeShipIdx = 0;
                for (const d of [...shipDateMap.keys()].sort()) {
                    const { activeQty, rescheduledQty } = shipDateMap.get(d)!;
                    if (activeQty > 0) {
                        activeShipIdx += 1;
                        milestones.push({
                            label: d === lastActiveDate ? 'Ex-Factory' : `Shipment ${activeShipIdx}`,
                            sublabel: `${formatDateDDMMYYYY(d)}${activeQty > 0 ? ` · ${activeQty.toLocaleString()} pcs` : ''}`,
                            date: d,
                            color: d === lastActiveDate ? 'blue' : 'amber',
                        });
                    }
                    if (rescheduledQty > 0) {
                        milestones.push({
                            label: 'Rescheduled',
                            sublabel: `${formatDateDDMMYYYY(d)} · ${rescheduledQty.toLocaleString()} pcs`,
                            date: d,
                            color: 'grey',
                            rescheduled: true,
                        });
                    }
                }

                if (milestones.length < 2) return (
                    <div className="py-4 text-[10px] text-slate-400 italic text-center">
                        Set order date and add shipment lines to see the timeline
                    </div>
                );

                const nodeColors: Record<Milestone['color'], { dot: string; label: string; sub: string; connector: string }> = {
                    slate:  { dot: 'bg-slate-400 ring-slate-200',  label: 'text-slate-600', sub: 'text-slate-400', connector: 'bg-slate-200' },
                    violet: { dot: 'bg-violet-500 ring-violet-200', label: 'text-violet-700', sub: 'text-slate-400', connector: 'bg-slate-200' },
                    amber:  { dot: 'bg-amber-400 ring-amber-200',  label: 'text-amber-700',  sub: 'text-slate-400', connector: 'bg-amber-100' },
                    blue:   { dot: 'bg-blue-500 ring-blue-200',    label: 'text-blue-700',  sub: 'text-slate-400', connector: 'bg-blue-100' },
                    grey:   { dot: 'bg-slate-300 ring-slate-100',  label: 'text-slate-400', sub: 'text-slate-400', connector: 'bg-slate-100' },
                };

                return (
                    <div className="pt-4 w-full">
                        <div className="flex items-start w-full">
                            {milestones.map((m, idx) => {
                                const isLast = idx === milestones.length - 1;
                                const c = nodeColors[m.color];
                                const mDate = new Date(m.date); mDate.setHours(0,0,0,0);
                                const daysLeft = Math.round((mDate.getTime() - today.getTime()) / msPerDay);
                                const spanDays = isLast ? 0 : (() => {
                                    const next = new Date(milestones[idx+1].date); next.setHours(0,0,0,0);
                                    return Math.max(1, Math.round((next.getTime() - mDate.getTime()) / msPerDay));
                                })();
                                return (
                                    <div key={`${m.date}-${m.label}-${idx}`} className={`flex items-start ${isLast ? '' : 'flex-1'}`}>
                                        <div className={`flex flex-col items-start w-full ${m.rescheduled ? 'opacity-60' : ''}`}>
                                            <div className="flex items-center w-full">
                                                <div className={`w-3 h-3 rounded-full ring-2 ring-offset-1 shrink-0 ${c.dot}`} />
                                                {!isLast && (
                                                    <div className="flex-1 flex flex-col justify-center min-w-0 mx-1">
                                                        <div className={`h-0.5 w-full ${c.connector}`} />
                                                        <span className="text-[8px] text-slate-400 tabular-nums text-center mt-0.5">{spanDays}d</span>
                                                    </div>
                                                )}
                                            </div>
                                            <div className="mt-1.5 text-left" style={{ maxWidth: '7rem' }}>
                                                <p className={`text-[9px] font-bold uppercase tracking-wide ${c.label}`}>{m.label}</p>
                                                <p className={`text-[9px] ${c.sub} mt-0.5`}>{m.sublabel}</p>
                                                {daysLeft >= 0
                                                    ? <p className={`text-[8px] font-semibold mt-0.5 ${daysLeft <= 7 ? 'text-red-500' : daysLeft <= 21 ? 'text-amber-600' : 'text-slate-400'}`}>{daysLeft === 0 ? 'Today' : `${daysLeft}d left`}</p>
                                                    : <p className="text-[8px] font-semibold mt-0.5 text-slate-300">{Math.abs(daysLeft)}d ago</p>
                                                }
                                            </div>
                                        </div>
                                    </div>
                                );
                            })}
                        </div>
                    </div>
                );
            })()}

            <div className="border-t border-slate-100 mt-4" />

            {fabricWarnings.length > 0 && (
                <div className="pt-4">
                    <OrderValidationSummary errors={{}} warnings={fabricWarnings} />
                </div>
            )}
        </>
    );

    return (
        <PageShell className="w-full pb-20">
            {isOrderLoading && <OrderMasterDetailSkeleton />}

            {isOrderMissing && (
                <div className="rounded-xl border border-amber-200 bg-amber-50 px-4 py-6 text-center text-sm text-amber-900 mb-6">
                    Order not found. It may have been deleted.
                    <div className="mt-3">
                        <Button size="sm" variant="secondary" onClick={() => navigate(RoutePath.STATUS_TRACKER)}>
                            Back to Status Tracker
                        </Button>
                    </div>
                </div>
            )}

            {!isOrderMissing && !isOrderLoading && (
            <div className={`grid grid-cols-12 gap-6 [&_input]:shadow-none [&_input]:text-[11px] [&_input]:py-1.5 [&_button[role=combobox]]:text-[11px] [&_label]:text-[11px] ${saving ? 'opacity-60 pointer-events-none' : ''}`}>

                {/* ── STYLE stage ─────────────────────────────────────── */}
                {stage === 'style' && (
                    <>
                        <OrderHeaderSection
                            headerState={header}
                            headerDispatch={headerDispatchWithUnsaved}
                            errors={errors}
                            buyers={buyers}
                            sizeGroupDropdownOptions={sizeGroupDropdownOptions}
                            garmentTypes={garmentTypes}
                            merchantNames={merchantNames}
                            seasons={seasons}
                            previewInternalNo={previewInternalNo}
                            onSizeGroupChange={handleSizeGroupChange}
                        />

                        <ColorwayWorkspaceSection
                            colorwayState={colorway}
                            colorwayDispatch={colorwayDispatchWithUnsaved}
                            displaySizes={displaySizes}
                            totalAllowancePct={totalAllowancePct}
                            hasSizeContext={hasSizeContext}
                            headerState={header}
                            buyerExtraPct={buyerExtraPct}
                        />

                        <OrderWizardFooter
                            stage={stage}
                            completed={completedStages}
                            onSelectStage={changeStage}
                            showBack={false}
                            nextLabel="Next"
                            onNext={() => { if (softValidateStyle()) changeStage('materials'); }}
                            summaryTitle="Order Summary"
                            summarySubtitle={summarySubtitle}
                            summaryAction={summaryAction}
                        >
                            {summarySharedContent}
                        </OrderWizardFooter>
                    </>
                )}

                {/* ── MATERIALS stage ──────────────────────────────────── */}
                {stage === 'materials' && (
                    <>
                        <MaterialsStageSection
                            colorwayState={colorway}
                            colorwayDispatch={colorwayDispatchWithUnsaved}
                            styleFabricsRef={styleFabricsRef}
                        />

                        <OrderWizardFooter
                            stage={stage}
                            completed={completedStages}
                            onSelectStage={changeStage}
                            showBack={true}
                            onBack={() => changeStage('style')}
                            nextLabel="Next"
                            onNext={() => changeStage('shipments')}
                            summaryTitle="Order Summary"
                            summarySubtitle={summarySubtitle}
                            summaryAction={summaryAction}
                        >
                            {summarySharedContent}
                        </OrderWizardFooter>
                    </>
                )}

                {/* ── SHIPMENTS stage ──────────────────────────────────── */}
                {stage === 'shipments' && (
                    <>
                        <ShipmentPlanSection
                            shipmentState={shipment}
                            shipmentDispatch={shipmentDispatchWithUnsaved}
                            shipmentPlanRef={shipmentPlanRef}
                            colorways={colorway.colorways}
                            displaySizes={displaySizes}
                            shipModes={shipModes}
                            shipmentTypes={shipmentTypes}
                            destinationCountries={destinationCountries}
                            jobCardDate={header.jobCardDate || undefined}
                            disabled={!hasSizeContext}
                            requireDateChangeReason={isEditingExistingOrder}
                        />

                        <OrderWizardFooter
                            stage={stage}
                            completed={completedStages}
                            onSelectStage={changeStage}
                            showBack={true}
                            onBack={() => changeStage('materials')}
                            nextLabel="Next"
                            onNext={() => changeStage('review')}
                            summaryTitle="Order Summary"
                            summarySubtitle={summarySubtitle}
                            summaryAction={summaryAction}
                        >
                            {summarySharedContent}
                        </OrderWizardFooter>
                    </>
                )}

                {/* ── REVIEW stage ─────────────────────────────────────── */}
                {stage === 'review' && (
                    <>
                        <div className="col-span-12">
                            <OrderReviewSummary
                                header={header}
                                buyerName={selectedBuyerObj?.name || ''}
                                colorways={colorway.colorways}
                                materialPlan={colorway.materialPlan ?? []}
                                shipmentPlan={shipment.plan}
                                displaySizes={displaySizes}
                                totalAllowancePct={totalAllowancePct}
                                buyerExtraPct={buyerExtraPct}
                            />
                        </div>

                        <OrderWizardFooter
                            stage={stage}
                            completed={completedStages}
                            onSelectStage={changeStage}
                            showBack={true}
                            onBack={() => changeStage('shipments')}
                            onDiscard={handleCancel}
                            nextLabel={saving ? 'Saving…' : isEditingExistingOrder ? 'Edit Order' : 'Create Order'}
                            onNext={() => void handleConfirmOrder()}
                            nextDisabled={saving}
                            gateNext
                            summaryTitle="Order Summary"
                            summarySubtitle={summarySubtitle}
                            summaryAction={summaryAction}
                        >
                            {summarySharedContent}
                            {isEditingExistingOrder ? (
                                <div className="flex items-center pt-4">
                                    <DesktopWriteGate>
                                        <Button
                                            variant="danger-light"
                                            icon={Trash2}
                                            onClick={() => setDeleteModalOpen(true)}
                                            className="text-[10px]"
                                        >
                                            Delete Order
                                        </Button>
                                    </DesktopWriteGate>
                                </div>
                            ) : null}
                        </OrderWizardFooter>
                    </>
                )}

                <Modal isOpen={deleteModalOpen} onClose={() => !deleteLoading && setDeleteModalOpen(false)}>
                    <div className="p-6">
                        <div className="flex items-start gap-4">
                            <div className="w-12 h-12 rounded-full bg-red-50 text-red-600 flex items-center justify-center shrink-0">
                                <AlertTriangle size={24} />
                            </div>
                            <div className="flex-1 min-w-0">
                                <h3 className="text-sm font-bold text-slate-900 mb-1">Delete this order?</h3>
                                <p className="text-[11px] text-slate-600 leading-relaxed">
                                    <span className="font-semibold text-slate-800">{header.styleName || 'This order'}</span>
                                    {header.poNumber ? ` · PO ${header.poNumber}` : ''} will be permanently removed.
                                </p>
                                <ul className="mt-3 text-[11px] text-slate-500 space-y-1 list-disc pl-4">
                                    <li>All colorways and size breakdowns for this order</li>
                                    <li>Line allocations linked to those colorways</li>
                                    <li>This cannot be undone</li>
                                </ul>
                                <p className="mt-3 text-[10px] text-amber-700 bg-amber-50 border border-amber-100 rounded-lg px-3 py-2">
                                    If floor teams have logged output, handovers, or shipments against this order, deletion may be blocked until that data is cleared.
                                </p>
                            </div>
                        </div>
                        <div className="flex justify-end gap-3 mt-6 pt-4 border-t border-slate-100">
                            <Button
                                variant="secondary"
                                onClick={() => setDeleteModalOpen(false)}
                                disabled={deleteLoading}
                            >
                                Cancel
                            </Button>
                            <DesktopWriteGate>
                            <Button
                                variant="danger"
                                icon={Trash2}
                                onClick={handleDeleteOrder}
                                disabled={deleteLoading}
                            >
                                {deleteLoading ? 'Deleting…' : 'Delete Order'}
                            </Button>
                            </DesktopWriteGate>
                        </div>
                    </div>
                </Modal>

                <Modal isOpen={successModalOpen} onClose={handleSuccessRedirect}>
                    <div className="p-6 text-center">
                        <div className="w-16 h-16 bg-emerald-100 text-emerald-600 rounded-full flex items-center justify-center mx-auto mb-4 shadow-sm">
                            <CheckCircle2 size={32} />
                        </div>
                        <h3 className="text-[10px] font-bold text-slate-900 mb-2">Success!</h3>
                        <p className="text-slate-500 mb-6">
                            Order has been {isEditingExistingOrder ? 'updated' : 'created'} successfully.
                        </p>
                        <div className="flex flex-col gap-3">
                            <Button onClick={handleGoToPlanning} className="w-full justify-center">
                                Go to Planning
                            </Button>
                            <Button variant="secondary" onClick={handleSuccessRedirect} className="w-full justify-center">
                                View Style Details
                            </Button>
                            <Button variant="secondary" onClick={handleCreateAnother} className="w-full justify-center bg-slate-50 border-slate-200 text-slate-600 hover:bg-slate-100">
                                Create Another Order
                            </Button>
                        </div>
                    </div>
                </Modal>

                <UnsavedChangesModal
                    isOpen={showDiscardDialog}
                    onClose={cancelDiscardDialog}
                    onSave={confirmSaveAndCloseCancel}
                    onDiscard={confirmDiscardCancel}
                    discardLabel={isEditingExistingOrder ? 'Discard & Leave' : 'Discard & Clear'}
                    saving={saving}
                />

            </div>
            )}
        </PageShell>
    );
};
