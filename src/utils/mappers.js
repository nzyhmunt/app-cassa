/**
 * @file utils/mappers.js
 * @description Mapping layer between Directus payloads (snake_case) and local models (camelCase).
 *
 * Official runtime entry points:
 *  - Pull (Directus -> runtime/IDB): mapOrderFromDirectus, mapOrderItemFromDirectus,
 *    mapBillSessionFromDirectus, mapVenueConfigFromDirectus
 *  - Push (runtime/IDB -> Directus): mapOrderToDirectus, mapOrderItemToDirectus,
 *    mapBillSessionToDirectus, mapTransactionToDirectus, mapOrderItemModifierToDirectus
 *  - Central dispatch (runtime/IDB -> Directus): mapPayloadToDirectus
 *
 * Verification (P2-2): every exported `map*FromDirectus` / `map*ToDirectus`
 * mapper is currently referenced by runtime code (not tests-only).
 */

import { resolvePaymentMethodMeta } from './paymentMethods.js';

function relationId(value) {
  if (value == null) return null;
  if (typeof value === 'object') return value.id ?? null;
  return value;
}

function numberOr(value, fallback = 0) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function parseJsonArray(value) {
  if (Array.isArray(value)) return value;
  if (typeof value === 'string' && value.trim() !== '') {
    try {
      const parsed = JSON.parse(value);
      return Array.isArray(parsed) ? parsed : [];
    } catch (_) {
      return [];
    }
  }
  return [];
}

function normalizeOrderItemModifier(modifier) {
  if (!modifier || typeof modifier !== 'object') return null;
  const voidedQuantity = numberOr(modifier.voided_quantity ?? modifier.voidedQuantity);
  return {
    ...modifier,
    price: numberOr(modifier.price),
    voidedQuantity,
    voided_quantity: voidedQuantity,
  };
}

function normalizeNestedOrderItem(record) {
  if (!record || typeof record !== 'object') return null;
  const mapped = mapOrderItemFromDirectus(record);
  return {
    ...mapped,
    notes: Array.isArray(mapped.notes) ? mapped.notes : [],
    modifiers: Array.isArray(mapped.modifiers) ? mapped.modifiers : [],
  };
}

export function mapOrderFromDirectus(record) {
  const tableId = relationId(record.table);
  const billSessionId = relationId(record.bill_session ?? record.billSessionId ?? null);
  const totalAmount = numberOr(record.total_amount ?? record.totalAmount);
  const itemCount = numberOr(record.item_count ?? record.itemCount);
  const rawOrderItems = Array.isArray(record.orderItems)
    ? record.orderItems
    : Array.isArray(record.order_items)
      ? record.order_items
      : [];
  return {
    ...record,
    table: tableId ?? record.table ?? null,
    bill_session: billSessionId,
    billSessionId,
    total_amount: totalAmount,
    item_count: itemCount,
    totalAmount,
    itemCount,
    time: record.order_time ?? record.time ?? '',
    globalNote: record.global_note ?? record.globalNote ?? '',
    noteVisibility: {
      cassa: record.note_visibility_cassa ?? record.noteVisibility?.cassa ?? true,
      sala: record.note_visibility_sala ?? record.noteVisibility?.sala ?? true,
      cucina: record.note_visibility_cucina ?? record.noteVisibility?.cucina ?? true,
    },
    isCoverCharge: record.is_cover_charge ?? record.isCoverCharge ?? false,
    isDirectEntry: record.is_direct_entry ?? record.isDirectEntry ?? false,
    rejectionReason: record.rejection_reason ?? record.rejectionReason ?? null,
    venueUserCreated: relationId(record.venue_user_created ?? record.venueUserCreated ?? null),
    venueUserUpdated: relationId(record.venue_user_updated ?? record.venueUserUpdated ?? null),
    dietaryPreferences: record.dietaryPreferences ?? {
      diete: parseJsonArray(record.dietary_diets),
      allergeni: parseJsonArray(record.dietary_allergens),
    },
    orderItems: rawOrderItems.map(normalizeNestedOrderItem).filter(Boolean),
    _sync_status: 'synced',
  };
}

