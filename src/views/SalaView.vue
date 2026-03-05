<template>
  <TableManager
    ref="tableManagerRef"
    @open-order-from-table="handleOpenOrderFromTable"
  />
</template>

<script setup>
import { ref, onMounted, nextTick } from 'vue';
import { useRouter } from 'vue-router';
import TableManager from '../components/TableManager.vue';
import { useAppStore } from '../store/index.js';

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
</script>
