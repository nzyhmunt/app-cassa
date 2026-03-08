<template>
  <WaiterTableManager
    ref="tableManagerRef"
    @new-order-for-comande="handleNewOrder"
    @view-order="handleViewOrder"
  />
</template>

<script setup>
import { ref, onMounted, nextTick } from 'vue';
import { useRouter } from 'vue-router';
import WaiterTableManager from '../../components/WaiterTableManager.vue';
import { useAppStore } from '../../store/index.js';

const store = useAppStore();
const router = useRouter();
const tableManagerRef = ref(null);

onMounted(async () => {
  // Handle cross-view: open a specific table when navigating back from order view
  if (store.pendingOpenTable) {
    const table = store.pendingOpenTable;
    store.pendingOpenTable = null;
    await nextTick();
    tableManagerRef.value?.openTableDetails(table);
  }
});

async function handleNewOrder(ord) {
  store.pendingNewOrder = ord;
  await router.push('/comande');
}

async function handleViewOrder(ord) {
  store.pendingSelectOrder = ord;
  await router.push('/comande');
}
</script>
