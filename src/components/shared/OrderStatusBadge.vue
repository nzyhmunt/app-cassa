<template>
  <span
    v-if="status === 'pending'"
    class="bg-amber-100 text-amber-800 text-[9px] md:text-[10px] uppercase font-bold px-2 py-1 rounded-md border border-amber-200 flex items-center gap-1"
  ><AlertCircle class="size-3" /> In Attesa</span>
  <span
    v-else-if="status === 'accepted'"
    class="bg-amber-100 text-amber-800 text-[9px] md:text-[10px] uppercase font-bold px-2 py-1 rounded-md border border-amber-200 flex items-center gap-1"
  ><ChefHat class="size-3" /> In Cucina</span>
  <span
    v-else-if="status === 'preparing'"
    class="bg-blue-100 text-blue-800 text-[9px] md:text-[10px] uppercase font-bold px-2 py-1 rounded-md border border-blue-200 flex items-center gap-1"
  ><Flame class="size-3" /> In Cottura</span>
  <span
    v-else-if="status === 'ready'"
    class="bg-teal-100 text-teal-800 text-[9px] md:text-[10px] uppercase font-bold px-2 py-1 rounded-md border border-teal-200 flex items-center gap-1"
  ><BellRing class="size-3" /> Pronta 🔔</span>
  <span
    v-else-if="status === 'delivered'"
    class="bg-gray-100 text-gray-600 text-[9px] md:text-[10px] uppercase font-bold px-2 py-1 rounded-md border border-gray-200 flex items-center gap-1"
  ><CheckCircle2 class="size-3" /> Consegnata</span>
  <span
    v-else-if="status === 'completed'"
    class="bg-emerald-100 text-emerald-800 text-[9px] md:text-[10px] uppercase font-bold px-2 py-1 rounded-md border border-emerald-200 flex items-center gap-1"
  ><CheckCircle2 class="size-3" /> Pagato</span>
  <span
    v-else-if="status === 'rejected'"
    class="bg-red-100 text-red-800 text-[9px] md:text-[10px] uppercase font-bold px-2 py-1 rounded-md border border-red-200 flex items-center gap-1"
  ><XCircle class="size-3" /> Annullato</span>
</template>

<script setup>
import { AlertCircle, ChefHat, Flame, BellRing, CheckCircle2, XCircle } from 'lucide-vue-next';

defineProps({
  status: {
    type: String,
    required: true,
    validator: (v) => ['pending', 'accepted', 'preparing', 'ready', 'delivered', 'completed', 'rejected'].includes(v),
  },
});
</script>