export function mapOrderToDirectus(record) {
  const source = record ?? {};
  const out = { ...source };

  if (!Object.prototype.hasOwnProperty.call(out, 'total_amount') && Object.prototype.hasOwnProperty.call(source, 'totalAmount')) {
    out.total_amount = source.totalAmount;
  }
  if (!Object.prototype.hasOwnProperty.call(out, 'item_count') && Object.prototype.hasOwnProperty.call(source, 'itemCount')) {
    out.item_count = source.itemCount;
  }
  if (!Object.prototype.hasOwnProperty.call(out, 'order_time') && Object.prototype.hasOwnProperty.call(source, 'time')) {
    out.order_time = source.time;
  }
  if (!Object.prototype.hasOwnProperty.call(out, 'global_note') && Object.prototype.hasOwnProperty.call(source, 'globalNote')) {
    out.global_note = source.globalNote;
  }
  if (!Object.prototype.hasOwnProperty.call(out, 'is_cover_charge') && Object.prototype.hasOwnProperty.call(source, 'isCoverCharge')) {
    out.is_cover_charge = source.isCoverCharge;
  }
  if (!Object.prototype.hasOwnProperty.call(out, 'is_direct_entry') && Object.prototype.hasOwnProperty.call(source, 'isDirectEntry')) {
    out.is_direct_entry = source.isDirectEntry;
  }
  if (!Object.prototype.hasOwnProperty.call(out, 'rejection_reason') && Object.prototype.hasOwnProperty.call(source, 'rejectionReason')) {
    out.rejection_reason = source.rejectionReason;
  }
  if (
    !Object.prototype.hasOwnProperty.call(out, 'venue_user_created') &&
    Object.prototype.hasOwnProperty.call(source, 'venueUserCreated') &&
    source.venueUserCreated != null
  ) {
    out.venue_user_created = relationId(source.venueUserCreated);
  }
  if (
    !Object.prototype.hasOwnProperty.call(out, 'venue_user_updated') &&
    Object.prototype.hasOwnProperty.call(source, 'venueUserUpdated') &&
    source.venueUserUpdated != null
  ) {
    out.venue_user_updated = relationId(source.venueUserUpdated);
  }
  if (!Object.prototype.hasOwnProperty.call(out, 'bill_session') && Object.prototype.hasOwnProperty.call(source, 'billSessionId')) {
    out.bill_session = relationId(source.billSessionId);
  }
  if (Object.prototype.hasOwnProperty.call(out, 'bill_session')) {
    out.bill_session = relationId(out.bill_session);
  }

  if (Object.prototype.hasOwnProperty.call(source, 'noteVisibility') && source.noteVisibility && typeof source.noteVisibility === 'object') {
    if (!Object.prototype.hasOwnProperty.call(out, 'note_visibility_cassa') && Object.prototype.hasOwnProperty.call(source.noteVisibility, 'cassa')) {
      out.note_visibility_cassa = source.noteVisibility.cassa;
    }
    if (!Object.prototype.hasOwnProperty.call(out, 'note_visibility_sala') && Object.prototype.hasOwnProperty.call(source.noteVisibility, 'sala')) {
      out.note_visibility_sala = source.noteVisibility.sala;
    }
    if (!Object.prototype.hasOwnProperty.call(out, 'note_visibility_cucina') && Object.prototype.hasOwnProperty.call(source.noteVisibility, 'cucina')) {
      out.note_visibility_cucina = source.noteVisibility.cucina;
    }
  }

  if (Object.prototype.hasOwnProperty.call(source, 'dietaryPreferences') && source.dietaryPreferences && typeof source.dietaryPreferences === 'object') {
    if (!Object.prototype.hasOwnProperty.call(out, 'dietary_diets') && Object.prototype.hasOwnProperty.call(source.dietaryPreferences, 'diete')) {
      out.dietary_diets = source.dietaryPreferences.diete;
    }
    if (!Object.prototype.hasOwnProperty.call(out, 'dietary_allergens') && Object.prototype.hasOwnProperty.call(source.dietaryPreferences, 'allergeni')) {
      out.dietary_allergens = source.dietaryPreferences.allergeni;
    }
  }

  delete out.totalAmount;
  delete out.itemCount;
  delete out.time;
  delete out.globalNote;
  delete out.noteVisibility;
  delete out.dietaryPreferences;
  delete out.isCoverCharge;
  delete out.isDirectEntry;
  delete out.rejectionReason;
  delete out.venueUserCreated;
  delete out.venueUserUpdated;
  delete out.billSessionId;

  return out;
}

