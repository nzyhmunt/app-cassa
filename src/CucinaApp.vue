<template>
  <div
    id="app"
    class="h-full flex flex-col relative w-full"
    :style="configStore.cssVars"
    @click="auth.recordActivity()"
    @keydown="auth.recordActivity()"
    @touchstart.passive="onRootTouchStart"
    @touchend.passive="onRootTouchEnd"
  >
    <router-view @open-settings="showSettings = true" />
    <CucinaSettingsModal v-model="showSettings" />
    <PwaInstallBanner />
    <LockScreen />
  </div>
</template>

<script setup>
import { ref, onMounted, onUnmounted } from 'vue';
import { useConfigStore, useOrderStore } from './store/index.js';
import { useWakeLock } from './composables/useWakeLock.js';
import { resolveStorageKeys, getInstanceName } from './store/persistence.js';
import { useAuth } from './composables/useAuth.js';
import CucinaSettingsModal from './components/CucinaSettingsModal.vue';
import PwaInstallBanner from './components/shared/PwaInstallBanner.vue';
import LockScreen from './components/LockScreen.vue';
import { useDirectusSync } from './composables/useDirectusSync.js';
import { loadDirectusConfigFromStorage, directusEnabledRef } from './composables/useDirectusClient.js';
import { useSyncStoreProxy } from './composables/useSyncStoreProxy.js';

const configStore = useConfigStore();
const orderStore = useOrderStore();
const auth = useAuth();
const sync = useDirectusSync();
const showSettings = ref(false);
const syncStore = useSyncStoreProxy(configStore, orderStore);
const isSwipeRefreshing = ref(false);

const SWIPE_REFRESH_THRESHOLD_PX = 80;
let swipeStartY = 0;
let swipeStartedAtTop = false;

useWakeLock();

// Best-effort preload; full sync startup awaits config in restartSync().
loadDirectusConfigFromStorage().catch((e) => {
  console.warn('[CucinaApp] Failed to load Directus config from IDB:', e);
});

const { storageKey } = resolveStorageKeys(getInstanceName());

function onStorageChange(event) {
  if (event.key !== storageKey) return;
  void hydrateStateFromStorage();
}

async function hydrateStateFromStorage() {
  try {
    await Promise.all([
      configStore.hydrateConfigFromIDB(),
      orderStore.refreshOperationalStateFromIDB(),
    ]);
  } catch (error) {
    console.warn('[CucinaApp] Failed to hydrate state from storage event:', error);
  }
}

async function restartSync() {
  try {
    await loadDirectusConfigFromStorage();
  } catch (e) { console.warn('[CucinaApp] Failed to load Directus config from IDB:', e); }
  sync.stopSync();
  await sync.startSync({ appType: 'cucina', store: syncStore });
}

async function onDirectusConfigUpdated() {
  await restartSync();
}

function _canStartPullRefresh(target) {
  if (typeof window === 'undefined' || window.scrollY > 0) return false;
  let node = target instanceof Element ? target : null;
  while (node && node !== document.body) {
    const style = window.getComputedStyle(node);
    const overflowY = style?.overflowY ?? '';
    const isScrollable = /(auto|scroll|overlay)/.test(overflowY) && node.scrollHeight > node.clientHeight;
    if (isScrollable && node.scrollTop > 0) return false;
    node = node.parentElement;
  }
  return true;
}

async function _runSwipeRefresh() {
  if (isSwipeRefreshing.value) return;
  isSwipeRefreshing.value = true;
  try {
    if (directusEnabledRef.value) {
      await sync.reconfigureAndApply({ clearLocalConfig: false });
      await sync.forcePull();
    }
    await Promise.all([
      configStore.hydrateConfigFromIDB(),
      orderStore.refreshOperationalStateFromIDB(),
    ]);
  } catch (error) {
    console.warn('[CucinaApp] Swipe refresh failed:', error);
  } finally {
    isSwipeRefreshing.value = false;
  }
}

function onRootTouchStart(event) {
  auth.recordActivity();
  const touch = event.touches?.[0];
  if (!touch) return;
  swipeStartY = touch.clientY;
  swipeStartedAtTop = _canStartPullRefresh(event.target);
}

function onRootTouchEnd(event) {
  const touch = event.changedTouches?.[0];
  if (!touch || !swipeStartedAtTop || isSwipeRefreshing.value) return;
  const deltaY = touch.clientY - swipeStartY;
  if (deltaY < SWIPE_REFRESH_THRESHOLD_PX) return;
  void _runSwipeRefresh();
}

onMounted(async () => {
  window.addEventListener('storage', onStorageChange);
  window.addEventListener('directus-config-updated', onDirectusConfigUpdated);
  await restartSync();
});

onUnmounted(() => {
  window.removeEventListener('storage', onStorageChange);
  window.removeEventListener('directus-config-updated', onDirectusConfigUpdated);
  sync.stopSync();
});
</script>
