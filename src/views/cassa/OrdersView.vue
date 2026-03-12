<template>
  <CassaOrderManager
    ref="orderManagerRef"
    @jump-to-cassa="handleOpenTable"
  />
</template>

<script setup>
import { ref, onMounted, nextTick } from 'vue';
import { useRouter } from 'vue-router';
import CassaOrderManager from '../../components/CassaOrderManager.vue';
import { useAppStore } from '../../store/index.js';

const store = useAppStore();
const router = useRouter();
const orderManagerRef = ref(null);

onMounted(async () => {
  // Handle cross-view navigation: open add-menu for a newly created order from SalaView
  if (store.pendingNewOrder) {
    const ord = store.pendingNewOrder;
    store.pendingNewOrder = null;
    await nextTick();
    if (orderManagerRef.value) {
      orderManagerRef.value.changeTab('pending');
      await nextTick();
      orderManagerRef.value.selectedOrder = ord;
      await nextTick();
      orderManagerRef.value.openAddMenu(ord);
    }
    return;
  }

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

async function handleOpenTable(tableId) {
  const table = store.config.tables.find(t => t.id === tableId);
  if (table) {
    store.pendingOpenTable = table;
    await router.push('/sala');
  }
}
</script>