export function mapOrderItemFromDirectus(record) {
  const orderId = relationId(record.order ?? record.orderId ?? null);
  const dishId = relationId(record.dish ?? record.dishId ?? null);
  const quantity = numberOr(record.quantity);
  const unitPrice = numberOr(record.unit_price ?? record.unitPrice);
  const voidedQuantity = numberOr(record.voided_quantity ?? record.voidedQuantity);
  return {
    ...record,
    order: orderId,
    orderId,
    dish: dishId,
    dishId,
    uid: record.uid ?? record.id,
    quantity,
    unit_price: unitPrice,
    unitPrice,
    voided_quantity: voidedQuantity,
    voidedQuantity,
    notes: Array.isArray(record.notes) ? record.notes : [],
    modifiers: Array.isArray(record.modifiers)
      ? record.modifiers.map(normalizeOrderItemModifier).filter(Boolean)
      : [],
    kitchenReady: record.kitchen_ready ?? record.kitchenReady ?? false,
    venueUserCreated: relationId(record.venue_user_created ?? record.venueUserCreated ?? null),
    venueUserUpdated: relationId(record.venue_user_updated ?? record.venueUserUpdated ?? null),
    _sync_status: 'synced',
  };
}

export function mapOrderItemToDirectus(record) {
  const source = record ?? {};
  const out = {
    ...source,
    unit_price: source.unit_price ?? source.unitPrice ?? 0,
    voided_quantity: source.voidedQuantity ?? source.voided_quantity ?? 0,
    kitchen_ready: source.kitchen_ready ?? source.kitchenReady ?? false,
    order: relationId(source.order ?? source.orderId ?? null),
    dish: relationId(source.dish ?? source.dishId ?? null),
  };
  const venueUserCreated = source.venue_user_created ?? source.venueUserCreated;
  if (venueUserCreated != null) {
    out.venue_user_created = relationId(venueUserCreated);
  }
  const venueUserUpdated = source.venue_user_updated ?? source.venueUserUpdated;
  if (venueUserUpdated != null) {
    out.venue_user_updated = relationId(venueUserUpdated);
  }
  delete out.unitPrice;
  delete out.voidedQuantity;
  delete out.kitchenReady;
  delete out.orderId;
  delete out.dishId;
  delete out.venueUserCreated;
  delete out.venueUserUpdated;
  return out;
}

export function mapBillSessionFromDirectus(record) {
  return {
    ...record,
    billSessionId: record.id,
    adults: record.adults ?? 0,
    children: record.children ?? 0,
    venueUserCreated: relationId(record.venue_user_created ?? record.venueUserCreated ?? null),
    venueUserUpdated: relationId(record.venue_user_updated ?? record.venueUserUpdated ?? null),
    _sync_status: 'synced',
  };
}

export function mapBillSessionToDirectus(record) {
  const source = record ?? {};
  const out = { ...source };
  if (
    !Object.prototype.hasOwnProperty.call(out, 'venue_user_created')
    && Object.prototype.hasOwnProperty.call(source, 'venueUserCreated')
    && source.venueUserCreated != null
  ) {
    out.venue_user_created = relationId(source.venueUserCreated);
  }
  if (
    !Object.prototype.hasOwnProperty.call(out, 'venue_user_updated')
    && Object.prototype.hasOwnProperty.call(source, 'venueUserUpdated')
    && source.venueUserUpdated != null
  ) {
    out.venue_user_updated = relationId(source.venueUserUpdated);
  }
  delete out.venueUserCreated;
  delete out.venueUserUpdated;
  return out;
}

/**
 * Explicit rename map: local in-app field name → Directus collection field name.
 *
 * Directus FK fields use the related collection name **without** an `_id` suffix
 * (e.g. `bill_session`, not `bill_session_id`). This matches the Directus
 * convention described in DATABASE_SCHEMA.md.
 *
 * This is the single source of truth for `mapPayloadToDirectus`
 * generic local-to-Directus field renames for collections that do not have a
 * dedicated mapper (e.g. `daily_closures`).
 *
 * @type {Record<string, string>}
 */
export const FIELD_RENAME_MAP = {
  // FK fields — Directus convention: no _id suffix
  billSessionId:  'bill_session',
  orderId:        'order',
  orderItemId:    'order_item',
  dishId:         'dish',
  tableId:        'table',
  // camelCase → snake_case for domain fields
  totalAmount:        'total_amount',
  itemCount:          'item_count',
  isCoverCharge:      'is_cover_charge',
  isDirectEntry:      'is_direct_entry',
  rejectionReason:    'rejection_reason',
  globalNote:         'global_note',
  unitPrice:          'unit_price',
  voidedQuantity:     'voided_quantity',
  kitchenReady:       'kitchen_ready',
  operationType:      'operation_type',
  paymentMethodId:    'payment_method',
  amountPaid:         'amount_paid',
  tipAmount:          'tip_amount',
  romanaSplitCount:   'romana_split_count',
  splitQuota:         'split_quota',
  splitWays:          'split_ways',
  discountType:       'discount_type',
  discountValue:      'discount_value',
  menuSource:         'menu_source',
  itemUid:            'item_uid',
  // daily_closures camelCase → snake_case (DATABASE_SCHEMA.md §2.15)
  cashBalance:        'cash_balance',
  totalReceived:      'total_received',
  totalDiscount:      'total_discount',
  totalTips:          'total_tips',
  totalCovers:        'total_covers',
  receiptCount:       'receipt_count',
  averageReceipt:     'average_receipt',
  totalMovements:     'total_movements',
  finalBalance:       'final_balance',
};

