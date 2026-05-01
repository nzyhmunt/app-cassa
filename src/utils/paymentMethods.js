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
