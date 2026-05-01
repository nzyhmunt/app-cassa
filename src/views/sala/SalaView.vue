<template>
  <SalaTableManager
    ref="tableManagerRef"
    @new-order-for-comande="handleNewOrder"
    @view-order="handleViewOrder"
  />
</template>

<script setup>
import { ref, onMounted, nextTick } from 'vue';
import { useRouter } from 'vue-router';
import SalaTableManager from '../../components/SalaTableManager.vue';
import { useConfigStore, useOrderStore } from '../../store/index.js';

const configStore = useConfigStore();
const orderStore = useOrderStore();
const router = useRouter();
const tableManagerRef = ref(null);

onMounted(async () => {
  // Handle cross-view: open a specific table when navigating back from order view
  if (orderStore.pendingOpenTable) {
    const table = orderStore.pendingOpenTable;
    orderStore.pendingOpenTable = null;
    await nextTick();
    tableManagerRef.value?.openTableDetails(table);
  }
});

async function handleNewOrder(ord) {
  orderStore.pendingNewOrder = ord;
  await router.push('/comande');
}

async function handleViewOrder(ord) {
  orderStore.pendingSelectOrder = ord;
  await router.push('/comande');
}
</script>
