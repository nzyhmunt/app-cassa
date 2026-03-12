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
import { useAppStore } from '../../store/index.js';

const store = useAppStore();
const router = useRouter();
const tableManagerRef = ref(null);

onMounted(async () => {
  // Handle cross-view navigation: open a specific table if requested from OrdersView
  if (store.pendingOpenTable) {
    const table = store.pendingOpenTable;
    store.pendingOpenTable = null;
    await nextTick();
    tableManagerRef.value?.openTableDetails(table);
  }
});

async function handleOpenOrderFromTable(ord) {
  store.pendingSelectOrder = ord;
  await router.push('/ordini');
}

async function handleNewOrderForOrdini(ord) {
  store.pendingNewOrder = ord;
  await router.push('/ordini');
}
</script>