// ── Push-direction internal helpers ──────────────────────────────────────────

/**
 * Local-only runtime fields that must NEVER be pushed to Directus.
 * @type {Set<string>}
 */
const _LOCAL_ONLY_FIELDS = new Set(['_sync_status']);

/**
 * UI-only / transport-local fields that should be stripped before push.
 * These fields are either display labels, local-aggregation helpers, or
 * handled via separate junction collection entries.
 * @type {Set<string>}
 */
const _PUSH_DROP_FIELDS = new Set([
  'timestamp',         // local ISO string; Directus auto-sets date_created via server
  'paymentMethod',     // UI-only display label; Directus persists only the relation id
  'orderRefs',         // M2M handled separately via transaction_order_refs collection
  'vociRefs',          // M2M handled separately via transaction_voce_refs collection
  'grossAmount',       // UI-only display field (not in Directus schema)
  'changeAmount',      // UI-only display field (not in Directus schema)
  // daily_closures local-only aggregation fields — not columns in Directus schema
  'byMethod',          // per-method amount map; detail rows sent as daily_closure_by_method
  'tipsByMethod',      // per-method tip map; local-only aggregation
  'cashMovementsData', // cash movement detail list; stored separately in cash_movements
  'fiscalCount',       // local fiscal receipt tally; not a Directus column
  'fiscalTotal',       // local fiscal receipt total; not a Directus column
  'invoiceCount',      // local invoice request tally; not a Directus column
  'invoiceTotal',      // local invoice request total; not a Directus column
]);

/**
 * Directus array-typed fields stored as JSON strings in some legacy payloads.
 * When the value is a string it is parsed; when null/undefined it defaults to [].
 * @type {Set<string>}
 */
const _DIRECTUS_JSON_FIELDS = new Set([
  'dietary_diets',
  'dietary_allergens',
  'ingredients',
  'allergens',
  'print_types',
  'categories',
]);

/**
 * Directus FK fields whose value may arrive as a relation object { id, … }.
 * When the value is an object its `.id` is extracted so only the scalar PK is sent.
 * @type {Set<string>}
 */
const _DIRECTUS_RELATION_FIELDS = new Set([
  'venue',
  'room',
  'table',
  'bill_session',
  'order',
  'dish',
  'order_item',
  'menu_item',
  'menu_items_id',
  'menu_categories_id',
  'menu_modifiers_id',
]);

/**
 * Collections that carry a payment-method FK that requires resolution via
 * `resolvePaymentMethodMeta` to obtain the canonical Directus relation id.
 * @type {Set<string>}
 */
const _PAYMENT_METHOD_COLLECTIONS = new Set(['transactions', 'daily_closure_by_method']);

function normalizeMenu(modifiers, categoryModifierLinks, itemModifierLinks, categories, items, locale) {
  const modifiersById = new Map(
    (modifiers ?? [])
      .filter((modifier) => modifier.status !== 'archived')
      .map((modifier) => [String(modifier.id), {
        id: modifier.id,
        name: modifier.name ?? '',
        price: Number(modifier.price ?? 0),
      }]),
  );

  const categoryModifierIds = new Map();
  for (const link of (categoryModifierLinks ?? [])) {
    const categoryId = relationId(link.menu_categories_id);
    const modifierId = relationId(link.menu_modifiers_id);
    if (categoryId == null || modifierId == null) continue;
    const key = String(categoryId);
    if (!categoryModifierIds.has(key)) categoryModifierIds.set(key, new Set());
    categoryModifierIds.get(key).add(String(modifierId));
  }

  const itemModifierIds = new Map();
  for (const link of (itemModifierLinks ?? [])) {
    const itemId = relationId(link.menu_items_id);
    const modifierId = relationId(link.menu_modifiers_id);
    if (itemId == null || modifierId == null) continue;
    const key = String(itemId);
    if (!itemModifierIds.has(key)) itemModifierIds.set(key, new Set());
    itemModifierIds.get(key).add(String(modifierId));
  }

  const itemsByCategory = new Map();
  for (const item of (items ?? [])) {
    const categoryId = relationId(item.category);
    if (categoryId == null) continue;
    if (!itemsByCategory.has(categoryId)) itemsByCategory.set(categoryId, []);
    const mergedModifierIds = new Set([
      ...(categoryModifierIds.get(String(categoryId)) ?? []),
      ...(itemModifierIds.get(String(item.id)) ?? []),
    ]);
    const availableModifiers = [...mergedModifierIds]
      .map((modifierId) => modifiersById.get(String(modifierId)))
      .filter(Boolean)
      .sort((a, b) => a.name.localeCompare(b.name, locale));

    itemsByCategory.get(categoryId).push({
      id: item.id,
      name: item.name,
      price: Number(item.price),
      descrizione: item.description ?? '',
      note: item.note ?? '',
      ingredienti: parseJsonArray(item.ingredients),
      allergeni: parseJsonArray(item.allergens),
      immagine_url: item.image_url ?? '',
      modifiers: availableModifiers,
    });
  }

  const menu = {};
  for (const category of (categories ?? [])) {
    const categoryId = relationId(category.id) ?? category.id;
    const categoryItems = itemsByCategory.get(categoryId) ?? [];
    if (categoryItems.length > 0) menu[category.name] = categoryItems;
  }
  return menu;
}

