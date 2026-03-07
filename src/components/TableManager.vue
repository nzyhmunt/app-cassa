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
      <div class="flex flex-wrap items-center gap-2 mb-4 md:mb-5">
        <div class="flex items-center gap-2 bg-white rounded-xl px-3 py-2 shadow-sm border border-gray-200">
          <span class="size-2.5 rounded-full border-2 border-emerald-400 bg-emerald-100 shrink-0"></span>
          <span class="text-xs font-bold text-gray-700">{{ freeTablesCount }} Liberi</span>
        </div>
        <div class="flex items-center gap-2 bg-white rounded-xl px-3 py-2 shadow-sm border border-gray-200">
          <span class="size-2.5 rounded-full theme-bg shrink-0"></span>
          <span class="text-xs font-bold text-gray-700">{{ occupiedTablesCount }} Occupati</span>
        </div>
        <div v-if="pendingTablesCount > 0" class="flex items-center gap-2 bg-amber-50 rounded-xl px-3 py-2 shadow-sm border border-amber-200">
          <span class="size-2.5 rounded-full border-2 border-amber-400 bg-amber-100 shrink-0"></span>
          <span class="text-xs font-bold text-amber-800">{{ pendingTablesCount }} In Attesa</span>
        </div>
      </div>

      <!-- Griglia Tavoli -->
      <div class="grid grid-cols-3 sm:grid-cols-4 lg:grid-cols-5 xl:grid-cols-6 gap-3 md:gap-5">
        <button v-for="table in store.config.tables" :key="table.id" @click="openTableDetails(table)"
                class="relative aspect-square rounded-[1.5rem] md:rounded-[2rem] border-[3px] md:border-[4px] flex flex-col items-center justify-center p-2 md:p-4 transition-transform active:scale-95 shadow-sm bg-white overflow-hidden group"
                :class="store.getTableColorClass(table.id)">

          <span class="absolute top-2 right-2 md:top-3 md:right-3 text-[9px] md:text-xs font-bold opacity-60 flex items-center gap-0.5 md:gap-1">
            <Users class="size-2.5 md:size-3" />{{ table.covers }}
          </span>
          <h3 class="text-xl md:text-3xl font-black mt-2">{{ table.label }}</h3>

          <div v-if="store.getTableStatus(table.id).status !== 'free'" class="mt-auto text-center w-full">
            <!-- Elapsed time badge -->
            <span v-if="getElapsedTime(table.id)" class="absolute bottom-2 left-2 text-[8px] font-bold opacity-70 flex items-center gap-0.5">
              <Timer class="size-2.5" />{{ getElapsedTime(table.id) }}
            </span>
            <span class="block text-[8px] md:text-[10px] font-bold uppercase tracking-widest opacity-80 mb-0.5 md:mb-1 truncate">
              {{ store.getTableStatus(table.id).status === 'pending' ? 'Attesa' : store.getTableStatus(table.id).status === 'conto_richiesto' ? 'Conto!' : 'In Cassa' }}
            </span>
            <span class="block font-black text-sm md:text-lg bg-white/20 rounded-md md:rounded-lg py-0.5 px-1 truncate">
              {{ store.config.ui.currency }}{{ store.getTableStatus(table.id).remaining.toFixed(2) }}
            </span>
          </div>
          <div v-else class="mt-auto text-center w-full opacity-30">
            <span class="block text-[9px] md:text-[10px] font-bold uppercase tracking-widest">Libero</span>
          </div>
        </button>
      </div>

      <!-- Riepilogo Conti Chiusi -->
      <ClosedBillsList />
    </div>
  </div>

  <!-- ================================================================ -->
  <!-- MODAL: GESTIONE TAVOLO IN CASSA E PAGAMENTI                      -->
  <!-- ================================================================ -->
  <div v-if="showTableModal && selectedTable" class="fixed inset-0 z-[60] bg-black/70 backdrop-blur-sm flex items-end md:items-center justify-center p-0 md:p-4">
    <div class="bg-white rounded-t-3xl md:rounded-3xl shadow-2xl w-full max-w-6xl h-[95dvh] md:h-[90vh] flex flex-col overflow-hidden">

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
            class="px-3 py-2 rounded-xl font-bold text-[10px] md:text-xs flex items-center gap-1.5 transition-all active:scale-95 shrink-0"
            title="Segna Conto Richiesto">
            <Receipt class="size-4" /> <span class="hidden sm:inline">{{ store.billRequestedTables.has(selectedTable.id) ? 'Conto Richiesto' : 'Richiedi Conto' }}</span>
          </button>
          <!-- Sposta button -->
          <button v-if="tableOrders.length > 0" @click="openMoveModal"
            class="bg-white/10 hover:bg-white/20 px-3 py-2 rounded-xl font-bold text-[10px] md:text-xs flex items-center gap-1.5 transition-all active:scale-95 shrink-0"
            title="Sposta Tavolo">
            <ArrowRightLeft class="size-4" /> <span class="hidden sm:inline">Sposta</span>
          </button>
          <!-- Unisci button -->
          <button v-if="tableOrders.length > 0" @click="openMergeModal"
            class="bg-white/10 hover:bg-white/20 px-3 py-2 rounded-xl font-bold text-[10px] md:text-xs flex items-center gap-1.5 transition-all active:scale-95 shrink-0"
            title="Unisci con altro Tavolo">
            <Merge class="size-4" /> <span class="hidden sm:inline">Unisci</span>
          </button>
          <!-- Storico Conti button -->
          <router-link
            to="/storico-conti"
            @click="closeTableModal"
            class="bg-white/10 hover:bg-white/20 px-3 py-2 rounded-xl font-bold text-[10px] md:text-xs flex items-center gap-1.5 transition-all active:scale-95 shrink-0 text-white"
            title="Cronologia Conti Chiusi"
            aria-label="Storico Conti"
          >
            <History class="size-4" /> <span class="hidden lg:inline">Storico Conti</span>
          </router-link>
          <button @click="closeTableModal" class="bg-white/10 hover:bg-white/20 p-2 md:p-2.5 rounded-full transition-colors active:scale-95"><X class="size-5 md:size-6" /></button>
        </div>
      </div>

      <div class="flex flex-1 min-h-0 flex-col lg:flex-row">

        <!-- PANNELLO SINISTRO: Riepilogo Comande e Storni dalla Cassa -->
        <div class="w-full lg:w-[55%] border-b lg:border-b-0 lg:border-r border-gray-200 bg-gray-50 flex flex-col min-h-[45%] lg:min-h-0">
          <div class="p-3 md:p-4 bg-white border-b border-gray-200 flex justify-between items-center shrink-0">
            <span class="font-bold text-gray-700 text-xs md:text-sm uppercase tracking-wider">Riepilogo Voci</span>
            <button @click="createNewOrderForTable" class="bg-gray-900 hover:bg-black text-white px-3 py-2 rounded-lg text-xs md:text-sm font-bold flex items-center gap-1.5 active:scale-95 shadow-sm transition-colors">
              <Plus class="size-4 md:size-5" /> <span class="hidden sm:inline">Nuova Comanda</span>
            </button>
          </div>

          <div class="flex-1 overflow-y-auto p-2 md:p-4 space-y-3">
            <div v-if="tableOrders.length === 0" class="text-center text-gray-400 py-8">
              <Coffee class="size-10 mx-auto mb-2 opacity-30" />
              <p class="text-sm font-medium">Il tavolo è libero.</p>
            </div>

            <!-- Card Singolo Ordine (Mappa Cassa) -->
            <div v-for="ord in tableOrders" :key="'cas_'+ord.id" class="bg-white p-3 rounded-xl border shadow-sm relative overflow-hidden group" :class="ord.status === 'pending' ? 'border-amber-200 bg-amber-50/30' : 'border-gray-200'">

              <div class="flex justify-between items-center border-b border-gray-100 pb-2 mb-3 pl-1">
                <div class="flex items-center gap-3">
                  <button v-if="ord.status === 'pending'" @click="$emit('open-order-from-table', ord)" class="p-2 md:p-2.5 text-[var(--brand-primary)] bg-[var(--brand-primary)]/10 hover:bg-[var(--brand-primary)]/20 border border-[var(--brand-primary)]/20 rounded-xl transition-all active:scale-95 flex items-center justify-center shadow-sm shrink-0" title="Modifica in vista Ordini">
                    <Edit class="size-5" />
                  </button>
                  <div class="flex flex-col">
                    <span class="font-bold text-gray-800 text-sm md:text-base flex items-center gap-1">Ord #{{ ord.id.substring(0,6) }}</span>
                    <span v-if="ord.status === 'pending'" class="text-[9px] md:text-[10px] font-bold uppercase text-amber-600 flex items-center gap-1 mt-0.5"><AlertTriangle class="size-3 md:size-3.5" /> In Attesa (Escluso Cassa)</span>
                    <span v-else class="text-[9px] md:text-[10px] font-bold uppercase text-emerald-600 flex items-center gap-1 mt-0.5"><CheckCircle class="size-3 md:size-3.5" /> In Cucina (Calcolato in Cassa)</span>
                  </div>
                </div>
                <div class="text-right">
                  <span class="font-black text-lg md:text-xl" :class="ord.status === 'pending' ? 'text-amber-700' : 'theme-text'">{{ store.config.ui.currency }}{{ ord.totalAmount.toFixed(2) }}</span>
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
                        <div v-if="item.notes && item.notes.length > 0" class="text-[9px] text-amber-600 font-bold italic truncate">{{ item.notes.join(', ') }}</div>
                        <!-- Modificatori -->
                        <div v-if="item.modifiers && item.modifiers.length > 0" class="flex flex-wrap gap-0.5 mt-0.5">
                          <span v-for="(mod, mi) in item.modifiers" :key="mi"
                            class="text-[8px] font-bold bg-purple-50 border border-purple-200 text-purple-700 px-1 rounded">
                            {{ mod.name }}{{ mod.price > 0 ? ' +€'+mod.price.toFixed(2) : '' }}
                          </span>
                        </div>
                        <!-- Uscita -->
                        <span v-if="item.course && item.course !== 'insieme'" class="text-[8px] font-bold uppercase px-1 py-0.5 rounded border mt-0.5 inline-block"
                          :class="item.course === 'prima' ? 'bg-orange-50 border-orange-200 text-orange-700' : 'bg-teal-50 border-teal-200 text-teal-700'">
                          {{ item.course === 'prima' ? 'Esce prima' : 'Esce dopo' }}
                        </span>
                      </div>
                    </div>
                    <div class="flex items-center gap-2 shrink-0">
                      <span class="font-black text-[13px] md:text-sm" :class="item.voidedQuantity === item.quantity ? 'text-gray-400 line-through' : 'text-gray-800'">
                        {{ store.config.ui.currency }}{{(getOrderItemUnitPrice(item) * (item.quantity - (item.voidedQuantity || 0))).toFixed(2)}}
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
                </div>
              </div>
            </div>
          </div>
        </div>

        <!-- PANNELLO DESTRA: Area Checkout e Transazioni -->
        <div class="w-full lg:w-[45%] bg-white flex flex-col relative z-20 shadow-[0_-10px_20px_rgba(0,0,0,0.05)] lg:shadow-none min-h-0">

          <div class="p-4 md:p-6 flex-1 overflow-y-auto">
            <div class="flex justify-between items-center mb-2">
              <h4 class="font-bold text-gray-400 uppercase tracking-widest text-[10px] md:text-xs flex items-center gap-1">Conto Da Pagare <span class="bg-gray-200 text-gray-600 px-1.5 rounded-full text-[9px] uppercase">Rimanente Netto</span></h4>
              <button @click="generateTableCheckoutJson('info')" class="text-blue-600 font-bold text-[10px] md:text-xs uppercase tracking-wider flex items-center gap-1.5 bg-blue-50 hover:bg-blue-100 px-3 py-2 rounded-lg border border-blue-200 transition-colors active:scale-95">
                <Code class="size-4" /> <span class="hidden sm:inline">Json Scontrino</span>
              </button>
            </div>

            <!-- Cifra Cassa Dinamica -->
            <div class="mb-2">
              <div class="text-[10px] font-bold text-gray-400 uppercase tracking-wider mb-0.5">Totale conto: <span class="text-gray-600">{{ store.config.ui.currency }}{{ tableTotalAmount.toFixed(2) }}</span></div>
              <div class="text-5xl md:text-6xl font-black text-gray-900">{{ store.config.ui.currency }}{{ tableAmountRemaining.toFixed(2) }}</div>
            </div>

            <!-- Storico Transazioni -->
            <div v-if="tableTransactions.length > 0" class="mb-5 space-y-2">
              <h5 class="text-[10px] font-bold text-gray-400 uppercase tracking-wider border-b border-gray-100 pb-1">Storico Pagamenti Effettuati:</h5>
              <div v-for="(txn, tIdx) in tableTransactions" :key="txn.transactionId" class="text-xs font-bold text-emerald-700 bg-emerald-50 px-2.5 py-2 rounded-lg border border-emerald-200 flex flex-col gap-1 shadow-sm">
                <div class="flex items-center justify-between">
                  <span class="flex items-center gap-1.5">
                    <component :is="getPaymentIcon(txn.paymentMethod)" class="size-3.5" />
                    <span class="uppercase tracking-wider">{{ txn.paymentMethod }}</span>
                  </span>
                  <span class="font-black">{{ store.config.ui.currency }}{{ txn.amountPaid.toFixed(2) }}</span>
                </div>
                <span class="text-[9px] font-medium text-emerald-600 opacity-80">{{ new Date(txn.timestamp).toLocaleTimeString() }} - ID: {{ txn.transactionId }}</span>
              </div>
            </div>
            <div v-else class="mb-5"></div>

            <!-- Scelta Split Conto -->
            <div v-if="tableAmountRemaining > 0" class="space-y-4">
              <h4 class="font-bold text-gray-800 text-sm">Modalità Incasso:</h4>

              <div class="flex bg-gray-100 p-1 rounded-xl">
                <button @click="checkoutMode = 'unico'" :class="checkoutMode === 'unico' ? 'bg-white shadow-sm text-gray-900 border border-gray-200' : 'text-gray-500 hover:bg-gray-200/50'" class="flex-1 py-2 text-xs md:text-sm font-bold rounded-lg transition-all active:scale-95 flex items-center justify-center gap-1.5"><Layers class="size-3.5 shrink-0" />Tutto</button>
                <button @click="checkoutMode = 'romana'" :class="checkoutMode === 'romana' ? 'bg-white shadow-sm text-gray-900 border border-gray-200' : 'text-gray-500 hover:bg-gray-200/50'" class="flex-1 py-2 text-xs md:text-sm font-bold rounded-lg transition-all active:scale-95 flex items-center justify-center gap-1.5"><Users class="size-3.5 shrink-0" />Romana</button>
                <button @click="checkoutMode = 'ordini'" :class="checkoutMode === 'ordini' ? 'bg-white shadow-sm text-gray-900 border border-gray-200' : 'text-gray-500 hover:bg-gray-200/50'" class="flex-1 py-2 text-xs md:text-sm font-bold rounded-lg transition-all active:scale-95 flex items-center justify-center gap-1.5"><ListChecks class="size-3.5 shrink-0" />Comanda</button>
              </div>

              <!-- Romana -->
              <div v-if="checkoutMode === 'romana'" class="bg-blue-50 border border-blue-100 p-4 rounded-xl md:rounded-2xl transition-all">
                <label class="block text-xs font-bold text-blue-800 uppercase mb-3">Dividi Rimanenza In (Persone):</label>
                <div class="flex items-center gap-3">
                  <button @click="splitWays > 1 ? splitWays-- : null" class="size-12 bg-white rounded-xl flex items-center justify-center font-black text-blue-600 shadow-sm border border-blue-100 active:scale-95 transition-all"><Minus class="size-5" /></button>
                  <span class="text-3xl font-black text-blue-900 w-16 text-center">{{ splitWays }}</span>
                  <button @click="splitWays++" class="size-12 bg-white rounded-xl flex items-center justify-center font-black text-blue-600 shadow-sm border border-blue-100 active:scale-95 transition-all"><Plus class="size-5" /></button>
                </div>
                <div class="mt-4 pt-3 border-t border-blue-200 flex justify-between items-center">
                  <span class="font-bold text-blue-800 text-sm">Quota da incassare:</span>
                  <span class="font-black text-2xl text-blue-600">{{ store.config.ui.currency }}{{ quotaRomana.toFixed(2) }}</span>
                </div>
              </div>

              <!-- Per Comanda -->
              <div v-if="checkoutMode === 'ordini'" class="bg-purple-50 border border-purple-100 p-4 rounded-xl md:rounded-2xl space-y-2 max-h-[150px] md:max-h-[250px] overflow-y-auto transition-all">
                <label class="block text-[10px] md:text-xs font-bold text-purple-800 uppercase mb-2">Comande Pagabili (Accettate):</label>
                <label v-for="ord in tableAcceptedPayableOrders" :key="'chk_'+ord.id" class="flex justify-between items-center p-3 bg-white rounded-xl cursor-pointer hover:border-purple-300 border border-transparent shadow-sm">
                  <div class="flex items-center gap-3">
                    <input type="checkbox" v-model="selectedOrdersToPay" :value="ord.id" class="size-5 accent-purple-600 rounded">
                    <span class="text-sm font-bold text-gray-700 leading-none">Comanda #{{ ord.id.substring(0,4) }}</span>
                  </div>
                  <span class="font-black text-base text-purple-700">{{ store.config.ui.currency }}{{ ord.totalAmount.toFixed(2) }}</span>
                </label>
                <div v-if="tableAcceptedPayableOrders.length === 0" class="text-xs text-purple-600 font-bold italic">Nessuna comanda disponibile o da pagare.</div>
              </div>
            </div>
          </div>

          <!-- Bottoni di Pagamento -->
          <div class="p-4 md:p-6 bg-gray-50 border-t border-gray-200 shrink-0 pb-6 md:pb-5">
            <div v-if="hasPendingOrdersInTable" class="mb-3 bg-amber-100 text-amber-800 p-3 rounded-xl text-[10px] md:text-xs font-bold flex items-center gap-2 border border-amber-200 shadow-sm">
              <AlertTriangle class="size-5 shrink-0" /> <span>Tavolo con comande in Attesa. Se incassi ora, il tavolo <b>resterà aperto</b> per quelle voci.</span>
            </div>

            <div v-if="checkoutMode !== 'unico' && tableAmountRemaining > 0" class="flex justify-between items-center mb-3 px-1">
              <span class="text-xs font-bold text-gray-500 uppercase tracking-wider">Acconto Corrente:</span>
              <span class="text-xl font-black theme-text">{{ store.config.ui.currency }}{{ amountBeingPaid.toFixed(2) }}</span>
            </div>

            <div class="grid grid-cols-2 gap-3">
              <button v-for="method in store.config.paymentMethods" :key="method.id" @click="processTablePayment(method.id)" :disabled="!canPay" :class="method.colorClass" class="py-4 border-2 rounded-xl md:rounded-2xl font-bold flex items-center justify-center gap-2 transition-all disabled:opacity-50 disabled:bg-gray-100 disabled:border-gray-300 disabled:text-gray-400 active:scale-95 text-sm md:text-base">
                <component :is="getPaymentIcon(method.id)" class="size-5" /> {{ method.label }}
              </button>
            </div>

            <!-- Manual bill close button (shown when autoCloseOnFullPayment = false) -->
            <div v-if="canManuallyCloseBill" class="mt-3">
              <button @click="closeTableBill" class="w-full py-3.5 bg-emerald-600 hover:bg-emerald-700 text-white font-bold rounded-xl active:scale-95 transition-all shadow-md flex items-center justify-center gap-2">
                <CheckCircle class="size-5" /> Chiudi Conto e Libera Tavolo
              </button>
            </div>
          </div>
        </div>
      </div>
    </div>
  </div>

  <!-- ================================================================ -->
  <!-- MODAL: RICEVUTA TRANSAZIONE E PRECONTO JSON API FISCALE          -->
  <!-- ================================================================ -->
  <div v-if="showPrecontoJson" class="fixed inset-0 z-[95] bg-black/80 backdrop-blur-sm flex items-center justify-center p-4">
    <div class="bg-gray-900 rounded-2xl w-full max-w-2xl h-[80vh] flex flex-col shadow-2xl border border-gray-700">
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
        <button @click="closeJsonModal" class="w-full md:w-auto px-8 bg-emerald-600 hover:bg-emerald-500 text-white py-3 rounded-xl font-bold transition-colors active:scale-95">Chiudi Scontrino e Continua</button>
      </div>
    </div>
  </div>

  <!-- ================================================================ -->
  <!-- MODAL: SPOSTA TAVOLO                                              -->
  <!-- ================================================================ -->
  <div v-if="showMoveModal" class="fixed inset-0 z-[100] bg-black/70 backdrop-blur-sm flex items-center justify-center p-4">
    <div class="bg-white rounded-2xl shadow-2xl w-full max-w-sm p-5">
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
    <div class="bg-white rounded-2xl shadow-2xl w-full max-w-sm p-5">
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
  <!-- ================================================================ -->
  <div v-if="showPeopleModal && pendingTableToOpen" class="fixed inset-0 z-[110] bg-black/70 backdrop-blur-sm flex items-center justify-center p-4">
    <div class="bg-white rounded-2xl shadow-2xl w-full max-w-sm p-6">
      <div class="flex justify-between items-center mb-5">
        <h3 class="font-bold text-gray-800 text-base flex items-center gap-2">
          <Users class="size-5 theme-text" /> Apri Tavolo {{ pendingTableToOpen?.label }}
        </h3>
        <button @click="showPeopleModal = false; pendingTableToOpen = null" class="text-gray-400 hover:text-gray-700 bg-gray-100 hover:bg-gray-200 rounded-full p-1.5 transition-colors">
          <X class="size-4" />
        </button>
      </div>

      <!-- Adults -->
      <div class="mb-5">
        <label class="block text-xs font-bold text-gray-500 uppercase tracking-wider mb-3">Adulti</label>
        <div class="flex items-center gap-4">
          <button @click="peopleAdults > 0 ? peopleAdults-- : null" class="size-12 bg-gray-100 hover:bg-gray-200 rounded-xl flex items-center justify-center font-black text-gray-700 active:scale-95 transition-all">
            <Minus class="size-5" />
          </button>
          <span class="text-4xl font-black text-gray-900 w-12 text-center">{{ peopleAdults }}</span>
          <button @click="peopleAdults++" class="size-12 bg-gray-100 hover:bg-gray-200 rounded-xl flex items-center justify-center font-black text-gray-700 active:scale-95 transition-all">
            <Plus class="size-5" />
          </button>
        </div>
      </div>

      <!-- Children -->
      <div class="mb-5">
        <label class="block text-xs font-bold text-gray-500 uppercase tracking-wider mb-3">Bambini</label>
        <div class="flex items-center gap-4">
          <button @click="peopleChildren > 0 ? peopleChildren-- : null" class="size-12 bg-gray-100 hover:bg-gray-200 rounded-xl flex items-center justify-center font-black text-gray-700 active:scale-95 transition-all">
            <Minus class="size-5" />
          </button>
          <span class="text-4xl font-black text-gray-900 w-12 text-center">{{ peopleChildren }}</span>
          <button @click="peopleChildren++" class="size-12 bg-gray-100 hover:bg-gray-200 rounded-xl flex items-center justify-center font-black text-gray-700 active:scale-95 transition-all">
            <Plus class="size-5" />
          </button>
        </div>
      </div>

      <!-- Cover charge preview -->
      <div v-if="store.config.coverCharge?.enabled && store.config.coverCharge?.autoAdd && (peopleAdults > 0 || peopleChildren > 0)"
           class="mb-5 bg-emerald-50 border border-emerald-200 rounded-xl p-3 text-xs text-emerald-700">
        <p class="font-bold mb-1.5 flex items-center gap-1"><Receipt class="size-3.5" /> Coperto automatico:</p>
        <div v-if="peopleAdults > 0 && store.config.coverCharge.priceAdult > 0">
          {{ peopleAdults }} adult{{ peopleAdults === 1 ? 'o' : 'i' }} × {{ store.config.ui.currency }}{{ store.config.coverCharge.priceAdult.toFixed(2) }}
          = <strong>{{ store.config.ui.currency }}{{ (peopleAdults * store.config.coverCharge.priceAdult).toFixed(2) }}</strong>
        </div>
        <div v-if="peopleChildren > 0 && store.config.coverCharge.priceChild > 0">
          {{ peopleChildren }} bambin{{ peopleChildren === 1 ? 'o' : 'i' }} × {{ store.config.ui.currency }}{{ store.config.coverCharge.priceChild.toFixed(2) }}
          = <strong>{{ store.config.ui.currency }}{{ (peopleChildren * store.config.coverCharge.priceChild).toFixed(2) }}</strong>
        </div>
      </div>

      <button @click="confirmPeopleAndOpenTable"
              class="w-full py-3.5 theme-bg text-white font-bold rounded-xl active:scale-95 transition-all shadow-md flex items-center justify-center gap-2 text-sm md:text-base">
        <Users class="size-5" /> Apri Tavolo
      </button>
    </div>
  </div>
