<template>
  <!-- WORKSPACE: MAPPA SALA -->
  <div class="flex-1 flex flex-col bg-gray-100/80 overflow-y-auto p-4 md:p-8 relative min-h-0">
    <div class="max-w-6xl mx-auto w-full">
      <div class="flex justify-between items-center mb-4 md:mb-6">
        <h2 class="text-xl md:text-2xl font-black text-gray-800 flex items-center gap-2 md:gap-3">
          <Grid3x3 class="text-gray-500 size-6 md:size-8" /> Mappa Sala
        </h2>
        <!-- Legenda -->
        <div class="hidden sm:flex items-center gap-3 text-[10px] font-bold uppercase text-gray-500">
          <span class="flex items-center gap-1"><span class="size-3 rounded-full border-2 border-emerald-400 bg-emerald-100"></span> Libero</span>
          <span class="flex items-center gap-1"><span class="size-3 rounded-full border-2 border-amber-400 bg-amber-100"></span> Ordini in Attesa</span>
          <span class="flex items-center gap-1"><span class="size-3 rounded-full border-2 border-blue-400 bg-blue-100"></span> Conto Richiesto</span>
          <span class="flex items-center gap-1"><span class="size-3 rounded-full theme-bg border-2 border-white shadow-sm"></span> Occupato / In Cassa</span>
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
            <div class="text-5xl md:text-6xl font-black text-gray-900 mb-2">{{ store.config.ui.currency }}{{ tableAmountRemaining.toFixed(2) }}</div>

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
                <button @click="checkoutMode = 'unico'" :class="checkoutMode === 'unico' ? 'bg-white shadow-sm text-gray-900 border border-gray-200' : 'text-gray-500 hover:bg-gray-200/50'" class="flex-1 py-2 text-xs md:text-sm font-bold rounded-lg transition-all active:scale-95">Tutto/Rimanente</button>
                <button @click="checkoutMode = 'romana'" :class="checkoutMode === 'romana' ? 'bg-white shadow-sm text-gray-900 border border-gray-200' : 'text-gray-500 hover:bg-gray-200/50'" class="flex-1 py-2 text-xs md:text-sm font-bold rounded-lg transition-all active:scale-95">Alla Romana</button>
                <button @click="checkoutMode = 'ordini'" :class="checkoutMode === 'ordini' ? 'bg-white shadow-sm text-gray-900 border border-gray-200' : 'text-gray-500 hover:bg-gray-200/50'" class="flex-1 py-2 text-xs md:text-sm font-bold rounded-lg transition-all active:scale-95">Per Comanda</button>
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
  <!-- MODAL GLOBALE: CARRELLO AGGIUNTA MENU (da Cassa)                 -->
  <!-- ================================================================ -->
  <div v-if="showAddMenuModal" class="fixed inset-0 z-[80] bg-black/80 backdrop-blur-sm flex items-end md:items-center justify-center p-0 md:p-4">
    <div class="bg-white rounded-t-3xl md:rounded-3xl shadow-2xl w-full max-w-6xl h-[95dvh] md:h-[85vh] flex flex-col overflow-hidden relative">

      <div class="bg-gray-900 text-white p-3 md:p-4 flex justify-between items-center shrink-0">
        <div class="flex flex-col">
          <h3 class="font-bold text-base md:text-xl flex items-center gap-2"><BookOpen class="size-4 md:size-5 text-emerald-400" /> Aggiunta Piatti in Comanda</h3>
          <p class="text-[10px] text-gray-400 uppercase tracking-widest mt-0.5">Destinazione: Ord #{{ targetOrderForMenu ? targetOrderForMenu.id.substring(0,6) : '' }} - Tavolo {{ targetOrderForMenu?.table }}</p>
        </div>
        <button @click="closeMenuModal" class="bg-white/10 hover:bg-white/20 p-2 md:p-2.5 rounded-full transition-colors active:scale-95"><X class="size-5 md:size-5" /></button>
      </div>

      <div class="flex flex-1 min-h-0 flex-col md:flex-row">
        <!-- Categorie Menu -->
        <div class="w-full md:w-[220px] border-b md:border-b-0 md:border-r border-gray-200 bg-gray-50 flex md:flex-col overflow-x-auto md:overflow-y-auto no-scrollbar shrink-0">
          <button v-for="(items, category) in store.config.menu" :key="'cat_'+category" @click="activeMenuCategory = category"
              class="whitespace-nowrap md:whitespace-normal md:w-full text-center md:text-left px-4 md:px-5 py-3 md:py-4 border-b-4 md:border-b-0 md:border-l-4 border-transparent font-bold transition-colors md:flex md:justify-between md:items-center text-sm md:text-base"
              :class="activeMenuCategory === category ? 'bg-white theme-text theme-border-b md:!border-b-transparent theme-border-l shadow-sm' : 'text-gray-600 hover:bg-gray-100'">
            {{ category }}
            <span v-if="activeMenuCategory === category" class="opacity-50 hidden md:flex items-center"><ChevronRight class="size-4" /></span>
          </button>
        </div>

        <!-- Piatti Griglia -->
        <div class="flex-1 overflow-y-auto p-2 md:p-4 bg-gray-100 md:bg-white grid grid-cols-2 sm:grid-cols-2 lg:grid-cols-3 gap-2 md:gap-3 content-start min-h-0">
          <button v-for="item in store.config.menu[activeMenuCategory]" :key="'item_'+item.id" @click="addToTempCart(item)"
              class="text-left bg-white border border-gray-200 rounded-xl md:rounded-2xl p-3 md:p-4 hover:border-emerald-400 shadow-sm transition-all active:scale-[0.98] group flex flex-col justify-between h-full min-h-[100px] md:min-h-[120px] relative">

            <span v-if="getQtyCombined(item.id) > 0" class="absolute -top-2 -right-2 bg-emerald-500 text-white size-6 md:size-7 rounded-full flex items-center justify-center text-[10px] md:text-xs font-black border-2 border-white shadow-sm z-10">
              {{ getQtyCombined(item.id) }}
            </span>
            <div class="flex justify-between items-start w-full gap-2">
              <h4 class="font-bold text-gray-800 text-xs md:text-sm leading-tight group-hover:theme-text transition-colors">{{ item.name }}</h4>
              <span class="font-black theme-text text-xs md:text-sm shrink-0 bg-emerald-50 px-1.5 py-0.5 rounded border border-emerald-100">{{ store.config.ui.currency }}{{ item.price.toFixed(2) }}</span>
            </div>
            <div class="mt-2 text-[9px] md:text-[10px] text-gray-400 font-bold uppercase tracking-wider flex items-center gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
              <Plus class="size-3" /> Aggiungi al Carrello
            </div>
          </button>
        </div>

        <!-- CARRELLO TEMPORANEO -->
        <div class="w-full md:w-[320px] bg-gray-50 border-t md:border-t-0 md:border-l border-gray-200 flex flex-col shrink-0 h-[40vh] max-h-[40vh] md:max-h-none md:h-auto min-h-0">
          <div class="p-3 bg-gray-100 border-b border-gray-200 font-bold text-gray-700 text-xs uppercase tracking-wider flex items-center gap-2 shrink-0 shadow-sm z-10">
            <ShoppingCart class="size-4" /> Carrello Preparazione
          </div>
          <div class="flex-1 overflow-y-auto p-3 space-y-2">
            <div v-if="tempCart.length === 0" class="text-center text-gray-400 py-8 flex flex-col items-center">
              <MousePointerClick class="size-8 opacity-30 mb-2" />
              <p class="text-xs font-medium">Tocca i piatti nel menu per prepararli qui, poi inseriscili.</p>
            </div>
            <div v-for="(cartItem, idx) in tempCart" :key="'cart_'+idx" class="bg-white rounded-lg border border-gray-200 shadow-sm overflow-hidden">
              <div class="p-2.5 flex items-center justify-between">
                <div class="flex flex-col flex-1 min-w-0 pr-2">
                  <span class="font-bold text-sm text-gray-800 truncate">{{ cartItem.name }}</span>
                  <span class="text-[10px] text-gray-500">{{ store.config.ui.currency }}{{ (cartItem.unitPrice + (cartItem.modifiers || []).reduce((a, m) => a + (Number(m.price) || 0), 0)).toFixed(2) }} cad.</span>
                </div>
                <div class="flex items-center gap-1 bg-gray-100 rounded p-0.5 shrink-0 border border-gray-200">
                  <button @click="updateTempCartQty(idx, -1)" class="size-6 flex items-center justify-center bg-white text-gray-600 rounded shadow-sm active:scale-95"><Minus class="size-3" /></button>
                  <span class="w-5 text-center font-black text-sm">{{ cartItem.quantity }}</span>
                  <button @click="updateTempCartQty(idx, 1)" class="size-6 flex items-center justify-center bg-white theme-text rounded shadow-sm active:scale-95"><Plus class="size-3" /></button>
                </div>
              </div>
              <!-- Uscita selector -->
              <div class="px-2.5 pb-2 flex gap-1">
                <button v-for="opt in courseOptions" :key="opt.value" @click="cartItem.course = opt.value"
                  :class="cartItem.course === opt.value ? opt.activeClass : 'bg-gray-50 border-gray-200 text-gray-500'"
                  class="flex-1 text-[9px] font-bold py-1 rounded border transition-all active:scale-95">
                  {{ opt.label }}
                </button>
              </div>
            </div>
          </div>
          <div class="p-3 md:p-4 bg-white border-t border-gray-200 shrink-0 pb-8 md:pb-4 shadow-[0_-5px_15px_rgba(0,0,0,0.05)] z-10">
            <div class="flex justify-between items-center mb-3">
              <span class="text-[10px] font-bold text-gray-500 uppercase tracking-widest">Totale Aggiunte:</span>
              <span class="font-black text-lg text-gray-900">{{ store.config.ui.currency }}{{ tempCartTotal.toFixed(2) }}</span>
            </div>
            <button @click="confirmAndPushCart" :disabled="tempCart.length === 0" class="w-full theme-bg text-white py-3 md:py-4 rounded-xl font-bold shadow-md hover:opacity-90 transition-opacity active:scale-95 text-sm flex items-center justify-center gap-2 disabled:opacity-50 disabled:cursor-not-allowed">
              <CheckCircle class="size-5" /> <span>Inserisci nella Comanda</span>
            </button>
          </div>
        </div>
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
</template>

