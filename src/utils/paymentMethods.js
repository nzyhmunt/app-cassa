export const FALLBACK_PAYMENT_METHOD_LABEL = 'Altro';

export function resolvePaymentMethodMeta(methods, values = {}) {
  const list = Array.isArray(methods) ? methods : [];
  const lookup = new Map();
  for (const method of list) {
    if (typeof method?.id === 'string' && method.id.trim()) lookup.set(method.id.trim(), method);
    if (typeof method?.label === 'string' && method.label.trim()) lookup.set(method.label.trim(), method);
  }
  const label = typeof values?.paymentMethod === 'string' ? values.paymentMethod.trim() : '';
  const explicitId = typeof values?.paymentMethodId === 'string' ? values.paymentMethodId.trim() : '';
  if (explicitId) {
    const match = lookup.get(explicitId) ?? null;
    return { id: match?.id ?? explicitId, label: match?.label ?? label ?? explicitId };
  }

  const mappedId = typeof values?.payment_method === 'string' ? values.payment_method.trim() : '';
  if (mappedId) {
    const match = lookup.get(mappedId) ?? null;
    return { id: match?.id ?? mappedId, label: match?.label ?? label ?? mappedId };
  }
  if (!label) return { id: '', label: FALLBACK_PAYMENT_METHOD_LABEL };
  const match = lookup.get(label) ?? null;
  return { id: match?.id ?? '', label: match?.label ?? label };
}

/**
 * Resolves the display label for a transaction.
 *
 * Originating-device transactions always carry `txn.paymentMethod` (set at creation time).
 * Pulled transactions only have `txn.paymentMethodId` — the UI label was stripped from
 * Directus on push.  This helper bridges both shapes:
 *
 *  1. Use `txn.paymentMethod` if already present.
 *  2. Resolve from `methods` via `txn.paymentMethodId` — delegates to
 *     `resolvePaymentMethodMeta` for consistent trimming and lookup-map resolution;
 *     falls back to the raw (trimmed) id when the id is not present in the config list.
 *  3. Fall back to known operation-type names ('Mancia' / 'Sconto') for tip/discount
 *     transactions which carry no payment method at all.
 *  4. Return '' as last resort so callers can filter with `.filter(Boolean)`.
 *
 * @param {Array}   methods  - `configStore.config.paymentMethods`
 * @param {object}  txn      - transaction record
 * @returns {string}
 */
export function resolveTransactionPaymentLabel(methods, txn) {
  if (txn?.paymentMethod) return txn.paymentMethod;
  const id = txn?.paymentMethodId;
  if (id) {
    // Delegate to resolvePaymentMethodMeta so that trimming, lookup-map building,
    // and id/label normalisation are handled consistently in one place.
    const meta = resolvePaymentMethodMeta(methods, { paymentMethodId: id });
    // meta.label is '' when the id is not found in the methods list;
    // in that case return the raw id (trimmed by resolvePaymentMethodMeta internals)
    // which is more informative than an empty string.
    return meta.label || (typeof id === 'string' ? id.trim() : String(id));
  }
  if (txn?.operationType === 'tip') return 'Mancia';
  if (txn?.operationType === 'discount') return 'Sconto';
  return '';
}
