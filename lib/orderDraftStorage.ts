import { del } from 'idb-keyval';

export const orderDraftStorageKey = (factoryId: string) => `prodigi:draft-order:${factoryId}`;

const discardFlagKey = (factoryId: string) => `prodigi:draft-order-discarded:${factoryId}`;
const GLOBAL_DISCARD_FLAG = 'prodigi:draft-order-discarded';

let draftWritesBlocked = false;
let draftEpoch = 0;
let skipIdbHydrate = false;

export function currentOrderDraftEpoch() {
  return draftEpoch;
}

export function bumpOrderDraftEpoch() {
  draftEpoch += 1;
}

export function blockOrderDraftWrites() {
  draftWritesBlocked = true;
  bumpOrderDraftEpoch();
}

export function allowOrderDraftWrites() {
  draftWritesBlocked = false;
}

export function isOrderDraftWriteBlocked() {
  return draftWritesBlocked;
}

function persistDiscardFlag(factoryId: string | null | undefined) {
  sessionStorage.setItem(GLOBAL_DISCARD_FLAG, '1');
  if (factoryId) {
    sessionStorage.setItem(discardFlagKey(factoryId), '1');
  }
}

export function consumeOrderDraftDiscarded(factoryId: string | null | undefined) {
  sessionStorage.removeItem(GLOBAL_DISCARD_FLAG);
  if (factoryId) sessionStorage.removeItem(discardFlagKey(factoryId));
}

export function isOrderDraftDiscarded(factoryId: string | null | undefined): boolean {
  if (sessionStorage.getItem(GLOBAL_DISCARD_FLAG) === '1') return true;
  if (factoryId && sessionStorage.getItem(discardFlagKey(factoryId)) === '1') return true;
  return false;
}

export function shouldSkipOrderDraftHydrate(factoryId: string | null | undefined): boolean {
  return skipIdbHydrate || isOrderDraftDiscarded(factoryId);
}

export async function clearOrderDraft(factoryId: string | null | undefined) {
  bumpOrderDraftEpoch();
  if (!factoryId) return;
  const key = orderDraftStorageKey(factoryId);
  try {
    await del(key);
  } catch {
    // ignore
  }
  localStorage.removeItem(key);
}

export function markOrderDraftDiscarded(factoryId: string | null | undefined) {
  skipIdbHydrate = true;
  blockOrderDraftWrites();
  persistDiscardFlag(factoryId);
  void clearOrderDraft(factoryId).then(() => {
    skipIdbHydrate = false;
    consumeOrderDraftDiscarded(factoryId);
  });
}
