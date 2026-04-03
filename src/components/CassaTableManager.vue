<template>
  <!-- WORKSPACE: MAPPA SALA -->
  <div class="flex-1 flex flex-col bg-gray-100/80 overflow-y-auto p-4 md:p-8 relative min-h-0">
    <div class="max-w-6xl mx-auto w-full">
      <div class="flex flex-col sm:flex-row sm:justify-between sm:items-start gap-2 mb-4 md:mb-6">
        <h2 class="text-xl md:text-2xl font-black text-gray-800 flex items-center gap-2 md:gap-3">
          <Grid3x3 class="text-gray-500 size-6 md:size-8" /> Mappa Sala
        </h2>
        <div class="flex items-center gap-3">
          <!-- Storico Conti button -->
          <router-link
            to="/storico-conti"
            class="flex items-center gap-1.5 text-[10px] md:text-xs font-bold text-emerald-700 bg-emerald-50 hover:bg-emerald-100 border border-emerald-200 px-3 py-2 rounded-xl transition-colors shadow-sm active:scale-95"
            title="Cronologia Conti Chiusi"
            aria-label="Storico Conti"
          >
            <History class="size-4" /> <span class="hidden sm:inline">Storico Conti</span>
          </router-link>
          <!-- Legenda -->
          <div class="flex flex-wrap items-center gap-x-3 gap-y-1 text-[10px] font-bold uppercase text-gray-500">
            <span class="flex items-center gap-1"><span class="size-3 rounded-full border-2 border-emerald-400 bg-emerald-100"></span> Libero</span>
            <span class="flex items-center gap-1"><span class="size-3 rounded-full border-2 border-amber-400 bg-amber-100"></span> Ordini in Attesa</span>
            <span class="flex items-center gap-1"><span class="size-3 rounded-full border-2 border-blue-400 bg-blue-100"></span> Conto Richiesto</span>
            <span class="flex items-center gap-1"><span class="size-3 rounded-full theme-bg border-2 border-white shadow-sm"></span> Occupato / In Cassa</span>
          </div>
        </div>
      </div>

      <!-- Riepilogo stato tavoli -->
      <TableStatsBar
        :freeCount="freeTablesCount"
        :occupiedCount="occupiedTablesCount"
        :pendingCount="pendingTablesCount"
      />

      <!-- Griglia Tavoli -->
      <TableGrid @open-table="openTableDetails">
        <template #status="{ table }">
          <span class="block text-[8px] md:text-[10px] font-bold uppercase tracking-widest opacity-80 mb-0.5 md:mb-1 truncate">
            {{ store.getTableStatus(table.id).status === 'pending' ? 'Attesa' : store.getTableStatus(table.id).status === 'conto_richiesto' ? 'Conto!' : 'In Cassa' }}
          </span>
          <span class="block font-black text-sm md:text-lg bg-white/20 rounded-md md:rounded-lg py-0.5 px-1 truncate">
            {{ store.config.ui.currency }}{{ store.getTableStatus(table.id).remaining.toFixed(2) }}
          </span>
        </template>
      </TableGrid>

      <!-- Riepilogo Conti Chiusi -->
      <CassaClosedBillsList />
    </div>
  </div>

  <!-- ================================================================ -->
  <!-- MODAL: GESTIONE TAVOLO IN CASSA E PAGAMENTI                      -->
  <!-- ================================================================ -->
  <div v-if="showTableModal && selectedTable" class="fixed inset-0 z-[60] bg-black/70 backdrop-blur-sm flex items-end md:items-center justify-center p-0 md:p-4">
    <div class="bg-white rounded-t-3xl md:rounded-3xl shadow-2xl w-full max-w-6xl h-[95dvh] md:h-[90dvh] flex flex-col overflow-hidden">

      <div class="bg-gray-900 text-white p-3 md:p-5 flex justify-between items-center shrink-0">
        <div class="flex items-center gap-3">
          <div class="size-10 md:size-12 rounded-full bg-white/10 flex items-center justify-center font-black text-lg md:text-xl">{{ selectedTable.label }}</div>
          <div>
            <h3 class="font-bold text-base md:text-xl leading-tight">Cassa Tavolo</h3>
            <p class="text-white/60 text-[10px] md:text-xs">Ordini totali collegati: {{ tableOrders.length }}</p>
          </div>
        </div>
        <div class="flex items-center gap-1 md:gap-3">
          <!-- Conto Richiesto button -->
          <button v-if="tableOrders.some(o => o.status === 'accepted')"
            @click="toggleBillRequested"
            :class="store.billRequestedTables.has(selectedTable.id) ? 'bg-blue-500 text-white' : 'bg-white/10 hover:bg-white/20 text-white'"
            class="p-2 sm:px-3 sm:py-2 rounded-xl font-bold text-[10px] md:text-xs flex items-center gap-1.5 transition-all active:scale-95 shrink-0"
            :title="store.billRequestedTables.has(selectedTable.id) ? 'Conto richiesto' : 'Segna Conto Richiesto'"
            :aria-label="store.billRequestedTables.has(selectedTable.id) ? 'Conto richiesto' : 'Segna conto richiesto'"
            :aria-pressed="store.billRequestedTables.has(selectedTable.id)">
            <Receipt class="size-4" /> <span class="hidden sm:inline">Conto</span>
          </button>
          <!-- Sposta button -->
          <button v-if="tableOrders.length > 0" @click="openMoveModal"
            class="bg-white/10 hover:bg-white/20 p-2 sm:px-3 sm:py-2 rounded-xl font-bold text-[10px] md:text-xs flex items-center gap-1.5 transition-all active:scale-95 shrink-0"
            title="Sposta Tavolo">
            <ArrowRightLeft class="size-4" /> <span class="hidden sm:inline">Sposta</span>
          </button>
          <!-- Unisci button -->
          <button v-if="tableOrders.length > 0" @click="openMergeModal"
            class="bg-white/10 hover:bg-white/20 p-2 sm:px-3 sm:py-2 rounded-xl font-bold text-[10px] md:text-xs flex items-center gap-1.5 transition-all active:scale-95 shrink-0"
            title="Unisci con altro Tavolo">
            <Merge class="size-4" /> <span class="hidden sm:inline">Unisci</span>
          </button>
          <!-- Storico Conti button -->
          <router-link
            to="/storico-conti"
            @click="closeTableModal"
            class="bg-white/10 hover:bg-white/20 p-2 sm:px-3 sm:py-2 rounded-xl font-bold text-[10px] md:text-xs flex items-center gap-1.5 transition-all active:scale-95 shrink-0 text-white"
            title="Cronologia Conti Chiusi"
            aria-label="Storico"
          >
            <History class="size-4" /> <span class="hidden sm:inline">Storico</span>
          </router-link>
          <button @click="closeTableModal" class="bg-white/10 hover:bg-white/20 p-2 md:p-2.5 rounded-full transition-colors active:scale-95"><X class="size-5 md:size-6" /></button>
        </div>
      </div>

      <div class="flex flex-1 min-h-0 flex-col sm:flex-row">

        <!-- PANNELLO SINISTRO: Riepilogo Comande e Storni dalla Cassa -->
        <div class="w-full sm:w-[55%] border-b sm:border-b-0 sm:border-r border-gray-200 bg-gray-50 flex flex-col h-[42%] shrink-0 overflow-hidden sm:h-auto sm:shrink sm:flex-1">
          <div class="p-2 lg:p-3 bg-white border-b border-gray-200 shrink-0 flex items-center gap-1.5 overflow-hidden">
            <span class="hidden lg:block font-bold text-gray-700 text-xs uppercase tracking-wider shrink-0">Riepilogo Voci</span>
            <!-- Vista switch (inline in header) — hidden in analitica/ordini mode -->
            <div v-if="checkoutMode !== 'analitica' && checkoutMode !== 'ordini'" class="flex bg-gray-100 p-0.5 rounded-xl gap-0.5 flex-1 min-w-0">
              <button @click="cassaViewMode = 'voce'"
                :class="cassaViewMode === 'voce' ? 'bg-white shadow text-gray-900 border border-gray-200' : 'text-gray-500 hover:bg-gray-200/50'"
                aria-label="Vista per voce"
                class="flex-1 py-1 px-1.5 text-[9px] font-bold rounded-lg transition-all active:scale-95 flex items-center justify-center gap-1 min-w-0">
                <LayoutGrid class="size-3 shrink-0" /> <span class="hidden sm:inline">Per Voce</span>
              </button>
              <button @click="cassaViewMode = 'ordine'"
                :class="cassaViewMode === 'ordine' ? 'bg-white shadow text-gray-900 border border-gray-200' : 'text-gray-500 hover:bg-gray-200/50'"
                aria-label="Vista per ordine"
                class="flex-1 py-1 px-1.5 text-[9px] font-bold rounded-lg transition-all active:scale-95 flex items-center justify-center gap-1 min-w-0">
                <ListOrdered class="size-3 shrink-0" /> <span class="hidden sm:inline">Per Ordine</span>
              </button>
            </div>
            <!-- Comanda mode header: selection hint -->
            <div v-else-if="checkoutMode === 'ordini'" class="flex-1 min-w-0 flex items-center gap-1.5 text-[10px] font-bold text-purple-600 bg-purple-50 border border-purple-200 px-2 py-1.5 rounded-xl overflow-hidden">
              <ListChecks class="size-3.5 shrink-0" /> <span class="truncate hidden sm:inline">Tocca per selezionare</span>
            </div>
            <!-- Analitica mode header: select-all toggle -->
            <button
              v-else-if="flatAnaliticaItems.length > 0"
              @click="toggleSelectAllVoci"
              class="flex-1 min-w-0 text-[10px] font-bold text-teal-700 bg-teal-50 border border-teal-200 px-2 py-1.5 rounded-xl hover:bg-teal-100 active:scale-95 transition-all truncate"
            >{{ flatAnaliticaItems.every(i => (analiticaQty[i.key] || 0) === i.netQty) ? 'Deseleziona' : 'Seleziona Tutto' }}</button>
            <div v-else class="flex-1 min-w-0"></div>
            <button @click="openDirectItemModal" aria-label="Aggiungi voce diretta" class="theme-bg hover:opacity-90 text-white px-2 py-1.5 lg:px-3 lg:py-2 rounded-lg text-xs font-bold flex items-center gap-1 active:scale-95 shadow-sm transition-opacity shrink-0" title="Aggiungi voci direttamente al conto senza passare per la cucina">
              <Zap class="size-3.5 lg:size-4 shrink-0" /> <span class="hidden lg:inline">Diretto</span>
            </button>
            <button @click="createNewOrderForTable" aria-label="Crea nuova comanda" class="bg-gray-900 hover:bg-black text-white px-2 py-1.5 lg:px-3 lg:py-2 rounded-lg text-xs font-bold flex items-center gap-1 active:scale-95 shadow-sm transition-colors shrink-0">
              <Plus class="size-3.5 lg:size-4 shrink-0" /> <span class="hidden lg:inline">Comanda</span>
            </button>
          </div>

          <!-- ══ ANALITICA MODE: per-item steppers in left panel ══════════════ -->
          <div v-if="checkoutMode === 'analitica'" class="flex-1 overflow-y-auto p-2 md:p-4">
            <div v-if="flatAnaliticaItems.length === 0" class="text-center text-gray-400 py-8">
              <Coffee class="size-10 mx-auto mb-2 opacity-30" />
              <p class="text-sm font-medium">Nessuna voce disponibile o da pagare.</p>
            </div>
            <div v-else class="bg-white rounded-xl border border-gray-200 shadow-sm overflow-hidden">
              <template v-for="voce in flatAnaliticaItems" :key="'av_'+voce.key">
                <!-- Modifier sub-row (indented, purple) -->
                <div
                  v-if="voce.isModifier"
                  class="flex items-center pl-10 pr-3 py-2 gap-2 bg-purple-50/40 border-b border-gray-100 last:border-0"
                  :class="voce.netQty <= 0 ? 'opacity-40' : ''"
                >
                  <div class="flex items-center gap-2 flex-1 min-w-0">
                    <span class="font-bold w-6 shrink-0 text-center text-[10px] text-purple-600">{{ voce.netQty }}x</span>
                    <span class="text-[10px] md:text-xs font-bold text-purple-700 truncate">
                      + {{ voce.name }} (+{{ store.config.ui.currency }}{{ voce.unitPrice.toFixed(2) }})
                    </span>
                  </div>
                  <div class="flex items-center gap-0.5 shrink-0">
                    <button @click="decrementAnalitica(voce.key)"
                      :aria-label="`Diminuisci ${voce.name}`"
                      :disabled="(analiticaQty[voce.key] || 0) === 0"
                      class="p-1 bg-white border border-purple-200 text-purple-600 hover:bg-purple-50 rounded shadow-sm transition-colors active:scale-95 disabled:opacity-30">
                      <Minus class="size-3" />
                    </button>
                    <span class="w-5 text-center text-xs font-black text-purple-800 tabular-nums">{{ analiticaQty[voce.key] || 0 }}</span>
                    <button @click="incrementAnalitica(voce.key, voce.netQty)"
                      :aria-label="`Aumenta ${voce.name}`"
                      :disabled="(analiticaQty[voce.key] || 0) >= voce.netQty"
                      class="p-1 bg-white border border-purple-200 text-purple-600 hover:bg-purple-50 rounded shadow-sm transition-colors active:scale-95 disabled:opacity-30">
                      <Plus class="size-3" />
                    </button>
                  </div>
                  <span class="font-black text-[11px] text-purple-700 shrink-0 w-10 text-right">
                    {{ store.config.ui.currency }}{{ ((analiticaQty[voce.key] || 0) * voce.unitPrice).toFixed(2) }}
                  </span>
                </div>

                <!-- Base item row -->
                <div
                  v-else
                  class="flex items-center justify-between px-3 py-2.5 gap-2 border-b border-gray-100 last:border-0"
                  :class="voce.netQty <= 0 ? 'opacity-40' : ''"
                >
                  <div class="flex items-center gap-2 flex-1 min-w-0">
                    <span class="font-black w-7 shrink-0 text-center text-[11px] md:text-sm text-gray-700">{{ voce.netQty }}x</span>
                    <div class="flex flex-col min-w-0">
                      <span class="font-bold text-gray-800 text-xs md:text-sm truncate flex items-center gap-1">
                        {{ voce.name }}
                        <Zap v-if="voce.isDirectEntry" class="size-2.5 theme-text shrink-0" title="Voce Diretta" />
                      </span>
                      <span class="text-[10px] text-gray-400 font-medium">{{ store.config.ui.currency }}{{ voce.unitPrice.toFixed(2) }}/cad</span>
                    </div>
                  </div>
                  <div class="flex items-center gap-1 shrink-0">
                    <button @click="decrementAnalitica(voce.key)"
                      :aria-label="`Diminuisci quantità di ${voce.name}`"
                      :disabled="(analiticaQty[voce.key] || 0) === 0"
                      class="p-1.5 bg-white border border-teal-200 text-teal-600 hover:bg-teal-50 rounded shadow-sm transition-colors active:scale-95 disabled:opacity-30">
                      <Minus class="size-4" />
                    </button>
                    <span class="w-6 text-center text-sm font-black text-teal-800 tabular-nums">{{ analiticaQty[voce.key] || 0 }}</span>
                    <button @click="incrementAnalitica(voce.key, voce.netQty)"
                      :aria-label="`Aumenta quantità di ${voce.name}`"
                      :disabled="(analiticaQty[voce.key] || 0) >= voce.netQty"
                      class="p-1.5 bg-white border border-teal-200 text-teal-600 hover:bg-teal-50 rounded shadow-sm transition-colors active:scale-95 disabled:opacity-30">
                      <Plus class="size-4" />
                    </button>
                    <span class="font-black text-[12px] md:text-sm shrink-0 w-12 text-right" :class="(analiticaQty[voce.key] || 0) > 0 ? 'text-teal-700' : 'text-gray-300'">
                      {{ store.config.ui.currency }}{{ ((analiticaQty[voce.key] || 0) * voce.unitPrice).toFixed(2) }}
                    </span>
                  </div>
                </div>
              </template>
            </div>
          </div>

          <!-- ══ VISTA: PER VOCE (menu raggruppato) ══════════════════════════ -->
          <div v-else-if="cassaViewMode === 'voce'" class="flex-1 overflow-y-auto p-2 md:p-4">
            <div v-if="tableMenuGrouped.length === 0" class="text-center text-gray-400 py-8">
              <Coffee class="size-10 mx-auto mb-2 opacity-30" />
              <p class="text-sm font-medium">{{ tableOrders.length === 0 ? 'Il tavolo è libero.' : 'Nessuna comanda ancora accettata.' }}</p>
            </div>

            <div v-else class="bg-white rounded-xl border border-gray-200 shadow-sm overflow-hidden">
              <div v-for="(dish, di) in tableMenuGrouped" :key="dish.name"
                class="border-b border-gray-100 last:border-0">
                <!-- Riga voce principale -->
                <div class="flex items-center justify-between px-3 py-2.5 gap-2"
                  :class="dish.totalQty - dish.totalVoided <= 0 ? 'opacity-40' : ''">
                  <div class="flex items-center gap-2 flex-1 min-w-0">
                    <span class="font-black w-7 shrink-0 text-center text-[11px] md:text-sm"
                      :class="dish.totalQty - dish.totalVoided <= 0 ? 'text-gray-400 line-through' : 'text-gray-700'">
                      {{ dish.totalQty - dish.totalVoided }}x
                    </span>
                    <div class="flex flex-col min-w-0">
                      <span class="font-bold text-gray-800 text-xs md:text-sm truncate"
                        :class="{'line-through text-gray-500': dish.totalQty - dish.totalVoided <= 0}">
                        {{ dish.name }}
                      </span>
                      <div class="flex items-center gap-1.5">
                        <span v-if="dish.totalVoided > 0" class="text-[8px] text-red-500 font-bold uppercase">-{{ dish.totalVoided }} storn.</span>
                        <span v-if="dish.hasDirectEntry" class="text-[8px] theme-text font-bold uppercase flex items-center gap-0.5"><Zap class="size-2.5" /> Diretta</span>
                      </div>
                    </div>
                  </div>
                  <span class="font-black text-[12px] md:text-sm text-gray-800 shrink-0">
                    {{ store.config.ui.currency }}{{ dish.totalSubtotal.toFixed(2) }}
                  </span>
                </div>

                <!-- Righe variazioni (modificatori a pagamento) -->
                <div v-if="dish.modifiers.length > 0" class="pb-1">
                  <div v-for="mod in dish.modifiers" :key="mod.name + '::' + mod.price"
                    class="flex items-center pl-10 pr-3 py-1.5 gap-2 bg-purple-50/40"
                    :class="mod.qty - mod.voided <= 0 ? 'opacity-40' : ''">
                    <div class="flex items-center gap-2 flex-1 min-w-0">
                      <span class="font-bold w-6 shrink-0 text-center text-[10px] text-purple-600"
                        :class="mod.qty - mod.voided <= 0 ? 'line-through text-gray-400' : ''">
                        {{ mod.qty - mod.voided }}x
                      </span>
                      <span class="text-[10px] md:text-xs font-bold text-purple-700 truncate"
                        :class="{'line-through text-gray-400': mod.qty - mod.voided <= 0}">
                        + {{ mod.name }}{{ mod.price > 0 ? ' (+' + store.config.ui.currency + mod.price.toFixed(2) + ')' : '' }}
                      </span>
                      <span v-if="mod.modVoided > 0" class="text-[8px] text-red-500 font-bold uppercase">-{{ mod.modVoided }}</span>
                    </div>
                  </div>
                </div>
              </div>
            </div>
          </div>

          <!-- ══ VISTA: PER ORDINE (comande singole) ════════════════════════ -->
          <div v-else class="flex-1 overflow-y-auto p-2 md:p-4 space-y-3">
            <div v-if="tableOrders.length === 0" class="text-center text-gray-400 py-8">
              <Coffee class="size-10 mx-auto mb-2 opacity-30" />
              <p class="text-sm font-medium">Il tavolo è libero.</p>
            </div>

            <!-- Card Singolo Ordine (Mappa Cassa) -->
            <div v-for="ord in tableOrders" :key="'cas_'+ord.id"
              class="bg-white p-3 rounded-xl border shadow-sm relative overflow-hidden group transition-all"
              :class="[
                checkoutMode === 'ordini' && KITCHEN_ACTIVE_STATUSES.includes(ord.status)
                  ? selectedOrdersToPay.includes(ord.id)
                    ? 'border-purple-400 bg-purple-50/40 ring-2 ring-purple-300 cursor-pointer'
                    : 'border-purple-200 hover:border-purple-300 hover:bg-purple-50/20 cursor-pointer'
                  : ord.status === 'pending' ? 'border-amber-200 bg-amber-50/30' : 'border-gray-200'
              ]"
              @click="checkoutMode === 'ordini' && KITCHEN_ACTIVE_STATUSES.includes(ord.status) && !$event.target.closest('button, a, input, select, textarea, label') ? toggleOrderSelection(ord.id) : null"
            >

              <div class="flex justify-between items-center border-b border-gray-100 pb-2 mb-3 pl-1">
                <div class="flex items-center gap-3">
                  <!-- Comanda mode: selection checkbox indicator -->
                  <div v-if="checkoutMode === 'ordini' && KITCHEN_ACTIVE_STATUSES.includes(ord.status)"
                    class="size-7 rounded-full border-2 flex items-center justify-center shrink-0 transition-all"
                    :class="selectedOrdersToPay.includes(ord.id)
                      ? 'border-purple-500 bg-purple-500 text-white'
                      : 'border-purple-300 bg-white text-transparent'">
                    <CheckCircle class="size-4" />
                  </div>
                  <button v-else-if="ord.status === 'pending'" @click.stop="$emit('open-order-from-table', ord)" class="p-2 md:p-2.5 text-[var(--brand-primary)] bg-[var(--brand-primary)]/10 hover:bg-[var(--brand-primary)]/20 border border-[var(--brand-primary)]/20 rounded-xl transition-all active:scale-95 flex items-center justify-center shadow-sm shrink-0" title="Modifica in vista Ordini">
                    <Edit class="size-5" />
                  </button>
                  <div class="flex flex-col">
                    <span class="font-bold text-gray-800 text-sm md:text-base flex items-center gap-1">Ord #{{ ord.id.substring(0,6) }}</span>
                    <span v-if="ord.isDirectEntry" class="text-[9px] md:text-[10px] font-bold uppercase theme-text flex items-center gap-1 mt-0.5"><Zap class="size-3 md:size-3.5" /> Voce Diretta (In Cassa)</span>
                    <span v-else-if="ord.status === 'pending'" class="text-[9px] md:text-[10px] font-bold uppercase text-amber-600 flex items-center gap-1 mt-0.5"><AlertTriangle class="size-3 md:size-3.5" /> In Attesa (Escluso Cassa)</span>
                    <span v-else class="text-[9px] md:text-[10px] font-bold uppercase text-emerald-600 flex items-center gap-1 mt-0.5"><CheckCircle class="size-3 md:size-3.5" /> In Cucina (Calcolato in Cassa)</span>
                  </div>
                </div>
                <div class="text-right">
                  <span class="font-black text-lg md:text-xl" :class="checkoutMode === 'ordini' && selectedOrdersToPay.includes(ord.id) ? 'text-purple-700' : ord.status === 'pending' ? 'text-amber-700' : 'theme-text'">{{ store.config.ui.currency }}{{ ord.totalAmount.toFixed(2) }}</span>
                </div>
              </div>

              <!-- Voci dell'Ordine con Storni (Cassa) -->
              <div class="pl-1 space-y-0.5">
                <div v-for="(item, idx) in ord.orderItems" :key="item.uid" class="flex flex-col py-1.5 border-b border-gray-50 last:border-0" :class="{'opacity-50': item.voidedQuantity === item.quantity}">
                  <div class="flex items-center justify-between text-sm gap-2">
                    <div class="flex items-center gap-2 flex-1 min-w-0">
                      <span class="font-bold w-6 shrink-0 text-center text-[11px] md:text-sm" :class="item.voidedQuantity === item.quantity ? 'text-gray-400 line-through' : 'text-gray-700'">{{item.quantity - (item.voidedQuantity || 0)}}x</span>
                      <div class="flex flex-col min-w-0">
                        <div class="flex items-center gap-1">
                          <span class="font-bold text-gray-800 leading-tight truncate text-xs md:text-sm" :class="{'line-through text-gray-500': item.voidedQuantity === item.quantity}">{{item.name}}</span>
                          <span v-if="(item.voidedQuantity || 0) > 0" class="text-[8px] md:text-[9px] text-red-500 font-bold uppercase tracking-widest border border-red-200 bg-red-50 px-1 rounded shrink-0">-{{item.voidedQuantity}} Storn.</span>
                        </div>
                      </div>
                    </div>
                    <div class="flex items-center gap-2 shrink-0">
                      <span class="font-black text-[13px] md:text-sm" :class="item.voidedQuantity === item.quantity ? 'text-gray-400 line-through' : 'text-gray-800'">
                        {{ store.config.ui.currency }}{{getOrderItemRowTotal(item).toFixed(2)}}
                      </span>
                      <div v-if="ord.status === 'accepted'" class="flex items-center gap-1 ml-1">
                        <button @click="store.voidOrderItems(ord, idx, 1)" :disabled="item.quantity - (item.voidedQuantity || 0) <= 0" class="p-1.5 bg-white border border-orange-200 text-orange-500 hover:bg-orange-50 rounded shadow-sm transition-colors active:scale-95 disabled:opacity-30" title="Storna dal conto">
                          <Ban class="size-4 md:size-4" />
                        </button>
                        <button @click="store.restoreOrderItems(ord, idx, 1)" :disabled="(item.voidedQuantity || 0) <= 0" class="p-1.5 bg-white border border-blue-200 text-blue-500 hover:bg-blue-50 rounded shadow-sm transition-colors active:scale-95 disabled:opacity-30" title="Ripristina nel conto">
                          <Undo2 class="size-4 md:size-4" />
                        </button>
                      </div>
                    </div>
                  </div>
                  <!-- Variazioni a pagamento (per ordine) con storni -->
                  <div v-if="item.modifiers && item.modifiers.some(m => m.price > 0)" class="mt-1 ml-8 space-y-0.5">
                    <template v-for="(mod, modIdx) in item.modifiers" :key="'mod_'+item.uid+'_'+modIdx+'_'+mod.name+'_'+mod.price">
                      <div v-if="mod.price > 0"
                        class="flex items-center justify-between py-1 pl-2 pr-1 rounded bg-purple-50/60 border border-purple-100"
                        :class="item.quantity - (item.voidedQuantity || 0) - (mod.voidedQuantity || 0) <= 0 ? 'opacity-40' : ''">
                        <div class="flex items-center gap-1.5 flex-1 min-w-0">
                          <span class="font-bold text-[9px] text-purple-500"
                            :class="item.quantity - (item.voidedQuantity || 0) - (mod.voidedQuantity || 0) <= 0 ? 'line-through text-gray-400' : ''">
                            {{ Math.max(0, item.quantity - (item.voidedQuantity || 0) - (mod.voidedQuantity || 0)) }}x
                          </span>
                          <span class="text-[9px] md:text-[10px] font-bold text-purple-700 truncate"
                            :class="{'line-through text-gray-400': item.quantity - (item.voidedQuantity || 0) - (mod.voidedQuantity || 0) <= 0}">
                            + {{ mod.name }} (+{{ store.config.ui.currency }}{{ mod.price.toFixed(2) }})
                          </span>
                          <span v-if="(mod.voidedQuantity || 0) > 0" class="text-[8px] text-red-500 font-bold uppercase shrink-0">-{{ mod.voidedQuantity }}</span>
                        </div>
                        <div v-if="ord.status === 'accepted'" class="flex items-center gap-0.5 shrink-0">
                          <button @click="store.voidModifier(ord, idx, modIdx, 1)"
                            :disabled="item.quantity - (item.voidedQuantity || 0) - (mod.voidedQuantity || 0) <= 0"
                            class="p-1 bg-white border border-orange-200 text-orange-500 hover:bg-orange-50 rounded shadow-sm transition-colors active:scale-95 disabled:opacity-30"
                            title="Storna questa variazione">
                            <Ban class="size-3" />
                          </button>
                          <button @click="store.restoreModifier(ord, idx, modIdx, 1)"
                            :disabled="(mod.voidedQuantity || 0) <= 0"
                            class="p-1 bg-white border border-blue-200 text-blue-500 hover:bg-blue-50 rounded shadow-sm transition-colors active:scale-95 disabled:opacity-30"
                            title="Ripristina questa variazione">
                            <Undo2 class="size-3" />
                          </button>
                        </div>
                      </div>
                    </template>
                  </div>
                </div>
              </div>
            </div>
          </div>
        </div>

        <!-- PANNELLO DESTRA: Area Checkout e Transazioni -->
        <div class="w-full sm:w-[45%] bg-white flex flex-col relative z-20 shadow-[0_-10px_20px_rgba(0,0,0,0.05)] sm:shadow-none flex-1 min-h-0">

          <div class="p-2 sm:p-3 md:p-5 flex-1 overflow-y-auto">
            <div class="flex justify-between items-center mb-1">
              <h4 class="font-bold text-gray-400 uppercase tracking-widest text-[10px] flex items-center gap-1">Da Pagare <span class="hidden sm:inline bg-gray-200 text-gray-600 px-1.5 rounded-full text-[9px] uppercase">Netto</span></h4>
              <button @click="generateTableCheckoutJson('info')" class="text-blue-600 font-bold text-[10px] uppercase tracking-wider flex items-center gap-1.5 bg-blue-50 hover:bg-blue-100 p-1.5 sm:px-2.5 sm:py-1.5 rounded-lg border border-blue-200 transition-colors active:scale-95">
                <Code class="size-3.5" /> <span class="hidden sm:inline">JSON</span>
              </button>
            </div>

            <!-- Cifra Cassa Dinamica -->
            <div class="mb-1">
              <div v-if="tableTransactions.length > 0" class="text-[10px] font-bold text-gray-400 uppercase tracking-wider">Totale: <span class="text-gray-600">{{ store.config.ui.currency }}{{ tableTotalAmount.toFixed(2) }}</span></div>
              <div class="text-3xl sm:text-4xl md:text-5xl lg:text-6xl font-black text-gray-900 leading-none">{{ store.config.ui.currency }}{{ tableAmountRemaining.toFixed(2) }}</div>
            </div>

            <!-- Storico Transazioni -->
            <div v-if="tableTransactions.length > 0" class="mb-3 space-y-1.5">
              <h5 class="text-[10px] font-bold text-gray-400 uppercase tracking-wider border-b border-gray-100 pb-0.5">Pagamenti:</h5>
              <div v-for="(txn, tIdx) in tableTransactions" :key="txn.transactionId"
                class="rounded-xl border overflow-hidden shadow-sm"
                :class="txn.operationType === 'discount' ? 'border-amber-200' : 'border-emerald-200'">
                <!-- Main row -->
                <div class="flex items-center justify-between px-3 py-2.5"
                  :class="txn.operationType === 'discount' ? 'bg-amber-50' : 'bg-emerald-50'">
                  <div class="flex items-center gap-2 min-w-0">
                    <div class="size-7 rounded-lg flex items-center justify-center shrink-0"
                      :class="txn.operationType === 'discount' ? 'bg-amber-200 text-amber-700' : 'bg-emerald-200 text-emerald-700'">
                      <Tag v-if="txn.operationType === 'discount'" class="size-3.5" />
                      <component v-else :is="getPaymentIcon(txn.paymentMethod)" class="size-3.5" />
                    </div>
                    <div class="flex flex-col min-w-0">
                      <span class="text-xs font-black uppercase tracking-wide"
                        :class="txn.operationType === 'discount' ? 'text-amber-800' : 'text-emerald-800'">
                        {{ txn.operationType === 'discount' ? 'Sconto' : txn.paymentMethod }}
                      </span>
                      <span class="text-[9px] font-medium"
                        :class="txn.operationType === 'discount' ? 'text-amber-600' : 'text-emerald-600'">
                        <template v-if="txn.operationType === 'romana'">Quota {{ txn.splitQuota }}/{{ txn.splitWays }}<template v-if="(txn.romanaSplitCount || 1) > 1"> · {{ txn.romanaSplitCount }} quote</template></template>
                        <template v-else-if="txn.operationType === 'discount'">{{ txn.discountType === 'percent' ? txn.discountValue + '%' : store.config.ui.currency + (txn.discountValue ?? 0).toFixed(2) }}</template>
                        <template v-else-if="txn.operationType === 'ordini'">Per Comanda</template>
                        <template v-else-if="txn.operationType === 'analitica'">Analitica</template>
                      </span>
                    </div>
                  </div>
                  <div class="text-right shrink-0">
                    <span class="font-black text-sm"
                      :class="txn.operationType === 'discount' ? 'text-amber-800' : 'text-emerald-800'">
                      <span v-if="txn.operationType === 'discount'">-</span>{{ store.config.ui.currency }}{{ txn.amountPaid.toFixed(2) }}
                    </span>
                  </div>
                </div>
                <!-- Secondary details row (change / tip / time) -->
                <div class="flex items-center justify-between px-3 py-1.5 bg-white border-t"
                  :class="txn.operationType === 'discount' ? 'border-amber-100' : 'border-emerald-100'">
                  <span class="text-[9px] font-medium text-gray-400">
                    {{ new Date(txn.timestamp).toLocaleTimeString(appConfig.locale, { hour: '2-digit', minute: '2-digit', timeZone: appConfig.timezone }) }}
                  </span>
                  <div class="flex items-center gap-2 text-[9px] font-bold">
                    <span v-if="txn.grossAmount" class="text-gray-500">Consegnato {{ store.config.ui.currency }}{{ txn.grossAmount.toFixed(2) }}</span>
                    <span v-if="txn.changeAmount" class="text-blue-600">Resto -{{ store.config.ui.currency }}{{ txn.changeAmount.toFixed(2) }}</span>
                    <span v-if="txn.tipAmount" class="text-purple-600">+{{ store.config.ui.currency }}{{ txn.tipAmount.toFixed(2) }} mancia</span>
                  </div>
                </div>
              </div>
            </div>
            <div v-else class="mb-1"></div>

            <!-- Sconto (Discount) — collapsible toggle -->
            <div v-if="discountsEnabled && tableAmountRemaining > 0 && isAdmin" class="mb-2">
              <button @click="discountExpanded = !discountExpanded"
                class="w-full flex items-center justify-between px-2 py-1.5 text-amber-700 bg-amber-50 hover:bg-amber-100 rounded-lg border border-amber-200 transition-colors text-[10px] font-bold">
                <span class="flex items-center gap-1.5"><Tag class="size-3 shrink-0" /> Applica Sconto</span>
                <ChevronDown :class="discountExpanded ? 'rotate-180' : ''" class="size-3.5 transition-transform shrink-0" />
              </button>
              <div v-if="discountExpanded" class="mt-1.5 bg-amber-50 border border-amber-200 rounded-xl p-2 sm:p-3">
                <div class="flex gap-2 items-center">
                  <div class="flex bg-white border border-amber-200 rounded-xl overflow-hidden shrink-0">
                    <button @click="discountType = 'percent'" :class="discountType === 'percent' ? 'bg-amber-500 text-white' : 'text-amber-700 hover:bg-amber-100'" class="px-2.5 py-1.5 text-xs font-bold transition-colors">
                      %
                    </button>
                    <button @click="discountType = 'fixed'" :class="discountType === 'fixed' ? 'bg-amber-500 text-white' : 'text-amber-700 hover:bg-amber-100'" class="px-2.5 py-1.5 text-xs font-bold transition-colors">
                      {{ store.config.ui.currency }}
                    </button>
                  </div>
                  <NumericInput
                    v-model="discountInput"
                    min="0"
                    :max="discountType === 'percent' ? 100 : tableAmountRemaining"
                    step="0.01"
                    :placeholder="discountType === 'percent' ? 'Es. 10' : 'Es. 5.00'"
                    :typeToggleLabels="['%', store.config.ui.currency]"
                    :typeToggleIndex="discountType === 'percent' ? 0 : 1"
                    @update:typeToggleIndex="i => discountType = i === 0 ? 'percent' : 'fixed'"
                    class="flex-1 min-w-0 text-sm font-bold border border-amber-200 rounded-xl px-3 py-1.5 bg-white focus:outline-none focus:border-amber-400 text-amber-900"
                  />
                  <button
                    @click="applyDiscount"
                    :disabled="discountPreview <= 0"
                    class="shrink-0 bg-amber-500 hover:bg-amber-600 disabled:bg-gray-200 disabled:text-gray-400 text-white font-bold text-xs px-2.5 py-1.5 rounded-xl transition-colors active:scale-95"
                  >
                    Applica
                  </button>
                </div>
                <div v-if="discountInputExceedsMax" class="mt-1.5 text-[10px] text-red-600 font-bold flex items-center gap-1">
                  <AlertTriangle class="size-3 shrink-0" />
                  {{ discountType === 'percent' ? 'Valore limitato al 100%' : 'Non può superare il totale' }}
                </div>
                <div v-else-if="discountPreview > 0" class="mt-1.5 text-[10px] text-amber-700 font-bold flex items-center justify-between">
                  <span>Sconto:</span>
                  <span>-{{ store.config.ui.currency }}{{ discountPreview.toFixed(2) }}</span>
                </div>
              </div>
            </div>

            <!-- Scelta Split Conto -->
            <div v-if="tableAmountRemaining > 0" class="space-y-2 sm:space-y-3">
              <div class="flex gap-1.5">
                <button aria-label="Tutto" @click="checkoutMode = 'unico'" :class="checkoutMode === 'unico' ? 'bg-gray-200 text-gray-800 border-gray-300 font-bold' : 'bg-white text-gray-500 border-gray-200 hover:bg-gray-100'" class="flex-1 py-1.5 sm:py-2 text-xs rounded-xl border transition-all active:scale-95 flex items-center justify-center gap-1.5 shadow-sm"><Layers class="size-3.5 shrink-0" /><span class="hidden md:inline">Tutto</span></button>
                <button aria-label="Romana" @click="checkoutMode = 'romana'" :class="checkoutMode === 'romana' ? 'bg-blue-100 text-blue-800 border-blue-200 font-bold' : 'bg-white text-gray-500 border-gray-200 hover:bg-gray-100'" class="flex-1 py-1.5 sm:py-2 text-xs rounded-xl border transition-all active:scale-95 flex items-center justify-center gap-1.5 shadow-sm"><Users class="size-3.5 shrink-0" /><span class="hidden md:inline">Romana</span></button>
                <button aria-label="Analitica" @click="checkoutMode = 'analitica'" :disabled="hasRomanaPayment" :class="checkoutMode === 'analitica' ? 'bg-teal-100 text-teal-800 border-teal-200 font-bold' : hasRomanaPayment ? 'bg-white text-gray-300 border-gray-200 cursor-not-allowed opacity-50' : 'bg-white text-gray-500 border-gray-200 hover:bg-gray-100'" :title="hasRomanaPayment ? 'Non disponibile dopo un pagamento alla Romana' : undefined" class="flex-1 py-1.5 sm:py-2 text-xs rounded-xl border transition-all active:scale-95 flex items-center justify-center gap-1.5 shadow-sm"><SquareCheck class="size-3.5 shrink-0" /><span class="hidden md:inline">Analitica</span></button>
                <button aria-label="Comanda" @click="checkoutMode = 'ordini'" :disabled="hasRomanaPayment" :class="checkoutMode === 'ordini' ? 'bg-purple-100 text-purple-800 border-purple-200 font-bold' : hasRomanaPayment ? 'bg-white text-gray-300 border-gray-200 cursor-not-allowed opacity-50' : 'bg-white text-gray-500 border-gray-200 hover:bg-gray-100'" :title="hasRomanaPayment ? 'Non disponibile dopo un pagamento alla Romana' : undefined" class="flex-1 py-1.5 sm:py-2 text-xs rounded-xl border transition-all active:scale-95 flex items-center justify-center gap-1.5 shadow-sm"><ListChecks class="size-3.5 shrink-0" /><span class="hidden md:inline">Comanda</span></button>
              </div>

              <!-- Romana -->
              <div v-if="checkoutMode === 'romana'" class="bg-blue-50 border border-blue-100 p-2 sm:p-3 rounded-xl transition-all space-y-2 sm:space-y-3">
                <!-- Steppers row -->
                <div class="grid gap-3" :class="splitWays - splitPaidQuotas > 1 ? 'grid-cols-2' : 'grid-cols-1'">
                  <!-- Parti totali -->
                  <div>
                    <label class="block text-[10px] font-bold text-blue-500 uppercase tracking-wider mb-1.5">Dividi in</label>
                    <div class="flex items-center gap-1.5">
                      <button
                        @click="splitWays > minSplitWays ? splitWays-- : null"
                        :disabled="splitWays <= minSplitWays"
                        class="size-8 bg-white rounded-lg flex items-center justify-center font-bold text-blue-600 shadow-sm border border-blue-200 active:scale-95 transition-all disabled:opacity-30 shrink-0"
                      ><Minus class="size-4" /></button>
                      <span class="flex-1 text-center text-xl font-black text-blue-900">{{ splitWays }}<span class="text-xs font-bold text-blue-400 ml-1">parti</span></span>
                      <button @click="splitWays++"
                        class="size-8 bg-white rounded-lg flex items-center justify-center font-bold text-blue-600 shadow-sm border border-blue-200 active:scale-95 transition-all shrink-0"
                      ><Plus class="size-4" /></button>
                    </div>
                  </div>
                  <!-- Quote da pagare ora (solo se >1 rimanenti) -->
                  <div v-if="splitWays - splitPaidQuotas > 1">
                    <label class="block text-[10px] font-bold text-blue-500 uppercase tracking-wider mb-1.5">Quote ora</label>
                    <div class="flex items-center gap-1.5">
                      <button
                        @click="romanaSplitCount > 1 ? romanaSplitCount-- : null"
                        :disabled="romanaSplitCount <= 1"
                        class="size-8 bg-white rounded-lg flex items-center justify-center font-bold text-blue-600 shadow-sm border border-blue-200 active:scale-95 transition-all disabled:opacity-30 shrink-0"
                      ><Minus class="size-4" /></button>
                      <span class="flex-1 text-center text-xl font-black text-blue-900">{{ romanaSplitCount }}<span class="text-xs font-bold text-blue-400 ml-1">/ {{ splitWays - splitPaidQuotas }}</span></span>
                      <button
                        @click="romanaSplitCount < (splitWays - splitPaidQuotas) ? romanaSplitCount++ : null"
                        :disabled="romanaSplitCount >= (splitWays - splitPaidQuotas)"
                        class="size-8 bg-white rounded-lg flex items-center justify-center font-bold text-blue-600 shadow-sm border border-blue-200 active:scale-95 transition-all disabled:opacity-30 shrink-0"
                      ><Plus class="size-4" /></button>
                    </div>
                  </div>
                </div>

                <!-- Progress pills -->
                <div class="flex gap-0.5">
                  <div v-for="n in splitWays" :key="n"
                    class="h-1.5 flex-1 min-w-[6px] rounded-full transition-all"
                    :class="n <= splitPaidQuotas ? 'bg-emerald-400' : 'bg-blue-200'">
                  </div>
                </div>
                <div v-if="splitPaidQuotas > 0" class="text-[10px] text-blue-600 font-bold flex items-center gap-1 -mt-1">
                  <CheckCircle class="size-3 text-emerald-500 shrink-0" />
                  {{ splitPaidQuotas }} di {{ splitWays }} quote già saldate
                </div>

                <!-- Quota amount summary -->
                <div class="border-t border-blue-200 pt-2.5 flex justify-between items-center">
                  <div>
                    <span class="text-[10px] font-bold text-blue-500 uppercase tracking-wider">Quota<span v-if="romanaSplitCount > 1"> × {{ romanaSplitCount }}</span></span>
                    <div v-if="romanaSplitCount > 1" class="text-[10px] text-blue-400">{{ store.config.ui.currency }}{{ (tableAmountRemaining / Math.max(1, splitWays - splitPaidQuotas)).toFixed(2) }} cad.</div>
                  </div>
                  <span class="font-black text-xl text-blue-700">{{ store.config.ui.currency }}{{ quotaRomana.toFixed(2) }}</span>
                </div>
              </div>

              <div v-if="checkoutMode === 'ordini'" class="bg-purple-50 border border-purple-100 p-2 sm:p-3 rounded-xl flex items-center gap-2 text-xs font-bold text-purple-700">
                <ListChecks class="size-3.5 shrink-0" />
                <span>{{ selectedOrdersToPay.length === 0 ? 'Seleziona dal riepilogo ←' : selectedOrdersToPay.length + ' comanda/e selezionata/e' }}</span>
              </div>
            </div>
          </div>

          <!-- Bottoni di Pagamento -->
          <div class="p-2 sm:p-3 md:p-5 bg-gray-50 border-t border-gray-200 shrink-0 pb-4 space-y-1.5 sm:space-y-2">
            <div v-if="hasPendingOrdersInTable" class="bg-amber-100 text-amber-800 p-2 sm:p-3 rounded-xl text-[10px] font-bold flex items-center gap-1.5 border border-amber-200">
              <AlertTriangle class="size-4 shrink-0" /> <span>Comande in Attesa — tavolo resterà aperto.</span>
            </div>

            <div v-if="analiticaSelectionExceedsRemaining" class="bg-red-50 border border-red-200 text-red-700 p-3 rounded-xl text-[10px] md:text-xs font-bold flex items-center gap-2">
              <AlertTriangle class="size-4 shrink-0" />
              Totale selezionato supera il conto rimanente ({{ store.config.ui.currency }}{{ tableAmountRemaining.toFixed(2) }})
            </div>

            <div v-if="checkoutMode !== 'unico' && tableAmountRemaining > 0" class="flex justify-between items-center px-0.5">
              <span class="text-[10px] font-bold text-gray-500 uppercase tracking-wider">Da pagare:</span>
              <span class="text-lg font-black theme-text">{{ store.config.ui.currency }}{{ amountBeingPaid.toFixed(2) }}</span>
            </div>

            <!-- Metodi di pagamento -->
            <div class="grid grid-cols-2 gap-2.5">
              <button
                v-for="method in store.config.paymentMethods"
                :key="method.id"
                @click="openPaymentModal(method.id)"
                :disabled="!canPay"
                :class="method.colorClass"
                class="py-2 sm:py-2.5 md:py-4 rounded-xl font-bold flex items-center justify-center gap-2 transition-all disabled:bg-gray-100 disabled:text-gray-400 disabled:shadow-none active:scale-95 text-sm md:text-base shadow-md"
              >
                <component :is="getPaymentIcon(method.id)" class="size-5" /> {{ method.label }}
              </button>
            </div>

            <!-- Manual bill close button (shown when fully paid) -->
            <div v-if="canManuallyCloseBill" class="rounded-xl border-2 border-emerald-300 bg-emerald-50 p-2.5 sm:p-3 space-y-2">
              <div class="flex items-center gap-2 text-emerald-700">
                <CheckCircle class="size-4 shrink-0" />
                <span class="text-xs font-bold">Conto saldato — nessun residuo.</span>
              </div>
              <button @click="closeTableBill" class="w-full py-2.5 sm:py-3 bg-emerald-600 hover:bg-emerald-700 text-white font-bold rounded-xl active:scale-95 transition-all shadow-md flex items-center justify-center gap-2 text-sm">
                <CheckCircle class="size-4" /> Chiudi Conto
              </button>
            </div>
          </div>
        </div>
      </div>
    </div>
  </div>

  <!-- ================================================================ -->
  <!-- MODAL: PAGAMENTO                                                  -->
  <!-- ================================================================ -->
  <div v-if="showPaymentModal && selectedTable" class="fixed inset-0 z-[75] bg-black/70 backdrop-blur-sm flex items-end md:items-center justify-center p-0 md:p-4">
    <div class="bg-white rounded-t-3xl md:rounded-3xl shadow-2xl w-full max-w-sm md:max-w-md flex flex-col overflow-hidden max-h-[95dvh] md:max-h-[85dvh]">
      <!-- Header -->
      <div class="bg-gray-900 text-white p-4 md:p-5 flex justify-between items-center shrink-0">
        <div class="flex items-center gap-3">
          <div class="size-10 rounded-full bg-white/10 flex items-center justify-center shrink-0">
            <component :is="modalMethodIcon" class="size-5" />
          </div>
          <div>
            <h3 class="font-bold text-base md:text-lg leading-tight">{{ modalMethodLabel }}</h3>
            <span
              class="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-bold mt-0.5"
              :class="checkoutMode === 'romana' ? 'bg-blue-500/20 text-blue-200' : checkoutMode === 'ordini' ? 'bg-purple-500/20 text-purple-200' : checkoutMode === 'analitica' ? 'bg-teal-500/20 text-teal-200' : 'bg-white/10 text-white/70'"
            >
              {{ checkoutMode === 'romana' ? 'Quota Romana' : checkoutMode === 'ordini' ? 'Per Comanda' : checkoutMode === 'analitica' ? 'Analitico' : 'Conto Intero' }}
            </span>
          </div>
        </div>
        <button @click="closePaymentModal" class="bg-white/10 hover:bg-white/20 p-2 rounded-full transition-colors active:scale-95">
          <X class="size-5" />
        </button>
      </div>

      <!-- Body -->
      <div class="p-4 md:p-6 flex-1 overflow-y-auto space-y-4">
        <!-- Da pagare -->
        <div class="bg-gray-50 rounded-2xl border border-gray-200 px-4 py-3 flex justify-between items-center">
          <span class="text-xs font-bold text-gray-400 uppercase tracking-wider">Da Pagare</span>
          <span class="text-3xl font-black text-gray-900">{{ store.config.ui.currency }}{{ amountBeingPaid.toFixed(2) }}</span>
        </div>

        <!-- Importo Ricevuto -->
        <div>
          <label class="block text-[10px] font-bold text-gray-700 uppercase mb-1.5 flex items-center gap-1.5">
            <Banknote class="size-3.5" /> Importo Ricevuto
          </label>
          <NumericInput
            v-model="modalRicevutiComputed"
            min="0"
            step="0.50"
            :prefix="store.config.ui.currency"
            class="w-full text-lg font-black border-2 border-gray-300 rounded-xl px-4 py-3 bg-white focus:outline-none focus:border-gray-500 text-gray-900"
          />
        </div>

        <!-- Resto + Mancia (solo quando c'è un eccesso) -->
        <template v-if="modalExcess > 0">
          <!-- Cash + tips enabled: Resto | swap | Mancia on same row -->
          <div v-if="modalIsCash && tipsEnabled" class="flex items-end gap-2">
            <div class="flex-1">
              <label class="block text-[10px] font-bold text-blue-600 uppercase mb-1.5 flex items-center gap-1">
                <ArrowRightLeft class="size-3" /> Resto
              </label>
              <NumericInput
                v-model="modalRestoComputed"
                min="0"
                step="0.50"
                :prefix="store.config.ui.currency"
                class="w-full text-base font-black border-2 border-blue-200 rounded-xl px-3 py-3 bg-white focus:outline-none focus:border-blue-400 text-blue-900"
              />
            </div>
            <button
              @click="swapRestoMancia"
              class="mb-0.5 size-10 flex items-center justify-center rounded-xl bg-orange-50 hover:bg-orange-100 border border-orange-200 text-orange-500 shadow-sm transition-colors active:scale-95 shrink-0"
              title="Scambia Resto e Mancia"
            >
              <ArrowRightLeft class="size-4" />
            </button>
            <div class="flex-1">
              <label class="block text-[10px] font-bold text-purple-600 uppercase mb-1.5 flex items-center gap-1">
                <Wallet class="size-3" /> Mancia
              </label>
              <NumericInput
                v-model="modalManciaComputed"
                min="0"
                step="0.50"
                :prefix="store.config.ui.currency"
                class="w-full text-base font-black border-2 border-purple-200 rounded-xl px-3 py-3 bg-white focus:outline-none focus:border-purple-400 text-purple-900"
              />
            </div>
          </div>

          <!-- Cash only (no tips): Resto full width -->
          <div v-else-if="modalIsCash">
            <label class="block text-[10px] font-bold text-blue-600 uppercase mb-1.5 flex items-center gap-1.5">
              <ArrowRightLeft class="size-3.5" /> Resto da Dare
            </label>
            <NumericInput
              v-model="modalRestoComputed"
              min="0"
              step="0.50"
              :prefix="store.config.ui.currency"
              class="w-full text-lg font-black border-2 border-blue-200 rounded-xl px-4 py-3 bg-white focus:outline-none focus:border-blue-400 text-blue-900"
            />
          </div>

        </template>

        <!-- Riepilogo dinamico -->
        <div v-if="modalRicevutoParsed > 0" class="rounded-2xl border p-3 text-sm space-y-1.5"
          :class="modalIsPartial ? 'bg-amber-50 border-amber-200' : 'bg-emerald-50 border-emerald-200'">
          <div class="flex justify-between">
            <span class="text-gray-600">Ricevuto:</span>
            <span class="font-bold text-gray-800">{{ store.config.ui.currency }}{{ modalRicevutoParsed.toFixed(2) }}</span>
          </div>
          <div class="flex justify-between text-xs text-gray-500">
            <span>– Da pagare:</span>
            <span class="font-bold">{{ store.config.ui.currency }}{{ amountBeingPaid.toFixed(2) }}</span>
          </div>
          <template v-if="!modalIsPartial">
            <div v-if="modalIsCash && modalRestoParsed > 0" class="flex justify-between text-blue-600 border-t border-blue-200 pt-1.5">
              <span>= Resto da dare:</span>
              <span class="font-bold">{{ store.config.ui.currency }}{{ modalRestoParsed.toFixed(2) }}</span>
            </div>
            <div v-if="tipsEnabled && modalManciaParsed > 0" class="flex justify-between text-purple-600"
              :class="{ 'border-t border-purple-200 pt-1.5': !(modalIsCash && modalRestoParsed > 0) }">
              <span>+ Mancia:</span>
              <span class="font-bold">{{ store.config.ui.currency }}{{ modalManciaParsed.toFixed(2) }}</span>
            </div>
          </template>
          <div v-if="modalIsPartial" class="border-t border-amber-300 pt-1.5 mt-0.5 space-y-1">
            <div class="flex justify-between text-amber-700 font-bold">
              <span>Incassato ora:</span>
              <span>{{ store.config.ui.currency }}{{ modalRicevutoParsed.toFixed(2) }}</span>
            </div>
            <div class="flex justify-between text-amber-600 text-xs">
              <span>Residuo da pagare:</span>
              <span class="font-bold">{{ store.config.ui.currency }}{{ (amountBeingPaid - modalRicevutoParsed).toFixed(2) }}</span>
            </div>
            <p class="text-[10px] text-amber-700 font-bold flex items-center gap-1 pt-0.5">
              <AlertTriangle class="size-3 shrink-0" /> Pagamento parziale: sarà richiesta un'ulteriore transazione.
            </p>
          </div>
        </div>
      </div>

      <!-- Footer -->
      <div class="p-4 border-t border-gray-200 space-y-2 shrink-0">
        <button
          @click="confirmPaymentModal"
          :disabled="modalRicevutoParsed <= 0 || (checkoutMode === 'analitica' && modalRicevutoParsed < amountBeingPaid - BILL_SETTLED_THRESHOLD)"
          class="w-full py-4 bg-emerald-600 hover:bg-emerald-700 text-white font-bold rounded-xl disabled:opacity-40 disabled:bg-gray-300 disabled:text-gray-400 active:scale-95 transition-all flex items-center justify-center gap-2 text-base shadow-md"
        >
          <CheckCircle class="size-5" />
          <template v-if="modalIsCash && modalRestoParsed > 0">Conferma · Resto {{ store.config.ui.currency }}{{ modalRestoParsed.toFixed(2) }}</template>
          <template v-else-if="!modalIsCash && !modalIsPartial && tipsEnabled && modalManciaParsed > 0">Conferma · Mancia {{ store.config.ui.currency }}{{ modalManciaParsed.toFixed(2) }}</template>
          <template v-else-if="modalIsPartial">Incassa {{ store.config.ui.currency }}{{ modalRicevutoParsed.toFixed(2) }}</template>
          <template v-else>Conferma Incasso</template>
        </button>
        <button
          @click="closePaymentModal"
          class="w-full py-2.5 text-gray-600 font-bold rounded-xl border border-gray-200 bg-white hover:bg-gray-100 active:scale-95 transition-all text-sm"
        >Annulla</button>
      </div>
    </div>
  </div>

  <!-- ================================================================ -->
  <!-- MODAL: AGGIUNGI VOCE DIRETTA AL CONTO                           -->
  <!-- ================================================================ -->
  <div v-if="showDirectItemModal && selectedTable" class="fixed inset-0 z-[70] bg-black/70 backdrop-blur-sm flex items-end md:items-center justify-center p-0 md:p-4">
    <div class="bg-white rounded-t-3xl md:rounded-3xl shadow-2xl w-full max-w-3xl h-[90dvh] md:h-[85dvh] flex flex-col overflow-hidden">

      <!-- Header -->
      <div class="bg-gray-900 text-white p-3 md:p-4 flex justify-between items-center shrink-0">
        <div>
          <h3 class="font-bold text-base md:text-lg flex items-center gap-2">
            <Zap class="size-4 md:size-5 text-emerald-400" /> Aggiungi Voce Diretta
          </h3>
          <p class="text-[10px] text-gray-400 uppercase tracking-widest mt-0.5">
            Tavolo {{ selectedTable.label }} — Aggiunta senza passare per la cucina
          </p>
        </div>
        <button @click="closeDirectItemModal" class="bg-white/10 hover:bg-white/20 p-2 md:p-2.5 rounded-full transition-colors active:scale-95"><X class="size-5" /></button>
      </div>

      <!-- Tabs -->
      <div v-if="canShowCustomEntryTab" class="flex border-b border-gray-200 bg-gray-50 shrink-0">
        <button
          @click="directItemMode = 'menu'"
          :class="directItemMode === 'menu' ? 'border-b-2 theme-border-b theme-text bg-white font-bold' : 'text-gray-500 hover:bg-gray-100'"
          class="flex-1 py-3 text-xs md:text-sm flex items-center justify-center gap-2 transition-colors">
          <BookOpen class="size-4" /> Dal Menu
        </button>
        <button
          @click="directItemMode = 'custom'"
          :class="directItemMode === 'custom' ? 'border-b-2 theme-border-b theme-text bg-white font-bold' : 'text-gray-500 hover:bg-gray-100'"
          class="flex-1 py-3 text-xs md:text-sm flex items-center justify-center gap-2 transition-colors">
          <PlusCircle class="size-4" /> Personalizzata
        </button>
      </div>

      <!-- Content: modal body -->
      <div class="flex-1 min-h-0 overflow-hidden flex flex-col">

        <!-- "Dal Menu" mode -->
        <div v-if="directItemMode === 'menu'" class="flex-1 flex flex-col md:flex-row overflow-hidden min-h-0">
          <!-- Categories sidebar -->
          <div class="w-full md:w-[180px] border-b md:border-b-0 md:border-r border-gray-200 bg-gray-50 flex md:flex-col overflow-x-auto md:overflow-y-auto no-scrollbar shrink-0">
            <button
              v-for="(menuItems, category) in store.config.menu"
              :key="'dcat_'+category"
              @click="directActiveMenuCategory = category"
              :class="directActiveMenuCategory === category ? 'bg-white border-b-2 md:border-b-0 md:border-l-4 theme-border-b theme-border-l theme-text font-bold' : 'text-gray-500 hover:bg-gray-100'"
              class="whitespace-nowrap md:whitespace-normal md:w-full px-4 py-3 text-xs md:text-sm transition-colors shrink-0 text-left">
              {{ category }}
            </button>
          </div>
          <!-- Menu items grid -->
          <div class="flex-1 overflow-y-auto p-3 grid grid-cols-2 md:grid-cols-3 gap-2 content-start">
            <button
              v-for="item in (store.config.menu[directActiveMenuCategory] || [])"
              :key="'dmi_'+item.id"
              @click="addMenuItemToDirectCart(item)"
              class="bg-white border border-gray-200 rounded-xl p-3 text-left hover:border-emerald-300 hover:bg-emerald-50 active:scale-95 transition-all shadow-sm flex flex-col gap-1">
              <span class="font-bold text-gray-800 text-xs leading-tight line-clamp-2">{{ item.name }}</span>
              <span class="theme-text font-black text-sm mt-auto">{{ store.config.ui.currency }}{{ item.price.toFixed(2) }}</span>
            </button>
          </div>
        </div>

        <!-- "Custom" mode -->
        <div v-else-if="directItemMode === 'custom' && canShowCustomEntryTab" class="flex-1 overflow-hidden flex flex-col min-h-0">

          <!-- New item form (admin only) -->
          <div v-if="isAdmin" class="shrink-0 p-4 border-b border-gray-100 bg-white">
            <div class="flex gap-2 items-end">
              <div class="flex-1 min-w-0">
                <label class="block text-[10px] font-bold text-gray-500 uppercase tracking-wider mb-1.5">Nome voce</label>
                <input
                  v-model="directCustomName"
                  type="text"
                  placeholder="Es. Caffè, Servizio, Acqua..."
                  class="w-full border border-gray-200 rounded-xl px-3 py-2.5 text-sm focus:outline-none theme-ring bg-gray-50 focus:bg-white transition-colors"
                  @keydown.enter="addCustomItemToDirectCart"
                />
              </div>
              <div class="w-28 shrink-0">
                <label class="block text-[10px] font-bold text-gray-500 uppercase tracking-wider mb-1.5">Prezzo ({{ store.config.ui.currency }})</label>
                <input
                  :value="directCustomPrice"
                  type="text"
                  inputmode="decimal"
                  autocomplete="off"
                  placeholder="0.00"
                  class="w-full border border-gray-200 rounded-xl px-3 py-2.5 text-sm focus:outline-none theme-ring bg-gray-50 focus:bg-white transition-colors"
                  @input="onDirectCustomPriceInput"
                  @keydown.enter="addCustomItemToDirectCart"
                />
              </div>
              <button
                @click="addCustomItemToDirectCart"
                :disabled="!directCustomName.trim()"
                class="shrink-0 theme-bg hover:opacity-90 disabled:bg-gray-200 disabled:text-gray-400 text-white font-bold px-4 py-2.5 rounded-xl transition-opacity active:scale-95 flex items-center gap-1.5 text-sm shadow-sm">
                <Plus class="size-4" /> Aggiungi
              </button>
            </div>
          </div>

          <!-- Saved custom items -->
          <div class="flex-1 overflow-y-auto p-3">
            <div v-if="savedCustomItems.length > 0 || configLockedDirectItems.length > 0">
              <p class="text-[10px] font-bold text-gray-400 uppercase tracking-wider mb-2 px-1">Voci salvate</p>
              <div class="grid grid-cols-2 md:grid-cols-3 gap-2">
                <!-- Config-locked items (coperto adulto/bambino) — shown first, non-removable -->
                <div
                  v-for="locked in configLockedDirectItems"
                  :key="'lc_'+locked.name"
                  class="flex items-stretch bg-white border border-emerald-200 rounded-xl shadow-sm overflow-hidden transition-colors">
                  <button
                    @click="addSavedCustomItemToDirectCart(locked)"
                    class="flex-1 p-3 text-left hover:bg-emerald-50 active:scale-95 transition-colors min-w-0 flex flex-col gap-1 bg-emerald-50/50">
                    <span class="font-bold text-gray-800 text-xs leading-snug line-clamp-2">{{ locked.name }}</span>
                    <span class="theme-text font-black text-sm mt-auto">{{ store.config.ui.currency }}{{ locked.price.toFixed(2) }}</span>
                  </button>
                  <span
                    class="shrink-0 w-8 border-l border-emerald-100 text-emerald-500 bg-emerald-50/50 flex items-center justify-center"
                    title="Voce fissa da configurazione">
                    <Lock class="size-3.5" />
                  </span>
                </div>
                <!-- User-saved items -->
                <div
                  v-for="(saved, si) in savedCustomItems"
                  :key="'sc_'+si"
                  class="flex items-stretch bg-white border border-gray-200 rounded-xl shadow-sm overflow-hidden hover:border-emerald-300 transition-colors">
                  <button
                    @click="addSavedCustomItemToDirectCart(saved)"
                    class="flex-1 p-3 text-left hover:bg-emerald-50 active:scale-95 transition-colors min-w-0 flex flex-col gap-1">
                    <span class="font-bold text-gray-800 text-xs leading-snug line-clamp-2">{{ saved.name }}</span>
                    <span class="theme-text font-black text-sm mt-auto">{{ store.config.ui.currency }}{{ saved.price.toFixed(2) }}</span>
                  </button>
                  <button
                    v-if="isAdmin"
                    @click="removeSavedCustomItem(si)"
                    class="shrink-0 w-8 border-l border-gray-100 text-gray-300 hover:text-red-500 hover:bg-red-50 transition-colors flex items-center justify-center active:scale-90">
                    <Trash2 class="size-3.5" />
                  </button>
                </div>
              </div>
            </div>
            <div v-else class="flex flex-col items-center justify-center h-full text-gray-400 py-8 gap-2">
              <PlusCircle class="size-8 opacity-30" />
              <p v-if="isAdmin" class="text-xs text-center">Le voci inserite verranno salvate qui per un accesso rapido.</p>
              <p v-else class="text-xs text-center">Nessuna voce personalizzata disponibile.</p>
            </div>
          </div>
        </div>
      </div>

      <!-- Cart footer + confirm -->
      <div class="border-t border-gray-200 bg-gray-50 p-3 shrink-0">
        <!-- Cart items list -->
        <div v-if="directCart.length > 0" class="mb-3 space-y-1.5 max-h-48 overflow-y-auto">
          <div
            v-for="(item, idx) in directCart"
            :key="item.uid"
            class="flex items-center gap-2 bg-white rounded-xl px-3 py-2 border border-gray-200 shadow-sm">
            <span class="font-bold text-gray-800 text-xs flex-1 min-w-0 truncate">{{ item.name }}</span>
            <div class="flex items-center gap-1 bg-gray-100 rounded-md p-0.5 border border-gray-200 shrink-0">
              <button @click="updateDirectCartQty(idx, -1)"
                class="size-6 flex items-center justify-center bg-white rounded shadow-sm active:scale-95 transition-colors"
                :class="item.quantity === 1 ? 'text-red-500' : 'text-gray-600'">
                <Trash2 v-if="item.quantity === 1" class="size-3" />
                <Minus v-else class="size-3" />
              </button>
              <span class="w-5 text-center font-black text-xs text-gray-800 tabular-nums">{{ item.quantity }}</span>
              <button @click="updateDirectCartQty(idx, 1)"
                class="size-6 flex items-center justify-center bg-white theme-text rounded shadow-sm active:scale-95">
                <Plus class="size-3" />
              </button>
            </div>
            <span class="font-black text-xs theme-text shrink-0 tabular-nums">{{ store.config.ui.currency }}{{ (item.unitPrice * item.quantity).toFixed(2) }}</span>
          </div>
        </div>
        <div v-else class="text-center text-gray-400 text-xs py-2 mb-2 italic">Nessuna voce selezionata.</div>

        <!-- Total + confirm button -->
        <div class="flex items-center justify-between gap-3">
          <div class="text-sm font-black text-gray-800">
            Totale: <span class="theme-text text-base">{{ store.config.ui.currency }}{{ directCartTotal.toFixed(2) }}</span>
          </div>
          <button
            @click="confirmDirectItems"
            :disabled="directCart.length === 0"
            class="theme-bg hover:opacity-90 disabled:bg-gray-300 disabled:text-gray-400 text-white font-bold px-6 py-3 rounded-xl transition-opacity active:scale-95 text-sm flex items-center gap-2 shadow-md">
            <CheckCircle class="size-4" /> Aggiungi al Conto
          </button>
        </div>
      </div>
    </div>
  </div>

  <!-- ================================================================ -->
  <!-- MODAL: RICEVUTA TRANSAZIONE E PRECONTO JSON API FISCALE          -->
  <!-- ================================================================ -->
  <div v-if="showPrecontoJson" class="fixed inset-0 z-[95] bg-black/80 backdrop-blur-sm flex items-center justify-center p-4">
    <div class="bg-gray-900 rounded-2xl w-full max-w-2xl h-[80dvh] flex flex-col shadow-2xl border border-gray-700">
      <div class="p-4 border-b border-gray-700 flex justify-between items-center shrink-0 bg-gray-800 rounded-t-2xl">
        <div class="flex flex-col">
          <h3 class="font-bold text-white flex items-center gap-2 text-sm md:text-base">
            <component :is="jsonContext === 'receipt' ? CheckCircle : Code" class="size-4 md:size-5 text-emerald-400" />
            {{ jsonContext === 'receipt' ? 'Ricevuta Transazione Effettuata' : 'Payload JSON (API Ready)' }}
          </h3>
          <p class="text-[10px] text-gray-400 uppercase mt-1">Status: OK</p>
        </div>
        <button @click="closeJsonModal" class="text-gray-400 hover:text-white bg-white/10 p-1.5 rounded-full transition-colors"><X class="size-4 md:size-5" /></button>
      </div>
      <div class="flex-1 overflow-auto p-4 bg-black/50">
        <pre class="text-emerald-400 font-mono text-[10px] md:text-xs whitespace-pre-wrap">{{ jsonPayloadData }}</pre>
      </div>
      <div v-if="jsonContext === 'receipt'" class="p-4 border-t border-gray-700 bg-gray-800 rounded-b-2xl flex justify-end">
        <button @click="closeJsonModal" class="w-full md:w-auto px-8 bg-emerald-600 hover:bg-emerald-500 text-white py-3 rounded-xl font-bold transition-colors active:scale-95">
          {{ jsonContext === 'receipt' ? 'Chiudi Scontrino e Continua' : 'Chiudi' }}
        </button>
      </div>
    </div>
  </div>

  <!-- ================================================================ -->
  <!-- MODAL: SPOSTA TAVOLO                                              -->
  <!-- ================================================================ -->
  <div v-if="showMoveModal" class="fixed inset-0 z-[100] bg-black/70 backdrop-blur-sm flex items-center justify-center p-4">
    <div class="bg-white rounded-2xl shadow-2xl w-full max-w-sm p-5 max-h-[90dvh] overflow-y-auto">
      <div class="flex justify-between items-center mb-4">
        <h3 class="font-bold text-gray-800 flex items-center gap-2"><ArrowRightLeft class="size-5 theme-text" /> Sposta Tavolo {{ selectedTable?.label }}</h3>
        <button @click="showMoveModal = false" class="text-gray-400 hover:text-gray-700 bg-gray-100 hover:bg-gray-200 rounded-full p-1.5 transition-colors"><X class="size-4" /></button>
      </div>
      <p class="text-xs text-gray-500 mb-4">Seleziona il tavolo di destinazione libero. Tutti gli ordini verranno spostati.</p>
      <div class="grid grid-cols-4 gap-2 max-h-64 overflow-y-auto">
        <button v-for="table in freeTables" :key="'sp_'+table.id"
          @click="confirmMove(table)"
          class="aspect-square rounded-xl border-2 border-emerald-200 bg-emerald-50 text-emerald-800 font-black text-lg flex items-center justify-center hover:bg-emerald-100 active:scale-95 transition-all">
          {{ table.label }}
        </button>
      </div>
      <div v-if="freeTables.length === 0" class="text-center text-gray-400 text-sm py-4">Nessun tavolo libero disponibile.</div>
    </div>
  </div>

  <!-- ================================================================ -->
  <!-- MODAL: UNISCI TAVOLI                                              -->
  <!-- ================================================================ -->
  <div v-if="showMergeModal" class="fixed inset-0 z-[100] bg-black/70 backdrop-blur-sm flex items-center justify-center p-4">
    <div class="bg-white rounded-2xl shadow-2xl w-full max-w-sm p-5 max-h-[90dvh] overflow-y-auto">
      <div class="flex justify-between items-center mb-4">
        <h3 class="font-bold text-gray-800 flex items-center gap-2"><Merge class="size-5 theme-text" /> Unisci con Tavolo {{ selectedTable?.label }}</h3>
        <button @click="showMergeModal = false" class="text-gray-400 hover:text-gray-700 bg-gray-100 hover:bg-gray-200 rounded-full p-1.5 transition-colors"><X class="size-4" /></button>
      </div>
      <p class="text-xs text-gray-500 mb-4">Seleziona il tavolo con cui fondere gli ordini. I suoi ordini e i coperti verranno uniti con questo tavolo.</p>
      <div class="grid grid-cols-4 gap-2 max-h-64 overflow-y-auto">
        <button v-for="table in occupiedTables" :key="'un_'+table.id"
          @click="confirmMerge(table)"
          class="aspect-square rounded-xl border-2 border-[var(--brand-primary)] theme-bg text-white font-black text-lg flex items-center justify-center hover:opacity-90 active:scale-95 transition-all">
          {{ table.label }}
        </button>
      </div>
      <div v-if="occupiedTables.length === 0" class="text-center text-gray-400 text-sm py-4">Nessun altro tavolo occupato disponibile.</div>
    </div>
  </div>

  <!-- ================================================================ -->
  <!-- MODAL: NUMERO PERSONE AL TAVOLO                                   -->
  <!-- Shared component — any UI change reflects in all apps.          -->
  <!-- ================================================================ -->
  <PeopleModal
    :show="showPeopleModal && !!pendingTableToOpen"
    :table="pendingTableToOpen"
    :showChildrenInput="showChildrenInput"
    v-model:adults="peopleAdults"
    v-model:children="peopleChildren"
    @cancel="showPeopleModal = false; pendingTableToOpen = null"
    @confirm="confirmPeopleAndOpenTable"
  />
</template>

<script setup>
import { ref, computed, watch } from 'vue';
import {
  Grid3x3, Users, X, Plus, Coffee, Edit, AlertTriangle, CheckCircle,
  Ban, Undo2, Code, Minus, Receipt, ArrowRightLeft, Merge, Trash2,
  Layers, ListChecks, History, LayoutGrid, ListOrdered,
  Tag, Wallet, ChevronDown,
  Percent, Zap, BookOpen, PlusCircle, Banknote, CreditCard, Lock, SquareCheck,
} from 'lucide-vue-next';
import { useAppStore } from '../store/index.js';
import { getOrderItemRowTotal, KITCHEN_ACTIVE_STATUSES, getLockedDirectItems, appConfig } from '../utils/index.js';
import { buildFlatAnaliticaItems, computeAnaliticaTotal, exceedsAmount, getOrdersToComplete } from '../utils/analitica.js';
import { resolveCustomItemsKey } from '../store/persistence.js';
import { useNumericKeyboard } from '../composables/useNumericKeyboard.js';
import { useAuth } from '../composables/useAuth.js';
import CassaClosedBillsList from './CassaClosedBillsList.vue';
import TableStatsBar from './shared/TableStatsBar.vue';
import TableGrid from './shared/TableGrid.vue';
// Shared component — used by both Sala and Cassa apps.
import PeopleModal from './shared/PeopleModal.vue';
import NumericInput from './NumericInput.vue';

const emit = defineEmits(['open-order-from-table', 'new-order-for-ordini']);

const store = useAppStore();
const { isAdmin } = useAuth();
const keyboard = useNumericKeyboard();

// ── Table modal state ──────────────────────────────────────────────────────
const showTableModal = ref(false);
const selectedTable = ref(null);

// ── Sposta / Unisci modal state ────────────────────────────────────────────
const showMoveModal = ref(false);
const showMergeModal = ref(false);

const freeTables = computed(() =>
  store.config.tables.filter(
    t => t.id !== selectedTable.value?.id && store.getTableStatus(t.id).status === 'free',
  ),
);

const tableStatusCounts = computed(() => {
  let free = 0, occupied = 0, pending = 0;
  for (const t of store.config.tables) {
    const s = store.getTableStatus(t.id).status;
    if (s === 'free') free++;
    else if (s === 'occupied' || s === 'conto_richiesto') occupied++;
    else if (s === 'pending') pending++;
  }
  return { free, occupied, pending };
});
const freeTablesCount = computed(() => tableStatusCounts.value.free);
const occupiedTablesCount = computed(() => tableStatusCounts.value.occupied);
const pendingTablesCount = computed(() => tableStatusCounts.value.pending);

const occupiedTables = computed(() =>
  store.config.tables.filter(
    t => t.id !== selectedTable.value?.id && store.getTableStatus(t.id).status !== 'free',
  ),
);

function openMoveModal() { showMoveModal.value = true; }
function openMergeModal() { showMergeModal.value = true; }

function confirmMove(targetTable) {
  if (!selectedTable.value) return;
  store.moveTableOrders(selectedTable.value.id, targetTable.id);
  showMoveModal.value = false;
  // Update selectedTable to the new one
  selectedTable.value = targetTable;
}

function confirmMerge(sourceTable) {
  if (!selectedTable.value) return;
  store.mergeTableOrders(sourceTable.id, selectedTable.value.id);
  showMergeModal.value = false;
}

// ── Bill Requested ─────────────────────────────────────────────────────────
function toggleBillRequested() {
  if (!selectedTable.value) return;
  const isSet = store.billRequestedTables.has(selectedTable.value.id);
  store.setBillRequested(selectedTable.value.id, !isSet);
}

// ── Checkout state ─────────────────────────────────────────────────────────
// Tolerance used to treat a bill as fully settled (handles floating-point rounding in totals).
const BILL_SETTLED_THRESHOLD = 0.01;
const cassaViewMode = ref('voce'); // 'voce' = grouped menu view | 'ordine' = per-order view
const checkoutMode = ref('unico');
const splitWays = ref(2);
const splitPaidQuotas = ref(0);
const romanaSplitCount = ref(1); // how many quotas to pay in this single transaction
const selectedOrdersToPay = ref([]);
const analiticaQty = ref({}); // analitica mode: map of 'key' → selected quantity (0 = not selected)

// ── Payment modal state ───────────────────────────────────────────────────
// Opened when the cashier clicks a payment method button.
const showPaymentModal = ref(false);
const modalMethodId = ref(null);
// Importo ricevuto dal cliente (pre-compilato con l'importo dovuto)
const modalRicevuto = ref('');
// Resto da ridare (solo contanti, auto-calcolato ma modificabile)
const modalResto = ref('');
// Mancia (opzionale, auto-calcolata ma modificabile)
const modalMancia = ref('');

// ── Discount (sconto) state ────────────────────────────────────────────────
const discountInput = ref('');
const discountType = ref('percent'); // 'percent' | 'fixed'
const discountExpanded = ref(false);

// ── People modal state (shown when opening a free table) ───────────────────
const showPeopleModal = ref(false);
const pendingTableToOpen = ref(null);
const peopleAdults = ref(2);
const peopleChildren = ref(0);
// Show a separate "Bambini" counter only when the children cover charge is
// enabled and has a non-zero price; otherwise a single generic "Persone"
// counter is sufficient.
const showChildrenInput = computed(() =>
  !!(store.config.coverCharge?.enabled && (store.config.coverCharge?.priceChild ?? 0) > 0),
);

// ── JSON modal state ───────────────────────────────────────────────────────
const showPrecontoJson = ref(false);
const jsonContext = ref('table');
const jsonPayloadData = ref('{}');

// ── Computed: table orders ─────────────────────────────────────────────────
const tableOrders = computed(() => {
  if (!selectedTable.value) return [];
  return store.orders.filter(
    o => o.table === selectedTable.value.id && o.status !== 'completed' && o.status !== 'rejected',
  );
});

const tableAcceptedPayableOrders = computed(() =>
  tableOrders.value.filter(o => KITCHEN_ACTIVE_STATUSES.includes(o.status)),
);

const tableTotalAmount = computed(() => {
  if (!selectedTable.value) return 0;
  const session = store.tableCurrentBillSession[selectedTable.value.id];
  return store.orders
    .filter(o => {
      if (o.table !== selectedTable.value.id) return false;
      if (!KITCHEN_ACTIVE_STATUSES.includes(o.status) && o.status !== 'completed') return false;
      if (session) return o.billSessionId === session.billSessionId;
      return true;
    })
    .reduce((acc, o) => acc + o.totalAmount, 0);
});

const tableTransactions = computed(() => {
  if (!selectedTable.value) return [];
  const session = store.tableCurrentBillSession[selectedTable.value.id];
  return store.transactions.filter(t => {
    if (t.tableId !== selectedTable.value.id) return false;
    if (session) return t.billSessionId === session.billSessionId;
    return true;
  });
});

const tableAmountPaid = computed(() =>
  tableTransactions.value.reduce((acc, t) => acc + t.amountPaid, 0),
);

const tableAmountRemaining = computed(() =>
  Math.max(0, tableTotalAmount.value - tableAmountPaid.value),
);

// True when at least one Romana transaction has been recorded for this bill
// session. In that case, Comanda and Analitica modes are disabled to prevent
// item-level selections from conflicting with the per-quota split logic.
const hasRomanaPayment = computed(() =>
  tableTransactions.value.some(t => t.operationType === 'romana'),
);

const hasPendingOrdersInTable = computed(() =>
  tableOrders.value.some(o => o.status === 'pending'),
);

const customPayAmount = computed(() => {
  const val = tableAcceptedPayableOrders.value
    .filter(o => selectedOrdersToPay.value.includes(o.id))
    .reduce((acc, o) => acc + o.totalAmount, 0);
  return Math.min(val, tableAmountRemaining.value);
});

// ── Analitica mode: flat list of individually selectable line items ─────────
// Delegates to the shared helper in utils/analitica.js so that the test suite
// validates the exact same production logic (no duplication).
const flatAnaliticaItems = computed(() => buildFlatAnaliticaItems(tableAcceptedPayableOrders.value));

const analiticaSelectedTotal = computed(() =>
  computeAnaliticaTotal(flatAnaliticaItems.value, analiticaQty.value),
);

// Cent-level comparison avoids IEEE-754 rounding artefacts blocking a
// selection that is effectively equal to the remaining balance.
const analiticaSelectionExceedsRemaining = computed(() =>
  exceedsAmount(analiticaSelectedTotal.value, tableAmountRemaining.value),
);

const analiticaAmount = computed(() => analiticaSelectedTotal.value);

// Sanitize analiticaQty whenever the payable item list changes (e.g. cashier
// voids an item while the modal is open).  Drop stale keys and clamp remaining
// quantities to the current netQty so that order-completion logic stays sound.
watch(flatAnaliticaItems, (newItems) => {
  const validKeys = new Set(newItems.map(i => i.key));
  const netQtyMap = Object.fromEntries(newItems.map(i => [i.key, i.netQty]));
  const cleaned = {};
  for (const [key, qty] of Object.entries(analiticaQty.value)) {
    if (!validKeys.has(key)) continue; // drop stale row
    const clamped = Math.min(qty, netQtyMap[key]);
    if (clamped > 0) cleaned[key] = clamped;
  }
  analiticaQty.value = cleaned;
});

// Auto-switch left panel to "Per Ordine" when comanda checkout mode is selected.
// Also reset per-mode selections so stale state (e.g. the "totale selezionato
// supera il conto rimanente" warning) does not bleed into the new mode.
watch(checkoutMode, (mode) => {
  analiticaQty.value = {};
  selectedOrdersToPay.value = [];
  if (mode === 'ordini') {
    cassaViewMode.value = 'ordine';
  }
});
const quotaRomana = computed(() => {
  if (splitWays.value <= 0) return 0;
  const waysLeft = splitWays.value - splitPaidQuotas.value;
  if (waysLeft <= 0) return 0;
  const perQuota = tableAmountRemaining.value / waysLeft;
  const count = Math.min(romanaSplitCount.value, waysLeft);
  return perQuota * count;
});

// ── Feature flags from config ──────────────────────────────────────────────
const tipsEnabled = computed(() => store.config.billing?.enableTips ?? false);
const discountsEnabled = computed(() => store.config.billing?.enableDiscounts ?? false);

// ── Payment modal computed ───────────────────────────────────────────────────────────────────
const modalMethod = computed(() =>
  store.config.paymentMethods.find(m => m.id === modalMethodId.value) ?? null,
);
const modalMethodLabel = computed(() => modalMethod.value?.label ?? '');
const modalMethodIcon = computed(() => getPaymentIcon(modalMethodId.value));

// Is the pending method a cash (non-card) method?
const modalIsCash = computed(() => {
  const m = modalMethod.value;
  return m ? m.icon !== 'credit-card' : false;
});

const modalRicevutoParsed = computed(() => Math.max(0, parseFloat(modalRicevuto.value) || 0));
const modalRestoParsed = computed(() => Math.max(0, parseFloat(modalResto.value) || 0));
const modalManciaParsed = computed(() => Math.max(0, parseFloat(modalMancia.value) || 0));

// True when the customer is paying less than the amount due (partial payment).
// Analitica mode does not allow partial payments (vociRefs must match amountPaid).
const modalIsPartial = computed(() =>
  checkoutMode.value !== 'analitica' &&
  modalRicevutoParsed.value > 0 && modalRicevutoParsed.value < amountBeingPaid.value,
);

// Excess above the amount due (ricevuto - due), used for Resto/Mancia distribution.
const modalExcess = computed(() => Math.max(0, modalRicevutoParsed.value - amountBeingPaid.value));

// Coerce any model value to a plain string for safe parsing (handles null/undefined/'').
const toRawString = (v) => (v == null || v === '') ? '' : String(v);

// Computed v-model setters: changing one field updates the others.
// Ricevuto changed → keep Mancia, recalculate Resto.
const modalRicevutiComputed = computed({
  get() { return modalRicevuto.value; },
  set(v) {
    // Store the raw string without formatting so the cursor position is not
    // disrupted while the user is typing. Downstream computed values
    // (modalRicevutoParsed etc.) use parseFloat() and handle raw strings fine.
    const raw = toRawString(v);
    modalRicevuto.value = raw;
    const num = parseFloat(raw) || 0;
    const excess = Math.max(0, num - amountBeingPaid.value);
    if (!modalIsCash.value) {
      // Electronic: full excess goes to Mancia automatically.
      modalMancia.value = excess > 0 ? excess.toFixed(2) : '';
      modalResto.value = '';
    } else {
      // Cash: keep existing Mancia ratio, let Resto absorb the rest.
      const mancia = Math.min(excess, Math.max(0, parseFloat(modalMancia.value) || 0));
      modalMancia.value = mancia > 0 ? mancia.toFixed(2) : '';
      modalResto.value = (excess - mancia) > 0 ? (excess - mancia).toFixed(2) : '';
    }
  },
});

// Resto changed → recalculate Mancia (only cash). Clamped to available excess.
const modalRestoComputed = computed({
  get() { return modalResto.value; },
  set(v) {
    const excess = modalExcess.value;
    const raw = toRawString(v);
    const parsed = Math.max(0, parseFloat(raw) || 0);
    const resto = Math.min(parsed, excess);
    // If the value was clamped to a different number, format it to show the correction clearly.
    // Otherwise keep the raw string so cursor position is not disrupted while typing.
    modalResto.value = resto > 0
      ? (resto < parsed ? resto.toFixed(2) : raw)
      : '';
    modalMancia.value = (excess - resto) > 0 ? (excess - resto).toFixed(2) : '';
  },
});

// Mancia changed → recalculate Resto (only cash). Clamped to available excess.
const modalManciaComputed = computed({
  get() { return modalMancia.value; },
  set(v) {
    const excess = modalExcess.value;
    const raw = toRawString(v);
    const parsed = Math.max(0, parseFloat(raw) || 0);
    const mancia = Math.min(parsed, excess);
    // If the value was clamped to a different number, format it to show the correction clearly.
    // Otherwise keep the raw string so cursor position is not disrupted while typing.
    modalMancia.value = mancia > 0
      ? (mancia < parsed ? mancia.toFixed(2) : raw)
      : '';
    if (modalIsCash.value) {
      modalResto.value = (excess - mancia) > 0 ? (excess - mancia).toFixed(2) : '';
    }
  },
});

// ── Discount preview (not yet applied) ────────────────────────────────────
const discountPreview = computed(() => {
  if (!discountsEnabled.value) return 0;
  const val = parseFloat(discountInput.value) || 0;
  if (discountType.value === 'percent') {
    const clampedPct = Math.min(100, Math.max(0, val));
    return Math.min(tableAmountRemaining.value, (tableAmountRemaining.value * clampedPct) / 100);
  }
  return Math.min(tableAmountRemaining.value, Math.max(0, val));
});

// True when the user has entered an out-of-range discount value (to show warning).
const discountInputExceedsMax = computed(() => {
  const val = parseFloat(discountInput.value) || 0;
  if (val <= 0) return false;
  if (discountType.value === 'percent') return val > 100;
  return val > tableAmountRemaining.value;
});

// ── Checkout amounts ───────────────────────────────────────────────────────
const amountBeingPaid = computed(() => {
  if (checkoutMode.value === 'unico') return tableAmountRemaining.value;
  if (checkoutMode.value === 'romana') return quotaRomana.value;
  if (checkoutMode.value === 'analitica') return analiticaAmount.value;
  return customPayAmount.value;
});

const canPay = computed(() => {
  if (tableAmountRemaining.value <= BILL_SETTLED_THRESHOLD) return false;
  if (checkoutMode.value === 'ordini' && selectedOrdersToPay.value.length === 0) return false;
  if (checkoutMode.value === 'analitica') {
    if (!flatAnaliticaItems.value.some(i => (analiticaQty.value[i.key] || 0) > 0)) return false;
    if (analiticaSelectionExceedsRemaining.value) return false;
  }
  return true;
});

// ── Romana: clamp romanaSplitCount when splitWays changes ─────────────────
// Minimum allowed splitWays (must be at least splitPaidQuotas + 1)
const minSplitWays = computed(() => Math.max(2, splitPaidQuotas.value + 1));

watch(splitWays, (newVal) => {
  const waysLeft = newVal - splitPaidQuotas.value;
  if (romanaSplitCount.value > Math.max(1, waysLeft)) {
    romanaSplitCount.value = Math.max(1, waysLeft);
  }
});

// ── Helper: payment method icon ────────────────────────────────────────────
function getPaymentIcon(methodIdOrLabel) {
  const m = store.config.paymentMethods.find(x => x.label === methodIdOrLabel || x.id === methodIdOrLabel);
  if (!m) return Banknote;
  return m.icon === 'credit-card' ? CreditCard : Banknote;
}

// ── Analitica mode: increment / decrement per-item quantity ───────────────
function incrementAnalitica(key, max) {
  const current = analiticaQty.value[key] || 0;
  if (current < max) analiticaQty.value[key] = current + 1;
}

function decrementAnalitica(key) {
  const current = analiticaQty.value[key] || 0;
  if (current <= 1) {
    delete analiticaQty.value[key];
  } else {
    analiticaQty.value[key] = current - 1;
  }
}

// ── Analitica mode: select all at max qty / deselect all ───────────────────
function toggleSelectAllVoci() {
  const allMaxed = flatAnaliticaItems.value.every(i => (analiticaQty.value[i.key] || 0) === i.netQty);
  if (allMaxed) {
    analiticaQty.value = {};
  } else {
    const newQty = {};
    for (const item of flatAnaliticaItems.value) newQty[item.key] = item.netQty;
    analiticaQty.value = newQty;
  }
}

function toggleOrderSelection(ordId) {
  const idx = selectedOrdersToPay.value.indexOf(ordId);
  if (idx === -1) {
    selectedOrdersToPay.value.push(ordId);
  } else {
    selectedOrdersToPay.value.splice(idx, 1);
  }
}

// ── Computed: grouped menu view (items aggregated by dish name) ────────────
const tableMenuGrouped = computed(() => {
  const dishMap = new Map();
  for (const ord of tableOrders.value) {
    if (!KITCHEN_ACTIVE_STATUSES.includes(ord.status)) continue; // all active kitchen orders appear in the grouped summary
    for (let idx = 0; idx < ord.orderItems.length; idx++) {
      const item = ord.orderItems[idx];
      const key = item.name;
      if (!dishMap.has(key)) {
        dishMap.set(key, {
          name: item.name,
          totalQty: 0,
          totalVoided: 0,
          totalSubtotal: 0,
          hasDirectEntry: false,
          modifiers: new Map(),
        });
      }
      const dish = dishMap.get(key);
      dish.totalQty += item.quantity;
      dish.totalVoided += (item.voidedQuantity || 0);
      dish.totalSubtotal += getOrderItemRowTotal(item);
      if (ord.isDirectEntry) dish.hasDirectEntry = true;

      // Count paid modifiers (variazioni a pagamento)
      for (let modIdx = 0; modIdx < (item.modifiers || []).length; modIdx++) {
        const mod = item.modifiers[modIdx];
        if (mod.price <= 0) continue;
        const modKey = `${mod.name}::${mod.price}`;
        if (!dish.modifiers.has(modKey)) {
          dish.modifiers.set(modKey, { name: mod.name, price: mod.price, qty: 0, voided: 0, modVoided: 0 });
        }
        const mg = dish.modifiers.get(modKey);
        mg.qty += item.quantity;
        const combinedVoided = (item.voidedQuantity || 0) + (mod.voidedQuantity || 0);
        const perItemVoided = Math.min(item.quantity, combinedVoided);
        mg.voided += perItemVoided;
        mg.modVoided += (mod.voidedQuantity || 0);
      }
    }
  }
  return Array.from(dishMap.values()).map(d => ({ ...d, modifiers: Array.from(d.modifiers.values()) }));
});

// ── Table actions ──────────────────────────────────────────────────────────
function openTableDetails(table) {
  const status = store.getTableStatus(table.id).status;
  if (status === 'free') {
    // Show people-count prompt before opening a free table
    pendingTableToOpen.value = table;
    peopleAdults.value = table.covers || 2;
    peopleChildren.value = 0;
    showPeopleModal.value = true;
  } else {
    _openTableModal(table);
  }
}

function _openTableModal(table) {
  selectedTable.value = table;
  const session = store.tableCurrentBillSession[table.id];
  // Default romana split to adults count; fall back to total people or table covers
  if (session) {
    splitWays.value = session.adults > 0 ? session.adults : (session.adults + session.children) || (table.covers || 2);
  } else {
    splitWays.value = table.covers || 2;
  }
  checkoutMode.value = 'unico';
  cassaViewMode.value = 'voce';
  selectedOrdersToPay.value = [];
  analiticaQty.value = {};
  romanaSplitCount.value = 1;
  discountInput.value = '';
  discountType.value = 'percent';
  discountExpanded.value = false;
  showPaymentModal.value = false;
  modalMethodId.value = null;
  modalRicevuto.value = '';
  modalResto.value = '';
  modalMancia.value = '';

  const pastRomana = store.transactions.filter(
    t => t.tableId === table.id && t.operationType === 'romana' &&
      (!session || t.billSessionId === session.billSessionId),
  );
  // FIX: sum romanaSplitCount per transaction (supports flexible multi-quota payments)
  splitPaidQuotas.value = pastRomana.reduce((sum, t) => sum + (t.romanaSplitCount || 1), 0);
  if (pastRomana.length > 0) {
    checkoutMode.value = 'romana';
    // FIX: restore splitWays from the LAST romana transaction (not the first)
    splitWays.value = pastRomana[pastRomana.length - 1].splitWays;
  }

  showTableModal.value = true;
}

function confirmPeopleAndOpenTable() {
  const table = pendingTableToOpen.value;
  if (!table) return;

  // Open a new billing session for this table seating
  const billSessionId = store.openTableSession(table.id, peopleAdults.value, peopleChildren.value);

  // Auto-add cover charge order if configured
  const cc = store.config.coverCharge;
  if (cc?.enabled && cc?.autoAdd) {
    const coverItems = [];
    if (peopleAdults.value > 0 && cc.priceAdult > 0) {
      coverItems.push({
        uid: 'cop_a_' + Math.random().toString(36).slice(2, 11),
        dishId: cc.dishId + '_adulto',
        name: cc.name,
        unitPrice: cc.priceAdult,
        quantity: peopleAdults.value,
        voidedQuantity: 0,
        notes: [],
        modifiers: [],
      });
    }
    if (peopleChildren.value > 0 && cc.priceChild > 0) {
      coverItems.push({
        uid: 'cop_c_' + Math.random().toString(36).slice(2, 11),
        dishId: cc.dishId + '_bambino',
        name: cc.name + ' bambino',
        unitPrice: cc.priceChild,
        quantity: peopleChildren.value,
        voidedQuantity: 0,
        notes: [],
        modifiers: [],
      });
    }
    if (coverItems.length > 0) {
      const coverOrder = store.addDirectOrder(table.id, billSessionId, coverItems);
      if (coverOrder) coverOrder.isCoverCharge = true;
    }
  }

  showPeopleModal.value = false;
  pendingTableToOpen.value = null;
  _openTableModal(table);
}

function closeTableModal() {
  showTableModal.value = false;
  selectedTable.value = null;
}

function createNewOrderForTable() {
  if (!selectedTable.value) return;
  const session = store.tableCurrentBillSession[selectedTable.value.id];
  const newOrd = {
    id: 'ord_' + Math.random().toString(36).slice(2, 11),
    table: selectedTable.value.id,
    billSessionId: session?.billSessionId ?? null,
    status: 'pending',
    time: new Date().toLocaleTimeString(appConfig.locale, { hour: '2-digit', minute: '2-digit', timeZone: appConfig.timezone }),
    totalAmount: 0, itemCount: 0, dietaryPreferences: {}, orderItems: [],
    globalNote: '',
    noteVisibility: { cassa: true, sala: true, cucina: true },
  };
  store.addOrder(newOrd);
  closeTableModal();
  emit('new-order-for-ordini', newOrd);
}

// ── Direct item entry modal ────────────────────────────────────────────────
const showDirectItemModal = ref(false);
const directItemMode = ref('menu'); // 'menu' | 'custom'
const directActiveMenuCategory = ref('');
const directCart = ref([]);
const directCustomName = ref('');
const directCustomPrice = ref('');

function onDirectCustomPriceInput(event) {
  const raw = event.target.value;
  const normalized = raw.replace(/,/g, '.');
  if (normalized !== raw) event.target.value = normalized;
  directCustomPrice.value = normalized;
}

/** True when the "Personalizzata" custom-entry tab is available (driven by config flag). */
const canShowCustomEntryTab = computed(
  () => store.config.billing?.allowCustomEntry !== false,
);

/**
 * Items pinned by appConfig.coverCharge — automatically injected into the
 * Personalizzata tab and cannot be removed from the UI.
 * Adulto is added when priceAdult > 0; bambino when priceChild > 0.
 */
const configLockedDirectItems = computed(() => getLockedDirectItems(store.config.coverCharge));

// Saved custom items — persisted in localStorage
// Key is derived from the instance name so multiple instances stay isolated.
const SAVED_CUSTOM_KEY = resolveCustomItemsKey();

const savedCustomItems = ref(
  (() => {
    try { return JSON.parse(localStorage.getItem(SAVED_CUSTOM_KEY) || '[]'); }
    catch (e) { console.warn('[CassaTableManager] Failed to load saved custom items:', e); return []; }
  })(),
);

watch(savedCustomItems, (val) => {
  try { localStorage.setItem(SAVED_CUSTOM_KEY, JSON.stringify(val)); }
  catch (e) { console.warn('[CassaTableManager] Failed to save custom items:', e); }
}, { deep: true });

function openDirectItemModal() {
  directCart.value = [];
  directItemMode.value = 'menu';
  directActiveMenuCategory.value = Object.keys(store.config.menu)[0] || '';
  directCustomName.value = '';
  directCustomPrice.value = '';
  showDirectItemModal.value = true;
}

function closeDirectItemModal() {
  showDirectItemModal.value = false;
  directCart.value = [];
  directCustomName.value = '';
  directCustomPrice.value = '';
}

/** Shared factory — builds a cart item with all required fields. */
function makeDirectCartItem(name, price, dishId = null) {
  return {
    uid: 'dir_' + Math.random().toString(36).slice(2, 11),
    dishId: dishId ?? ('custom_' + Math.random().toString(36).slice(2, 11)),
    name,
    unitPrice: price,
    quantity: 1,
    voidedQuantity: 0,
    notes: [],
    modifiers: [],
  };
}

/**
 * Finds an existing cart item by the given predicate and bumps its quantity,
 * or pushes `newItem` if none is found.
 */
function pushOrBumpDirectCart(predicate, newItem) {
  const existing = directCart.value.find(predicate);
  if (existing) { existing.quantity++; } else { directCart.value.push(newItem); }
}

function addMenuItemToDirectCart(item) {
  pushOrBumpDirectCart(
    c => c.dishId === item.id && c.notes.length === 0 && c.modifiers.length === 0,
    makeDirectCartItem(item.name, item.price, item.id),
  );
}

function updateDirectCartQty(idx, delta) {
  const newQty = directCart.value[idx].quantity + delta;
  if (newQty <= 0) {
    directCart.value.splice(idx, 1);
  } else {
    directCart.value[idx].quantity = newQty;
  }
}

function addCustomItemToDirectCart() {
  const name = directCustomName.value.trim();
  if (!name) return;
  const price = parseFloat(directCustomPrice.value) || 0;

  // Save to persistent list if not already present (same name+price)
  if (!savedCustomItems.value.some(s => s.name === name && s.price === price)) {
    savedCustomItems.value.unshift({ name, price });
  }

  directCart.value.push(makeDirectCartItem(name, price));
  directCustomName.value = '';
  directCustomPrice.value = '';
}

function addSavedCustomItemToDirectCart(saved) {
  pushOrBumpDirectCart(
    c => c.name === saved.name && c.unitPrice === saved.price,
    makeDirectCartItem(saved.name, saved.price),
  );
}

function removeSavedCustomItem(idx) {
  savedCustomItems.value.splice(idx, 1);
}

const directCartTotal = computed(() =>
  directCart.value.reduce((a, b) => a + b.unitPrice * b.quantity, 0),
);

function confirmDirectItems() {
  if (!selectedTable.value || directCart.value.length === 0) return;
  const session = store.tableCurrentBillSession[selectedTable.value.id];
  store.addDirectOrder(
    selectedTable.value.id,
    session?.billSessionId ?? null,
    directCart.value,
  );
  closeDirectItemModal();
}

// ── Manual bill close (shown when fully paid) ─────────────────────────────
const canManuallyCloseBill = computed(() =>
  !!selectedTable.value &&
  tableAmountRemaining.value <= BILL_SETTLED_THRESHOLD);

function closeTableBill() {
  if (!selectedTable.value) return;
  const session = store.tableCurrentBillSession[selectedTable.value.id];
  const billTxns = store.transactions.filter(
    t => t.tableId === selectedTable.value.id &&
      (!session || t.billSessionId === session.billSessionId),
  );
  const summary = {
    type: 'CONTO_CHIUSO',
    table: selectedTable.value.id,
    tableLabel: selectedTable.value.label,
    billSessionId: session?.billSessionId ?? null,
    closedAt: new Date().toISOString(),
    totalAmount: tableTotalAmount.value,
    totalPaid: tableAmountPaid.value,
    transactions: billTxns,
    orders: tableAcceptedPayableOrders.value.map(o => ({
      id: o.id,
      status: o.status,
      items: o.orderItems,
    })),
  };
  tableAcceptedPayableOrders.value.forEach(o => store.changeOrderStatus(o, 'completed'));
  jsonContext.value = 'receipt';
  jsonPayloadData.value = JSON.stringify(summary, null, 2);
  showPrecontoJson.value = true;
}

// ── Payment processing ─────────────────────────────────────────────────────
// extra: { grossAmount?, changeAmount?, tipAmount? }
//   grossAmount = total handed over (cash); changeAmount = returned to customer.
//   tipAmount = voluntary tip (mancia).
//   amountPaid always = bill portion (net of change and tip).
// overrideAmount: if provided, uses this instead of amountBeingPaid (for partial payments).
function processTablePayment(paymentMethodId, extra = {}, overrideAmount = null) {
  if (!selectedTable.value) return;

  const amount = overrideAmount !== null ? overrideAmount : amountBeingPaid.value;
  const tip = extra.tipAmount != null ? extra.tipAmount : 0;
  const session = store.tableCurrentBillSession[selectedTable.value.id];
  const payload = {
    transactionId: 'txn_' + Math.random().toString(36).slice(2, 11),
    tableId: selectedTable.value.id,
    billSessionId: session?.billSessionId ?? null,
    paymentMethod: store.config.paymentMethods.find(m => m.id === paymentMethodId)?.label || paymentMethodId,
    operationType: checkoutMode.value,
    amountPaid: amount,
    tipAmount: tip > 0 ? tip : undefined,
    timestamp: new Date().toISOString(),
    orderRefs: [],
  };

  // Record gross amount and change when customer overpays.
  // grossAmount = total handed to cashier; changeAmount = cash returned.
  // Invariant: amountPaid = grossAmount − changeAmount − tipAmount.
  if (extra.grossAmount != null) payload.grossAmount = extra.grossAmount;
  if (extra.changeAmount != null) payload.changeAmount = extra.changeAmount;

  if (checkoutMode.value === 'unico') {
    payload.orderRefs = tableAcceptedPayableOrders.value.map(o => o.id);
  } else if (checkoutMode.value === 'romana') {
    const quotaCount = romanaSplitCount.value;
    splitPaidQuotas.value += quotaCount;
    payload.romanaSplitCount = quotaCount;
    payload.splitQuota = splitPaidQuotas.value;
    payload.splitWays = splitWays.value;
    payload.orderRefs = tableAcceptedPayableOrders.value.map(o => o.id);
    romanaSplitCount.value = 1;
  } else if (checkoutMode.value === 'ordini') {
    payload.orderRefs = [...selectedOrdersToPay.value];
    // Orders are intentionally NOT marked completed here yet; they are handled below
    // after the transaction is recorded so the auto-close check sees correct balances.
  } else if (checkoutMode.value === 'analitica') {
    // Record which order IDs are involved and the specific item keys with their selected quantities.
    const selectedItems = flatAnaliticaItems.value.filter(i => (analiticaQty.value[i.key] || 0) > 0);
    payload.orderRefs = [...new Set(selectedItems.map(i => i.orderId))];
    payload.vociRefs = selectedItems.map(i => ({ key: i.key, qty: analiticaQty.value[i.key] }));
  }

  store.addTransaction(payload);

  // Mark only the selected orders as completed.
  // In ordini mode, only complete the selected orders when the payment fully
  // covers the amount due for those orders (i.e., it is not a partial payment).
  // Partial payments record the amount but leave the orders open so the
  // remaining balance can still be collected.
  if (checkoutMode.value === 'ordini') {
    if (amount + BILL_SETTLED_THRESHOLD >= amountBeingPaid.value) {
      tableAcceptedPayableOrders.value.forEach(o => {
        if (payload.orderRefs.includes(o.id)) store.changeOrderStatus(o, 'completed');
      });
    }
    selectedOrdersToPay.value = [];
  }

  // In analitica mode, complete any orders whose items AND paid modifiers are ALL fully selected
  // (selectedQty === netQty for every row belonging to that order).
  if (checkoutMode.value === 'analitica') {
    if (amount + BILL_SETTLED_THRESHOLD >= analiticaAmount.value) {
      const ordersToComplete = getOrdersToComplete(
        tableAcceptedPayableOrders.value,
        flatAnaliticaItems.value,
        analiticaQty.value,
      );
      for (const ord of tableAcceptedPayableOrders.value) {
        if (ordersToComplete.includes(ord.id)) store.changeOrderStatus(ord, 'completed');
      }
    }
    analiticaQty.value = {};
  }

  jsonContext.value = 'receipt';
  jsonPayloadData.value = JSON.stringify(payload, null, 2);
  showPrecontoJson.value = true;
}

// ── Payment modal helpers ──────────────────────────────────────────────────
// Opens the payment modal for the given method (pre-fills Ricevuto with amount due).
function openPaymentModal(methodId) {
  modalMethodId.value = methodId;
  modalRicevuto.value = '';
  modalResto.value = '';
  modalMancia.value = '';
  showPaymentModal.value = true;
}

// Closes and resets the payment modal.
function closePaymentModal() {
  keyboard.closeKeyboard();
  showPaymentModal.value = false;
  modalMethodId.value = null;
  modalRicevuto.value = '';
  modalResto.value = '';
  modalMancia.value = '';
}

// Swaps the Resto and Mancia amounts.
function swapRestoMancia() {
  const r = modalResto.value;
  modalResto.value = modalMancia.value;
  modalMancia.value = r;
}

// Confirms the payment from the modal: records the transaction and closes the modal.
// Partial payments (ricevuto < due) record only the ricevuto amount; the remaining
// balance stays open until a subsequent transaction completes it.
// Exception: in analitica mode partial payments are not allowed because vociRefs
// must exactly match the paid amount; the cashier must receive at least the full
// selected total.
function confirmPaymentModal() {
  if (!modalMethodId.value) return;
  const ricevuto = parseFloat(modalRicevuto.value) || 0;
  if (ricevuto <= 0) return;

  const due = amountBeingPaid.value;
  const dueCents = Math.round(due * 100);
  const ricevutoCents = Math.round(ricevuto * 100);
  // In analitica mode require full coverage at cent precision to keep vociRefs consistent.
  if (checkoutMode.value === 'analitica' && ricevutoCents < dueCents) return;
  const amountPaid = checkoutMode.value === 'analitica'
    ? dueCents / 100
    : Math.min(ricevuto, due);
  const extra = {};

  if (tipsEnabled.value && modalManciaParsed.value > 0) {
    extra.tipAmount = modalManciaParsed.value;
  }
  if (modalIsCash.value) {
    extra.grossAmount = ricevuto;
    if (modalRestoParsed.value > 0) extra.changeAmount = modalRestoParsed.value;
  }

  processTablePayment(modalMethodId.value, extra, amountPaid);
  closePaymentModal();
}

// ── Apply discount ─────────────────────────────────────────────────────────
function applyDiscount() {
  if (!selectedTable.value || discountPreview.value <= 0) return;
  const session = store.tableCurrentBillSession[selectedTable.value.id];
  const rawInput = parseFloat(discountInput.value) || 0;
  // For percent discounts store the (clamped) percentage value; for fixed discounts
  // store the actually applied amount (= discountPreview) so discountValue never
  // exceeds amountPaid and display stays consistent.
  const clampedPercent = Math.min(100, Math.max(0, rawInput));
  const discountValueToStore = discountType.value === 'percent' ? clampedPercent : discountPreview.value;
  store.addTransaction({
    transactionId: 'disc_' + Math.random().toString(36).slice(2, 11),
    tableId: selectedTable.value.id,
    billSessionId: session?.billSessionId ?? null,
    paymentMethod: 'Sconto',
    operationType: 'discount',
    discountType: discountType.value,
    discountValue: discountValueToStore,
    amountPaid: discountPreview.value,
    timestamp: new Date().toISOString(),
    orderRefs: [],
  });

  discountInput.value = '';
}

// ── JSON modal ─────────────────────────────────────────────────────────────
function generateTableCheckoutJson(ctx = 'table') {
  jsonContext.value = ctx;
  const payload = {
    type: 'PRECONTO_API_TAVOLO',
    table: selectedTable.value.id,
    grossAmount: tableTotalAmount.value,
    paymentsRecorded: tableAmountPaid.value,
    amountDue: tableAmountRemaining.value,
    kitchenItems: tableAcceptedPayableOrders.value.flatMap(o =>
      o.orderItems
        .filter(r => r.voidedQuantity !== r.quantity)
        .map(r => ({
          name: r.name,
          quantity: r.quantity - (r.voidedQuantity || 0),
          subtotal: r.unitPrice * (r.quantity - (r.voidedQuantity || 0)),
        })),
    ),
  };
  jsonPayloadData.value = JSON.stringify(payload, null, 2);
  showPrecontoJson.value = true;
}

function closeJsonModal() {
  showPrecontoJson.value = false;
  jsonPayloadData.value = '{}';
  if (selectedTable.value && tableAcceptedPayableOrders.value.length === 0 && !hasPendingOrdersInTable.value && tableAmountRemaining.value <= BILL_SETTLED_THRESHOLD) {
    closeTableModal();
  }
}

// ── Expose openTableDetails for parent (SalaView) ─────────────────────────
defineExpose({ openTableDetails, closeTableModal });
</script>
