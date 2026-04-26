/**
 * @file store/index.js
 * @description Barrel re-export for Pinia stores and store initialisation helpers.
 *
 * The store implementations were split into dedicated modules (Step 6 of the
 * architecture refactoring):
 *  - store/configStore.js   → useConfigStore
 *  - store/orderStore.js    → useOrderStore
 *
 * This file exists for backwards-compatibility so that all existing
 * `import ... from './store/index.js'` paths continue to work without modification.
 */

import { KEYBOARD_POSITIONS, updateOrderTotals } from '../utils/index.js';
import { mapOrderFromDirectus } from '../utils/mappers.js';
import { loadStateFromIDB } from './persistence/operations.js';
import { loadSettingsFromIDB } from './persistence/settings.js';
import { useConfigStore } from './configStore.js';
import { useOrderStore } from './orderStore.js';

export { useConfigStore } from './configStore.js';
export { useOrderStore } from './orderStore.js';

// ── Backward-compat merged proxy ─────────────────────────────────────────────

function _createMergedStoreProxy(configStore, orderStore) {
  const sources = [orderStore, configStore];
  return new Proxy({}, {
    get(_target, prop) {
      for (const source of sources) {
        if (prop in source) {
          const value = source[prop];
          return typeof value === 'function' ? value.bind(source) : value;
        }
      }
      return undefined;
    },
    set(_target, prop, value) {
      for (const source of sources) {
        if (prop in source) {
          source[prop] = value;
          return true;
        }
      }
      configStore[prop] = value;
      return true;
    },
    has(_target, prop) {
      return sources.some(source => prop in source);
    },
    ownKeys() {
      return [...new Set(sources.flatMap(source => Reflect.ownKeys(source)))];
    },
    getOwnPropertyDescriptor() {
      return { enumerable: true, configurable: true };
    },
  });
}

export function useAppStore(pinia) {
  /**
   * Backward-compatibility facade that merges the new layered stores.
   * Prefer `useConfigStore()` and `useOrderStore()` in new code.
   */
  const configStore = useConfigStore(pinia);
  const orderStore = useOrderStore(pinia);
  return _createMergedStoreProxy(configStore, orderStore);
}

export async function initStoreFromIDB(pinia) {
  const configStore = useConfigStore(pinia);
  const orderStore = useOrderStore(pinia);

  const [idbState, settings] = await Promise.all([
    loadStateFromIDB(),
    loadSettingsFromIDB(),
  ]);

  let startupMenuSource = configStore.menuSource;
  let startupMenuUrl = configStore.menuUrl;

  if (settings) {
    if (typeof settings.sounds === 'boolean') configStore.sounds = settings.sounds;
    if (typeof settings.menuUrl === 'string' && settings.menuUrl.trim() !== '') {
      configStore.menuUrl = settings.menuUrl;
      startupMenuUrl = settings.menuUrl;
    }
    if (settings.menuSource === 'json' || settings.menuSource === 'directus') {
      configStore.menuSource = settings.menuSource;
      startupMenuSource = settings.menuSource;
    }
    if (typeof settings.preventScreenLock === 'boolean') configStore.preventScreenLock = settings.preventScreenLock;
    if (KEYBOARD_POSITIONS.includes(settings.customKeyboard)) configStore.customKeyboard = settings.customKeyboard;
    if (typeof settings.preBillPrinterId === 'string') configStore.preBillPrinterId = settings.preBillPrinterId;
  }

  await configStore.hydrateConfigFromIDB({
    menuSource: startupMenuSource,
    menuUrl: startupMenuUrl,
  });

  if (idbState) {
    orderStore.orders = (idbState.orders ?? []).map((order) => {
      const mapped = mapOrderFromDirectus(order);
      if (mapped.globalNote === undefined) mapped.globalNote = '';
      if (!mapped.noteVisibility) mapped.noteVisibility = { cassa: true, sala: true, cucina: true };
      const hasPopulatedOrderItems = Array.isArray(mapped.orderItems) && mapped.orderItems.length > 0;
      if (hasPopulatedOrderItems || mapped.item_count === 0) {
        updateOrderTotals(mapped);
        mapped.total_amount = mapped.totalAmount;
        mapped.item_count = mapped.itemCount;
      }
      return mapped;
    });
    orderStore.transactions = idbState.transactions ?? [];
    orderStore.cashBalance = idbState.cashBalance ?? 0;
    orderStore.cashMovements = idbState.cashMovements ?? [];
    orderStore.dailyClosures = idbState.dailyClosures ?? [];
    orderStore.printLog = idbState.printLog ?? [];
    orderStore.tableCurrentBillSession = idbState.tableCurrentBillSession ?? {};
    orderStore.tableMergedInto = idbState.tableMergedInto ?? {};
    orderStore.tableOccupiedAt = idbState.tableOccupiedAt ?? {};
    orderStore.billRequestedTables = idbState.billRequestedTables ?? new Set();
  } else {
    orderStore.orders = [];
  }
}
