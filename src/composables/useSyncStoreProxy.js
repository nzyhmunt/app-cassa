export function useSyncStoreProxy(configStore, orderStore) {
  return new Proxy({}, {
    get(_target, prop) {
      if (prop in orderStore) return orderStore[prop];
      return configStore[prop];
    },
    set(_target, prop, value) {
      if (prop in orderStore) {
        orderStore[prop] = value;
        return true;
      }
      configStore[prop] = value;
      return true;
    },
  });
}
