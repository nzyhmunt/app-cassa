/**
 * @file utils/mappers.js
 * @description Mapping layer between Directus payloads (snake_case) and local models (camelCase).
 *
 * Official runtime entry points:
 *  - Pull (Directus -> runtime/IDB): mapOrderFromDirectus, mapOrderItemFromDirectus,
 *    mapBillSessionFromDirectus, mapVenueConfigFromDirectus
 *  - Push (runtime/IDB -> Directus): mapOrderToDirectus, mapOrderItemToDirectus,
 *    mapBillSessionToDirectus
 *
 * Verification (P2-2): every exported `map*FromDirectus` / `map*ToDirectus`
 * mapper is currently referenced by runtime code (not tests-only).
 */

function relationId(value) {
  if (value == null) return null;
  if (typeof value === 'object') return value.id ?? null;
  return value;
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

export function mapOrderFromDirectus(record) {
  const tableId = relationId(record.table);
  const billSessionId = relationId(record.bill_session ?? record.billSessionId ?? null);
  return {
    ...record,
    table: tableId ?? record.table ?? null,
    bill_session: billSessionId,
    billSessionId,
    totalAmount: record.total_amount ?? record.totalAmount ?? 0,
    itemCount: record.item_count ?? record.itemCount ?? 0,
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
    orderItems: record.orderItems ?? record.order_items ?? [],
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
  if (!Object.prototype.hasOwnProperty.call(out, 'venue_user_created') && Object.prototype.hasOwnProperty.call(source, 'venueUserCreated')) {
    out.venue_user_created = relationId(source.venueUserCreated);
  }
  if (!Object.prototype.hasOwnProperty.call(out, 'venue_user_updated') && Object.prototype.hasOwnProperty.call(source, 'venueUserUpdated')) {
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
  return {
    ...record,
    order: orderId,
    orderId,
    dish: dishId,
    dishId,
    uid: record.uid ?? record.id,
    unitPrice: record.unit_price ?? record.unitPrice ?? 0,
    voidedQuantity: record.voided_quantity ?? record.voidedQuantity ?? 0,
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
    voided_quantity: source.voided_quantity ?? source.voidedQuantity ?? 0,
    kitchen_ready: source.kitchen_ready ?? source.kitchenReady ?? false,
    order: relationId(source.order ?? source.orderId ?? null),
    dish: relationId(source.dish ?? source.dishId ?? null),
    venue_user_created: relationId(source.venue_user_created ?? source.venueUserCreated ?? null),
    venue_user_updated: relationId(source.venue_user_updated ?? source.venueUserUpdated ?? null),
  };
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
  if (!Object.prototype.hasOwnProperty.call(out, 'venue_user_created') && Object.prototype.hasOwnProperty.call(source, 'venueUserCreated')) {
    out.venue_user_created = relationId(source.venueUserCreated);
  }
  if (!Object.prototype.hasOwnProperty.call(out, 'venue_user_updated') && Object.prototype.hasOwnProperty.call(source, 'venueUserUpdated')) {
    out.venue_user_updated = relationId(source.venueUserUpdated);
  }
  delete out.venueUserCreated;
  delete out.venueUserUpdated;
  return out;
}

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