export function mapVenueConfigFromDirectus(cachedConfig, defaults) {
  if (!cachedConfig) return JSON.parse(JSON.stringify(defaults));
  const next = JSON.parse(JSON.stringify(defaults));
  const {
    venueRecord = null,
    rooms = [],
    tables = [],
    paymentMethods = [],
    printers = [],
    categories = [],
    items = [],
    modifiers = [],
    categoryModifierLinks = [],
    itemModifierLinks = [],
  } = cachedConfig;

  if (venueRecord) {
    if (venueRecord?.name != null) next.ui.name = venueRecord.name;
    next.ui.primaryColor = venueRecord?.primary_color || next.ui.primaryColor;
    next.ui.primaryColorDark = venueRecord?.primary_color_dark || next.ui.primaryColorDark;
    next.ui.currency = venueRecord?.currency_symbol || next.ui.currency;
    if (venueRecord?.allow_custom_variants != null) next.ui.allowCustomVariants = venueRecord.allow_custom_variants;

    if (venueRecord.cover_charge_enabled != null) next.coverCharge.enabled = venueRecord.cover_charge_enabled;
    if (venueRecord.cover_charge_auto_add != null) next.coverCharge.autoAdd = venueRecord.cover_charge_auto_add;
    if (venueRecord.cover_charge_price_adult != null) next.coverCharge.priceAdult = Number(venueRecord.cover_charge_price_adult);
    if (venueRecord.cover_charge_price_child != null) next.coverCharge.priceChild = Number(venueRecord.cover_charge_price_child);

    if (venueRecord.billing_enable_cash_change_calculator != null) next.billing.enableCashChangeCalculator = venueRecord.billing_enable_cash_change_calculator;
    if (venueRecord.billing_enable_tips != null) next.billing.enableTips = venueRecord.billing_enable_tips;
    if (venueRecord.billing_enable_discounts != null) next.billing.enableDiscounts = venueRecord.billing_enable_discounts;
    if (venueRecord.billing_auto_close_on_full_payment != null) next.billing.autoCloseOnFullPayment = venueRecord.billing_auto_close_on_full_payment;
    if (venueRecord.billing_allow_custom_entry != null) next.billing.allowCustomEntry = venueRecord.billing_allow_custom_entry;

    if (Array.isArray(venueRecord.orders_rejection_reasons) && venueRecord.orders_rejection_reasons.length > 0) {
      next.orders.rejectionReasons = venueRecord.orders_rejection_reasons;
    }
    if (venueRecord.menu_source !== null && venueRecord.menu_source !== undefined) next.menuSource = venueRecord.menu_source;
    if (venueRecord.menu_url != null && String(venueRecord.menu_url).trim() !== '') next.menuUrl = String(venueRecord.menu_url);
  }

  if (rooms.length > 0) {
    const tablesByRoom = new Map();
    const tableById = new Map();
    for (const table of tables) {
      const roomId = relationId(table.room);
      const key = roomId != null ? String(roomId) : '_unassigned';
      if (!tablesByRoom.has(key)) tablesByRoom.set(key, []);
      const entry = { id: table.id, label: table.label, covers: table.covers ?? 2 };
      tablesByRoom.get(key).push(entry);
      tableById.set(String(table.id), entry);
    }
    const configuredRooms = rooms.map((room) => ({
      id: room.id,
      label: room.label,
      tables: (() => {
        const roomId = String(room.id);
        const directTables = tablesByRoom.get(roomId) ?? [];
        if (directTables.length > 0 || !Array.isArray(room.tables) || room.tables.length === 0) return directTables;
        return room.tables
          .map((roomTable) => {
            const roomTableId = relationId(roomTable);
            const tableEntry = roomTableId != null ? tableById.get(String(roomTableId)) : null;
            if (tableEntry) return tableEntry;
            if (typeof roomTable === 'object' && roomTableId != null) {
              return { id: roomTableId, label: roomTable.label ?? String(roomTableId), covers: roomTable.covers ?? 2 };
            }
            if (roomTableId == null) return null;
            return { id: roomTableId, label: String(roomTableId), covers: 2 };
          })
          .filter(Boolean);
      })(),
    }));
    const unassignedTables = tablesByRoom.get('_unassigned') ?? [];
    next.rooms = unassignedTables.length > 0
      ? [...configuredRooms, { id: '_unassigned', label: 'Unassigned', tables: unassignedTables }]
      : configuredRooms;
  } else if (tables.length > 0) {
    const genericTables = tables.map(t => ({ id: t.id, label: t.label, covers: t.covers ?? 2 }));
    next.rooms = [{ id: 'sala', label: 'Sala', tables: genericTables }];
  }
  next.tables = Array.isArray(next.rooms) ? next.rooms.flatMap(room => room.tables || []) : [];

  if (paymentMethods.length > 0) {
    next.paymentMethods = paymentMethods.map((paymentMethod) => ({
      id: paymentMethod.id,
      label: paymentMethod.label,
      icon: paymentMethod.icon ?? '',
      colorClass: paymentMethod.color_class ?? '',
    }));
  }

  if (printers.length > 0) {
    next.printers = printers.map((printer) => {
      const entry = { id: printer.id, name: printer.name, url: printer.url };
      if (printer.print_types?.length) entry.printTypes = printer.print_types;
      if (printer.categories?.length) entry.categories = printer.categories;
      return entry;
    });
  }

  if (next.menuSource === 'directus' && categories.length > 0 && items.length > 0) {
    const menu = normalizeMenu(modifiers, categoryModifierLinks, itemModifierLinks, categories, items, next.locale ?? 'it-IT');
    if (Object.keys(menu).length > 0) next.menu = menu;
  }

  return next;
}

