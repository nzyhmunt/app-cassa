<template>
  <SalaOrderManager
    ref="orderManagerRef"
    @jump-to-sala="handleJumpToSala"
  />
</template>

<script setup>
import { ref, onMounted, nextTick } from 'vue';
import { useRouter } from 'vue-router';
import SalaOrderManager from '../../components/SalaOrderManager.vue';
import { useConfigStore, useOrderStore } from '../../store/index.js';

const configStore = useConfigStore();
const orderStore = useOrderStore();
const router = useRouter();
const orderManagerRef = ref(null);

onMounted(async () => {
  // Handle cross-view: open add-menu for a newly created order from SalaView
  if (orderStore.pendingNewOrder) {
    const ord = orderStore.pendingNewOrder;
    orderStore.pendingNewOrder = null;
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

  // Handle cross-view: select a specific order from SalaView
  if (orderStore.pendingSelectOrder) {
    const ord = orderStore.pendingSelectOrder;
    orderStore.pendingSelectOrder = null;
    await nextTick();
    if (orderManagerRef.value) {
      orderManagerRef.value.changeTab(ord.status === 'accepted' ? 'accepted' : 'pending');
      await nextTick();
      orderManagerRef.value.selectedOrder = ord;
    }
  }
});

async function handleJumpToSala(tableId) {
  const table = configStore.config.tables.find(t => t.id === tableId);
  if (table) {
    orderStore.pendingOpenTable = table;
    await router.push('/sala');
  }
}
</script>