<script setup>
import { ref, computed, onMounted, onUnmounted } from 'vue';
import { useRouter } from 'vue-router';
import {
  Grid3x3, Users, X, Plus, Coffee, Edit, AlertTriangle, CheckCircle,
  Ban, Undo2, Code, Minus, BookOpen, ChevronRight, ShoppingCart, MousePointerClick,
  Receipt, ArrowRightLeft, Merge, Timer,
} from 'lucide-vue-next';
import { Banknote, CreditCard } from 'lucide-vue-next';
import { useAppStore } from '../store/index.js';
import { updateOrderTotals } from '../utils/index.js';

const emit = defineEmits(['open-order-from-table']);

const store = useAppStore();
const router = useRouter();

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
  return store.orders
    .filter(o => o.table === selectedTable.value.id && o.status === 'accepted')
    .reduce((acc, o) => acc + o.totalAmount, 0);
});

const tableTransactions = computed(() => {
  if (!selectedTable.value) return [];
  return store.transactions.filter(t => t.tableId === selectedTable.value.id);
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
  selectedTable.value = table;
  splitWays.value = table.covers || 2;
  checkoutMode.value = 'unico';
  selectedOrdersToPay.value = [];

  const pastRomana = store.transactions.filter(
    t => t.tableId === table.id && t.operationType === 'romana',
  );
  splitPaidQuotas.value = pastRomana.length;
  if (pastRomana.length > 0) {
    checkoutMode.value = 'romana';
    splitWays.value = pastRomana[0].splitWays;
  }

  showTableModal.value = true;
}

function closeTableModal() {
  showTableModal.value = false;
  selectedTable.value = null;
}

function createNewOrderForTable() {
  if (!selectedTable.value) return;
  const newOrd = {
    id: 'ord_' + Math.random().toString(36).slice(2, 11),
    table: selectedTable.value.id,
    status: 'pending',
    time: new Date().toLocaleTimeString('it-IT', { hour: '2-digit', minute: '2-digit' }),
    totalAmount: 0, itemCount: 0, dietaryPreferences: {}, orderItems: [],
  };
  store.addOrder(newOrd);
  openAddMenu(newOrd);
}

// ── Payment processing ─────────────────────────────────────────────────────
function processTablePayment(paymentMethodId) {
  if (!selectedTable.value) return;

  const amount = amountBeingPaid.value;
  const payload = {
    transactionId: 'txn_' + Math.random().toString(36).slice(2, 11),
    tableId: selectedTable.value.id,
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
      if (selectedOrdersToPay.value.includes(o.id)) o.status = 'completed';
    });
    selectedOrdersToPay.value = [];
  }

  store.addTransaction(payload);

  if (tableAmountRemaining.value <= 0.01) {
    tableAcceptedPayableOrders.value.forEach(o => (o.status = 'completed'));
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

// ── Add Menu modal ─────────────────────────────────────────────────────────
const showAddMenuModal = ref(false);
const targetOrderForMenu = ref(null);
const tempCart = ref([]);
const activeMenuCategory = ref(Object.keys(store.config.menu)[0]);

// ── Course options ─────────────────────────────────────────────────────────
const courseOptions = [
  { value: 'prima', label: 'Esce prima', activeClass: 'bg-orange-100 border-orange-400 text-orange-800' },
  { value: 'insieme', label: 'Insieme', activeClass: 'theme-bg text-white border-transparent' },
  { value: 'dopo', label: 'Esce dopo', activeClass: 'bg-teal-100 border-teal-400 text-teal-800' },
];

const tempCartTotal = computed(() =>
  tempCart.value.reduce((a, b) => {
    const modTotal = (b.modifiers || []).reduce((ma, m) => ma + (m.price || 0), 0);
    return a + (b.unitPrice + modTotal) * b.quantity;
  }, 0),
);

function getQtyCombined(itemId) {
  let qOrd = 0;
  if (targetOrderForMenu.value) {
    const ex = targetOrderForMenu.value.orderItems.find(
      r => r.dishId === itemId && (!r.notes || r.notes.length === 0),
    );
    if (ex) qOrd = ex.quantity - (ex.voidedQuantity || 0);
  }
  const cEx = tempCart.value.find(r => r.dishId === itemId);
  return qOrd + (cEx ? cEx.quantity : 0);
}

function addToTempCart(item) {
  const existing = tempCart.value.find(r => r.dishId === item.id && (!r.modifiers || r.modifiers.length === 0));
  if (existing) existing.quantity++;
  else tempCart.value.push({ uid: 'tmp_' + Math.random().toString(36).slice(2, 11), dishId: item.id, name: item.name, unitPrice: item.price, quantity: 1, notes: [], voidedQuantity: 0, modifiers: [], course: 'insieme' });
}

function updateTempCartQty(idx, delta) {
  tempCart.value[idx].quantity += delta;
  if (tempCart.value[idx].quantity <= 0) tempCart.value.splice(idx, 1);
}

function openAddMenu(targetOrder) {
  targetOrderForMenu.value = targetOrder;
  tempCart.value = [];
  showAddMenuModal.value = true;
}

function closeMenuModal() {
  showAddMenuModal.value = false;
  targetOrderForMenu.value = null;
  tempCart.value = [];
}

function confirmAndPushCart() {
  if (!targetOrderForMenu.value || tempCart.value.length === 0) return;
  const isNewFromCassa = targetOrderForMenu.value.status === 'pending';
  const ordRef = targetOrderForMenu.value;

  tempCart.value.forEach(cartItem => {
    const hasModifiers = cartItem.modifiers && cartItem.modifiers.length > 0;
    const hasCourse = cartItem.course && cartItem.course !== 'insieme';
    if (!hasModifiers && !hasCourse) {
      const existing = ordRef.orderItems.find(
        r => r.dishId === cartItem.dishId && (!r.notes || r.notes.length === 0) && (!r.modifiers || r.modifiers.length === 0),
      );
      if (existing) { existing.quantity += cartItem.quantity; return; }
    }
    cartItem.uid = 'r_new_' + Math.random().toString(36).slice(2, 11);
    ordRef.orderItems.push(cartItem);
  });
  updateOrderTotals(ordRef);
  closeMenuModal();

  // If new order from Cassa, navigate to Orders view to manage it
  if (isNewFromCassa) {
    closeTableModal();
    router.push('/ordini');
  }
}

// ── Expose openTableDetails for parent (SalaView) ─────────────────────────
defineExpose({ openTableDetails, closeTableModal });
</script>
