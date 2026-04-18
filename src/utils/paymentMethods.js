export const FALLBACK_PAYMENT_METHOD_LABEL = 'Altro';

export function resolvePaymentMethodMeta(methods, values = {}) {
  const list = Array.isArray(methods) ? methods : [];
  const explicitId = typeof values?.paymentMethodId === 'string' ? values.paymentMethodId.trim() : '';
  if (explicitId) {
    const match = list.find((method) => method?.id === explicitId || method?.label === explicitId);
    return { id: match?.id ?? explicitId, label: match?.label ?? explicitId };
  }

  const mappedId = typeof values?.payment_method === 'string' ? values.payment_method.trim() : '';
  if (mappedId) {
    const match = list.find((method) => method?.id === mappedId || method?.label === mappedId);
    return { id: match?.id ?? mappedId, label: match?.label ?? mappedId };
  }

  const label = typeof values?.paymentMethod === 'string' ? values.paymentMethod.trim() : '';
  if (!label) return { id: '', label: FALLBACK_PAYMENT_METHOD_LABEL };
  const match = list.find((method) => method?.id === label || method?.label === label);
  return { id: match?.id ?? '', label: match?.label ?? label };
}