// ── Push mappers: new dedicated mappers ──────────────────────────────────────

/**
 * Maps a local `order_item_modifiers` record to Directus field names.
 *
 * @param {object} record
 * @returns {object}
 */
export function mapOrderItemModifierToDirectus(record) {
  const source = record ?? {};
  const out = { ...source };
  if (!Object.prototype.hasOwnProperty.call(out, 'item_uid') && Object.prototype.hasOwnProperty.call(source, 'itemUid')) {
    out.item_uid = source.itemUid;
  }
  if (!Object.prototype.hasOwnProperty.call(out, 'order_item') && Object.prototype.hasOwnProperty.call(source, 'orderItemId')) {
    out.order_item = source.orderItemId;
  }
  if (!Object.prototype.hasOwnProperty.call(out, 'order') && Object.prototype.hasOwnProperty.call(source, 'orderId')) {
    out.order = source.orderId;
  }
  if (Object.prototype.hasOwnProperty.call(source, 'voided_quantity')) {
    out.voided_quantity = source.voided_quantity;
  } else if (Object.prototype.hasOwnProperty.call(source, 'voidedQuantity')) {
    out.voided_quantity = source.voidedQuantity;
  }
  delete out.voidedQuantity;
  delete out.itemUid;
  delete out.orderItemId;
  delete out.orderId;
  return out;
}

/**
 * Maps a local `transactions` record to Directus field names.
 *
 * Handles camelCase → snake_case renames and FK fields (tableId → table,
 * billSessionId → bill_session, paymentMethodId → payment_method).
 * The `paymentMethod` UI label is NOT handled here; it is stripped by
 * `mapPayloadToDirectus` via `_PUSH_DROP_FIELDS` before this mapper runs.
 *
 * @param {object} record
 * @returns {object}
 */