</template>

<script setup>
import { ref, computed, onMounted, onUnmounted } from 'vue';
import {
  Grid3x3, Users, X, Plus, Coffee, Edit, AlertTriangle, CheckCircle,
  Ban, Undo2, Code, Minus, Receipt, ArrowRightLeft, Merge, Timer,
  Layers, ListChecks, History,
} from 'lucide-vue-next';
import { Banknote, CreditCard } from 'lucide-vue-next';
import { useAppStore } from '../store/index.js';
import { updateOrderTotals } from '../utils/index.js';
import ClosedBillsList from './ClosedBillsList.vue';

const emit = defineEmits(['open-order-from-table', 'new-order-for-ordini']);

const store = useAppStore();

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

// ── Elapsed time timer ─────────────────────────────────────────────────────
const now = ref(Date.now());
let clockTimer = null;
onMounted(() => { clockTimer = setInterval(() => { now.value = Date.now(); }, 30000); });
onUnmounted(() => { if (clockTimer) clearInterval(clockTimer); });

function getElapsedTime(tableId) {
  const ts = store.tableOccupiedAt[tableId];
  if (!ts) return null;
  const diffMs = now.value - new Date(ts).getTime();
  const totalMin = Math.floor(diffMs / 60000);
  if (totalMin < 1) return null;
  const h = Math.floor(totalMin / 60);
  const m = totalMin % 60;
  return h > 0 ? `${h}h ${m}m` : `${m}m`;
}

