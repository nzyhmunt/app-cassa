import { PULL_CONFIG } from './config.js';

const ONLINE_ONLY_ROUTE_PULL_COLLECTIONS = {
  cassa: {
    '/sala': ['orders', 'order_items', 'tables', 'bill_sessions'],
    '/ordini': ['orders', 'order_items', 'tables'],
    '/storico-conti': ['orders', 'bill_sessions', 'transactions', 'fiscal_receipts', 'invoice_requests'],
  },
  sala: {
    '/sala': ['orders', 'order_items', 'tables', 'bill_sessions'],
    '/comande': ['orders', 'order_items', 'tables', 'menu_items'],
  },
  cucina: {
    '/': ['orders', 'order_items'],
  },
};

/**
* Normalizes a route path by trimming and stripping query/hash suffixes.
* Example: '/sala?tab=1#section' -> '/sala'
*
* @param {string|null|undefined} routePath
* @returns {string|null}
*/
function normalizeRoutePath(routePath) {
  if (typeof routePath !== 'string') return null;
  const raw = routePath.trim();
  if (!raw) return null;
  const [withoutQuery] = raw.split('?');
  const [withoutHash] = withoutQuery.split('#');
  return withoutHash || '/';
}

export function resolveOnlineOnlyRoutePullCollections(appType, routePath) {
  const pullCfg = PULL_CONFIG[appType] ?? PULL_CONFIG.cassa;
  const allowed = new Set(pullCfg.collections);
  const normalizedPath = normalizeRoutePath(routePath);
  const routeMap = ONLINE_ONLY_ROUTE_PULL_COLLECTIONS[appType] ?? {};
  const configured = normalizedPath ? routeMap[normalizedPath] : null;
  const fallback = pullCfg.collections;
  const targetCollections = Array.isArray(configured) && configured.length > 0
    ? configured
    : fallback;
  return targetCollections.filter(collection => allowed.has(collection));
}