export function mapTransactionToDirectus(record) {
  const source = record ?? {};
  const out = { ...source };

  if (!Object.prototype.hasOwnProperty.call(out, 'table') && Object.prototype.hasOwnProperty.call(source, 'tableId')) {
    out.table = source.tableId;
  }
  if (!Object.prototype.hasOwnProperty.call(out, 'bill_session') && Object.prototype.hasOwnProperty.call(source, 'billSessionId')) {
    out.bill_session = source.billSessionId;
  }
  if (!Object.prototype.hasOwnProperty.call(out, 'payment_method') && Object.prototype.hasOwnProperty.call(source, 'paymentMethodId')) {
    out.payment_method = source.paymentMethodId;
  }
  if (!Object.prototype.hasOwnProperty.call(out, 'operation_type') && Object.prototype.hasOwnProperty.call(source, 'operationType')) {
    out.operation_type = source.operationType;
  }
  if (!Object.prototype.hasOwnProperty.call(out, 'amount_paid') && Object.prototype.hasOwnProperty.call(source, 'amountPaid')) {
    out.amount_paid = source.amountPaid;
  }
  if (!Object.prototype.hasOwnProperty.call(out, 'tip_amount') && Object.prototype.hasOwnProperty.call(source, 'tipAmount')) {
    out.tip_amount = source.tipAmount;
  }
  if (!Object.prototype.hasOwnProperty.call(out, 'romana_split_count') && Object.prototype.hasOwnProperty.call(source, 'romanaSplitCount')) {
    out.romana_split_count = source.romanaSplitCount;
  }
  if (!Object.prototype.hasOwnProperty.call(out, 'split_quota') && Object.prototype.hasOwnProperty.call(source, 'splitQuota')) {
    out.split_quota = source.splitQuota;
  }
  if (!Object.prototype.hasOwnProperty.call(out, 'split_ways') && Object.prototype.hasOwnProperty.call(source, 'splitWays')) {
    out.split_ways = source.splitWays;
  }
  if (!Object.prototype.hasOwnProperty.call(out, 'discount_type') && Object.prototype.hasOwnProperty.call(source, 'discountType')) {
    out.discount_type = source.discountType;
  }
  if (!Object.prototype.hasOwnProperty.call(out, 'discount_value') && Object.prototype.hasOwnProperty.call(source, 'discountValue')) {
    out.discount_value = source.discountValue;
  }

  delete out.tableId;
  delete out.billSessionId;
  delete out.paymentMethodId;
  delete out.operationType;
  delete out.amountPaid;
  delete out.tipAmount;
  delete out.romanaSplitCount;
  delete out.splitQuota;
  delete out.splitWays;
  delete out.discountType;
  delete out.discountValue;

  return out;
}

// Declared after the individual mappers so all references are resolved.
const _TO_DIRECTUS_MAPPERS = {
  orders: mapOrderToDirectus,
  order_items: mapOrderItemToDirectus,
  bill_sessions: mapBillSessionToDirectus,
  order_item_modifiers: mapOrderItemModifierToDirectus,
  transactions: mapTransactionToDirectus,
};

/**
 * Central dispatch: translates a local (camelCase / legacy-named) record
 * payload into a Directus-compatible field naming convention (snake_case, FK
 * fields without the `_id` suffix per DATABASE_SCHEMA.md §2 convention).
 *
 * Processing steps (in order):
 *  1. Strip local-only and push-drop fields.
 *  2. Expand nested `orderItems → order_items` (for `orders`); then enrich each
 *     already-expanded `order_item_modifiers` (set by Step 3 in the recursive
 *     call) with parent-context `order_item`/`order` FKs.
 *  3. Expand nested `modifiers → order_item_modifiers` (for `order_items`).
 *  4. Apply dedicated collection mapper (or generic FIELD_RENAME_MAP).
 *  5. Resolve `payment_method` FK via `resolvePaymentMethodMeta` (where applicable).
 *  6. Normalise relation-object FK values and JSON-array fields.
 *
 * Fields supplied in the input payload are mapped through to Directus naming,
 * but dedicated collection mappers may also emit normalized/default-valued
 * fields (for example numeric/boolean defaults) even when those properties are
 * absent from the input. Do not assume the result is universally safe for
 * partial updates across all collections.
 *
 * @param {string} collection  - Directus collection name (e.g. 'orders')
 * @param {object|null} payload - Local record payload
 * @param {{ paymentMethods?: Array, recordId?: string|null }} [ctx] - Runtime context. `recordId` is
 *   the queue entry's `record_id` and is used as a last-resort fallback for the `order` FK on
 *   nested `order_items` when the payload does not carry an `id` field (partial updates).
 * @returns {object}  Directus-ready payload
 */
