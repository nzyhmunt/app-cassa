<template>
  <OrderManager
    ref="orderManagerRef"
    @jump-to-cassa="handleJumpToCassa"
    @open-add-menu="orderManagerRef.openAddMenu"
  />
</template>

<script setup>
import { ref, onMounted, nextTick } from 'vue';
import { useRouter } from 'vue-router';
import OrderManager from '../components/OrderManager.vue';
import { useAppStore } from '../store/index.js';

const store = useAppStore();
const router = useRouter();
const orderManagerRef = ref(null);

onMounted(async () => {
  // Handle cross-view navigation: select a specific order if requested from SalaView
  if (store.pendingSelectOrder) {
    const ord = store.pendingSelectOrder;
    store.pendingSelectOrder = null;
    await nextTick();
    if (orderManagerRef.value) {
      orderManagerRef.value.changeTab(ord.status);
      await nextTick();
      orderManagerRef.value.selectedOrder = ord;
    }
  }
});

async function handleJumpToCassa(tavoloLabel) {
  const table = store.config.tables.find(t => t.label === tavoloLabel);
  if (table) {
    store.pendingOpenTable = table;
    await router.push('/sala');
  }
}
</script>
