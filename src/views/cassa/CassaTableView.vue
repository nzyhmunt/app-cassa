<template>
  <CassaTableManager
    ref="tableManagerRef"
    @open-order-from-table="handleOpenOrderFromTable"
    @new-order-for-ordini="handleNewOrderForOrdini"
  />
</template>

<script setup>
import { ref, onMounted, nextTick } from 'vue';
import { useRouter } from 'vue-router';
import CassaTableManager from '../../components/CassaTableManager.vue';
import { useConfigStore, useOrderStore } from '../../store/index.js';

const configStore = useConfigStore();
const orderStore = useOrderStore();
const router = useRouter();
const tableManagerRef = ref(null);

onMounted(async () => {
  // Handle cross-view navigation: open a specific table if requested from OrdersView
  if (orderStore.pendingOpenTable) {
    const table = orderStore.pendingOpenTable;
    orderStore.pendingOpenTable = null;
    await nextTick();
    tableManagerRef.value?.openTableDetails(table);
  }
});

async function handleOpenOrderFromTable(ord) {
  orderStore.pendingSelectOrder = ord;
  await router.push('/ordini');
}

async function handleNewOrderForOrdini(ord) {
  orderStore.pendingNewOrder = ord;
  await router.push('/ordini');
}
</script>