export function mapPayloadToDirectus(collection, payload, ctx = {}) {
  if (!payload || typeof payload !== 'object') return {};

  const { paymentMethods = [] } = ctx;

  // Step 1 — strip local-only and push-drop fields
  const cleaned = {};
  for (const [k, v] of Object.entries(payload)) {
    if (_LOCAL_ONLY_FIELDS.has(k)) continue;
    if (_PUSH_DROP_FIELDS.has(k)) continue;
    cleaned[k] = v;
  }

  // Step 2 — expand nested orderItems (orders only)
  const preProcessed = { ...cleaned };
  if (collection === 'orders' && Array.isArray(cleaned.orderItems)) {
    preProcessed.order_items = cleaned.orderItems.map((item) => {
      // The recursive call handles Steps 1–4 for order_items, including
      // Step 3 which expands item.modifiers → order_item_modifiers.
      const directItem = mapPayloadToDirectus('order_items', item, ctx);
      if (directItem.id == null && item?.id) directItem.id = item.id;
      // Fallback order: item.orderId (explicit) → payload.id (create path where id is in payload)
      // → ctx.recordId (update path where id is in queue entry.record_id, not in payload body)
      const resolvedOrderId = item?.orderId ?? payload?.id ?? ctx?.recordId ?? null;
      if (directItem.order == null && resolvedOrderId) directItem.order = resolvedOrderId;
      // Enrich already-expanded modifiers (populated by Step 3 in the recursive
      // call above) with parent-context FKs that are not available there.
      if (Array.isArray(directItem.order_item_modifiers)) {
        const srcMods = item?.modifiers ?? [];
        directItem.order_item_modifiers = directItem.order_item_modifiers.map((directMod, i) => {
          const enriched = { ...directMod };
          const srcMod = srcMods[i] ?? {};
          if (enriched.id == null && srcMod.id) enriched.id = srcMod.id;
          if (enriched.item_uid == null && item?.uid) enriched.item_uid = item.uid;
          if (enriched.order_item == null && item?.id) enriched.order_item = item.id;
          if (enriched.order == null && resolvedOrderId) enriched.order = resolvedOrderId;
          return enriched;
        });
      }
      return directItem;
    });
    delete preProcessed.orderItems;
  }

  // Step 3 — expand nested modifiers (order_items only)
  if (collection === 'order_items' && Array.isArray(cleaned.modifiers)) {
    preProcessed.order_item_modifiers = cleaned.modifiers.map(
      (mod) => mapPayloadToDirectus('order_item_modifiers', mod, ctx),
    );
    delete preProcessed.modifiers;
  }

  // Step 4 — apply dedicated mapper or generic FIELD_RENAME_MAP
  let mapped;
  const dedicatedMapper = _TO_DIRECTUS_MAPPERS[collection];
  if (dedicatedMapper) {
    mapped = dedicatedMapper(preProcessed);
  } else {
    mapped = {};
    for (const [key, value] of Object.entries(preProcessed)) {
      const renamed = FIELD_RENAME_MAP[key];
      if (renamed) {
        mapped[renamed] = value;
      } else {
        mapped[key] = value;
      }
    }
  }

  // Step 5 — payment method FK resolution
  if (_PAYMENT_METHOD_COLLECTIONS.has(collection)) {
    const resolved = resolvePaymentMethodMeta(
      Array.isArray(paymentMethods) ? paymentMethods : [],
      {
        paymentMethodId: payload?.paymentMethodId,
        payment_method: mapped?.payment_method,
        paymentMethod: payload?.paymentMethod,
      },
    );
    if (resolved.id) {
      mapped.payment_method = resolved.id;
    } else {
      if (mapped.payment_method != null || payload?.paymentMethodId != null || payload?.paymentMethod != null) {
        console.warn('[Mappers] Dropping unresolved payment method from payload:', {
          collection,
          recordId: payload?.id ?? null,
          paymentMethodId: payload?.paymentMethodId ?? null,
          paymentMethod: payload?.paymentMethod ?? null,
          payment_method: mapped.payment_method ?? null,
        });
      }
      delete mapped.payment_method;
    }
  }

  // Step 6 — normalise FK objects and JSON-array fields
  for (const fieldName of Object.keys(mapped)) {
    if (_DIRECTUS_RELATION_FIELDS.has(fieldName)) {
      const value = mapped[fieldName];
      if (value && typeof value === 'object') {
        mapped[fieldName] = value.id ?? value.value ?? null;
      }
    }
    if (_DIRECTUS_JSON_FIELDS.has(fieldName)) {
      const value = mapped[fieldName];
      if (Array.isArray(value)) continue;
      if (typeof value === 'string') {
        const trimmed = value.trim();
        if (trimmed === '') {
          mapped[fieldName] = [];
          continue;
        }
        try {
          const parsed = JSON.parse(trimmed);
          mapped[fieldName] = Array.isArray(parsed) ? parsed : [];
        } catch (_) {
          mapped[fieldName] = [value];
        }
      } else if (value == null) {
        mapped[fieldName] = [];
      }
    }
  }

  return mapped;
}