// ── Checkout state ─────────────────────────────────────────────────────────
const checkoutMode = ref('unico');
const splitWays = ref(2);
const splitPaidQuotas = ref(0);
const selectedOrdersToPay = ref([]);

// ── People modal state (shown when opening a free table) ───────────────────
const showPeopleModal = ref(false);
const pendingTableToOpen = ref(null);
const peopleAdults = ref(2);
const peopleChildren = ref(0);

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
  tableOrders.value.filter(o => o.status === 'accepted'),
);

const tableTotalAmount = computed(() => {
  if (!selectedTable.value) return 0;
  const session = store.tableCurrentBillSession[selectedTable.value.id];
  return store.orders
    .filter(o => {
      if (o.table !== selectedTable.value.id) return false;
      if (o.status !== 'accepted' && o.status !== 'completed') return false;
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

const hasPendingOrdersInTable = computed(() =>
  tableOrders.value.some(o => o.status === 'pending'),
);

const customPayAmount = computed(() => {
  const val = tableAcceptedPayableOrders.value
    .filter(o => selectedOrdersToPay.value.includes(o.id))
    .reduce((acc, o) => acc + o.totalAmount, 0);
  return Math.min(val, tableAmountRemaining.value);
});

const quotaRomana = computed(() => {
  if (splitWays.value <= 0) return 0;
  const waysLeft = splitWays.value - splitPaidQuotas.value;
  if (waysLeft <= 0) return 0;
  return tableAmountRemaining.value / waysLeft;
});

const amountBeingPaid = computed(() => {
  if (checkoutMode.value === 'unico') return tableAmountRemaining.value;
  if (checkoutMode.value === 'romana') return quotaRomana.value;
  return customPayAmount.value;
});

const canPay = computed(() => {
  if (tableAmountRemaining.value <= 0.01) return false;
  if (checkoutMode.value === 'ordini' && selectedOrdersToPay.value.length === 0) return false;
  return true;
});

// ── Helper: payment method icon ────────────────────────────────────────────
function getPaymentIcon(methodIdOrLabel) {
  const m = store.config.paymentMethods.find(x => x.label === methodIdOrLabel || x.id === methodIdOrLabel);
  if (!m) return Banknote;
  return m.icon === 'credit-card' ? CreditCard : Banknote;
}

// ── Helper: unit price for an order item including modifiers ───────────────
function getOrderItemUnitPrice(item) {
  const modTotal = (item.modifiers || []).reduce((a, m) => a + (m.price || 0), 0);
  return item.unitPrice + modTotal;
}

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
  selectedOrdersToPay.value = [];

  const pastRomana = store.transactions.filter(
    t => t.tableId === table.id && t.operationType === 'romana' &&
      (!session || t.billSessionId === session.billSessionId),
  );
  splitPaidQuotas.value = pastRomana.length;
  if (pastRomana.length > 0) {
    checkoutMode.value = 'romana';
    splitWays.value = pastRomana[0].splitWays;
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
      });
    }
    if (coverItems.length > 0) {
      const coverOrder = {
        id: 'ord_' + Math.random().toString(36).slice(2, 11),
        table: table.id,
        billSessionId,
        time: new Date().toLocaleTimeString('it-IT', { hour: '2-digit', minute: '2-digit' }),
        totalAmount: 0,
        itemCount: 0,
        dietaryPreferences: {},
        orderItems: coverItems,
        isCoverCharge: true,
      };
      updateOrderTotals(coverOrder);
      store.addOrder(coverOrder);
      store.changeOrderStatus(coverOrder, 'accepted');
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
    time: new Date().toLocaleTimeString('it-IT', { hour: '2-digit', minute: '2-digit' }),
    totalAmount: 0, itemCount: 0, dietaryPreferences: {}, orderItems: [],
  };
  store.addOrder(newOrd);
  closeTableModal();
  emit('new-order-for-ordini', newOrd);
}

// ── Manual bill close (used when autoCloseOnFullPayment = false) ───────────
const autoCloseOnFullPayment = computed(() => store.config.billing?.autoCloseOnFullPayment ?? true);

const canManuallyCloseBill = computed(() =>
  !autoCloseOnFullPayment.value &&
  tableAmountRemaining.value <= 0.01 &&
  tableAcceptedPayableOrders.value.length > 0,
);

function closeTableBill() {
  if (!selectedTable.value) return;
  tableAcceptedPayableOrders.value.forEach(o => store.changeOrderStatus(o, 'completed'));
  closeTableModal();
}

// ── Payment processing ─────────────────────────────────────────────────────
function processTablePayment(paymentMethodId) {
  if (!selectedTable.value) return;

  const amount = amountBeingPaid.value;
  const session = store.tableCurrentBillSession[selectedTable.value.id];
  const payload = {
    transactionId: 'txn_' + Math.random().toString(36).slice(2, 11),
    tableId: selectedTable.value.id,
    billSessionId: session?.billSessionId ?? null,
    paymentMethod: store.config.paymentMethods.find(m => m.id === paymentMethodId)?.label || paymentMethodId,
    operationType: checkoutMode.value,
    amountPaid: amount,
    timestamp: new Date().toISOString(),
    orderRefs: [],
  };

  if (checkoutMode.value === 'unico') {
    payload.orderRefs = tableAcceptedPayableOrders.value.map(o => o.id);
  } else if (checkoutMode.value === 'romana') {
    splitPaidQuotas.value++;
    payload.splitQuota = splitPaidQuotas.value;
    payload.splitWays = splitWays.value;
    payload.orderRefs = tableAcceptedPayableOrders.value.map(o => o.id);
  } else if (checkoutMode.value === 'ordini') {
    payload.orderRefs = [...selectedOrdersToPay.value];
    tableAcceptedPayableOrders.value.forEach(o => {
      if (selectedOrdersToPay.value.includes(o.id)) store.changeOrderStatus(o, 'completed');
    });
    selectedOrdersToPay.value = [];
  }

  store.addTransaction(payload);

  // Close all accepted orders when fully paid, if autoCloseOnFullPayment is enabled
  if (autoCloseOnFullPayment.value && tableAmountRemaining.value <= 0.01) {
    tableAcceptedPayableOrders.value.forEach(o => store.changeOrderStatus(o, 'completed'));
  }

  jsonContext.value = 'receipt';
  jsonPayloadData.value = JSON.stringify(payload, null, 2);
  showPrecontoJson.value = true;
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
  if (selectedTable.value && tableAcceptedPayableOrders.value.length === 0 && !hasPendingOrdersInTable.value) {
    closeTableModal();
  }
}

// ── Expose openTableDetails for parent (SalaView) ─────────────────────────
defineExpose({ openTableDetails, closeTableModal });
</script>
