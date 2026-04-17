export function useSyncStoreProxy(configStore, orderStore) {
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
