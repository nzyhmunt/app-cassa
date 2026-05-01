/**
 * @file store/idbPersistence.js
 * @description Barrel re-export of all IndexedDB persistence helpers.
 *
 * The implementation is split into domain-specific modules under
 * `src/store/persistence/`. This file exists for backwards-compatibility so
 * that all existing `import ... from '../idbPersistence.js'` paths continue to
 * work without modification.
 *
 * Module structure after the split (Step 5 of the architecture refactoring):
 *  - persistence/operations.js  — loadStateFromIDB, saveStateToIDB, upsert/delete helpers
 *  - persistence/config.js      — loadConfigFromIDB, pull timestamps, table-merge/venue-user replace
 *  - persistence/settings.js    — local settings, JSON menu cache, custom items
 *  - persistence/auth.js        — venue users, auth session/settings
 *  - persistence/audit.js       — fiscal receipts, invoice requests
 *  - persistence/reset.js       — clearAllStateFromIDB, clearSyncQueueFromIDB, deleteDatabase
 */

export {
  loadStateFromIDB,
  saveStateToIDB,
  saveOrdersAndOccupancyInIDB,
  upsertBillSessionInIDB,
  closeBillSessionInIDB,
  upsertRecordsIntoIDB,
  deleteRecordsFromIDB,
} from './persistence/operations.js';

export {
  loadConfigFromIDB,
  clearLocalConfigCacheFromIDB,
  loadLastPullTsFromIDB,
  saveLastPullTsToIDB,
  replaceTableMergesInIDB,
  replaceVenueUsersInIDB,
} from './persistence/config.js';

export {
  loadSettingsFromIDB,
  saveSettingsToIDB,
  saveJsonMenuToIDB,
  loadJsonMenuFromIDB,
  loadCustomItemsFromIDB,
  saveCustomItemsToIDB,
} from './persistence/settings.js';

export {
  loadUsersFromIDB,
  saveUsersToIDB,
  loadAuthSessionFromIDB,
  saveAuthSessionToIDB,
  loadAuthSettingsFromIDB,
  saveAuthSettingsToIDB,
} from './persistence/auth.js';

export {
  saveFiscalReceiptToIDB,
  loadFiscalReceiptsFromIDB,
  pruneFiscalReceiptsInIDB,
  saveInvoiceRequestToIDB,
  loadInvoiceRequestsFromIDB,
  pruneInvoiceRequestsInIDB,
} from './persistence/audit.js';

export {
  clearAllStateFromIDB,
  clearSyncQueueFromIDB,
  deleteDatabase,
} from './persistence/reset.js';
