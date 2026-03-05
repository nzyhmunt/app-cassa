<template>
  <!-- WORKSPACE: GESTIONE ORDINI -->
  <div class="flex-1 flex overflow-hidden relative">

    <!-- SIDEBAR LISTA ORDINI -->
    <aside :class="['w-full md:w-[380px] lg:w-[450px] bg-white border-r border-gray-200 flex flex-col shadow-lg z-10 h-full shrink-0', selectedOrder ? 'hidden md:flex' : 'flex']">

      <div class="flex p-2 gap-1.5 bg-gray-50 border-b border-gray-200 shrink-0">
        <button @click="changeTab('pending')" :class="activeTab === 'pending' ? 'bg-amber-100 text-amber-800 border-amber-200 font-bold' : 'bg-white text-gray-500 border-gray-200 hover:bg-gray-100'" class="flex-1 py-2 md:py-3 px-1 rounded-xl border transition-all flex flex-col items-center justify-center gap-1 shadow-sm">
          <div class="relative">
            <Bell class="size-4 md:size-5" />
            <span v-if="store.pendingCount > 0" class="absolute -top-1.5 -right-2 bg-red-500 text-white text-[9px] font-bold size-4 flex items-center justify-center rounded-full border border-white">{{ store.pendingCount }}</span>
          </div>
          <span class="text-[9px] md:text-[10px] uppercase tracking-wider">In Attesa</span>
        </button>
        <button @click="changeTab('accepted')" :class="activeTab === 'accepted' ? 'bg-blue-100 text-blue-800 border-blue-200 font-bold' : 'bg-white text-gray-500 border-gray-200 hover:bg-gray-100'" class="flex-1 py-2 md:py-3 px-1 rounded-xl border transition-all flex flex-col items-center justify-center gap-1 shadow-sm">
          <ChefHat class="size-4 md:size-5" />
          <span class="text-[9px] md:text-[10px] uppercase tracking-wider">In Cucina</span>
        </button>
        <button @click="changeTab('history')" :class="activeTab === 'history' ? 'bg-gray-200 text-gray-800 border-gray-300 font-bold' : 'bg-white text-gray-500 border-gray-200 hover:bg-gray-100'" class="flex-1 py-2 md:py-3 px-1 rounded-xl border transition-all flex flex-col items-center justify-center gap-1 shadow-sm">
          <History class="size-4 md:size-5" />
          <span class="text-[9px] md:text-[10px] uppercase tracking-wider">Chiusi</span>
        </button>
      </div>

      <div class="flex-1 overflow-y-auto p-2 md:p-3 space-y-2.5 bg-gray-100/50 pb-20 md:pb-3">
        <div v-if="filteredOrders.length === 0" class="h-full flex flex-col items-center justify-center text-gray-400 opacity-60">
          <ClipboardList class="size-12 md:size-16 mb-4" />
          <p class="font-medium text-sm md:text-lg">Nessun ordine presente</p>
        </div>

        <transition-group name="list">
          <div v-for="order in filteredOrders" :key="order.id"
               @click="selectOrder(order)"
               :class="selectedOrder?.id === order.id ? 'ring-2 ring-offset-2 theme-border bg-white' : 'border-gray-200 hover:border-gray-300 bg-white'"
               class="p-3 md:p-4 rounded-2xl border shadow-sm cursor-pointer transition-all active:scale-[0.98]">

            <div class="flex justify-between items-start mb-2">
              <div class="flex items-center gap-3">
                <div class="size-10 rounded-full flex items-center justify-center font-black text-sm md:text-base bg-gray-100 text-gray-800 border-2 border-gray-200 shrink-0">
                  {{ order.tavolo }}
                </div>
                <div>
                  <h3 class="font-bold text-gray-800 text-sm md:text-base leading-tight">Tavolo {{ order.tavolo }}</h3>
                  <p class="text-[10px] text-gray-500 flex items-center gap-1 mt-0.5"><Clock class="size-3" /> {{ order.time }}</p>
                </div>
              </div>
              <div class="text-right">
                <span class="font-black text-base md:text-lg text-gray-800">{{ store.config.ui.currency }}{{ order.totale_importo.toFixed(2) }}</span>
              </div>
            </div>

            <div class="flex gap-2 flex-wrap mt-2 items-center">
              <span v-if="order.status === 'pending'" class="bg-amber-100 text-amber-800 text-[9px] md:text-[10px] uppercase font-bold px-2 py-1 rounded-md border border-amber-200 flex items-center gap-1"><AlertCircle class="size-3" /> In Attesa</span>
              <span v-if="order.status === 'accepted'" class="bg-blue-100 text-blue-800 text-[9px] md:text-[10px] uppercase font-bold px-2 py-1 rounded-md border border-blue-200 flex items-center gap-1"><ChefHat class="size-3" /> In Cucina</span>
              <span v-if="order.status === 'completed'" class="bg-emerald-100 text-emerald-800 text-[9px] md:text-[10px] uppercase font-bold px-2 py-1 rounded-md border border-emerald-200 flex items-center gap-1"><CheckCircle2 class="size-3" /> Pagato</span>
              <span v-if="order.status === 'rejected'" class="bg-red-100 text-red-800 text-[9px] md:text-[10px] uppercase font-bold px-2 py-1 rounded-md border border-red-200 flex items-center gap-1"><XCircle class="size-3" /> Annullato</span>
              <span class="bg-gray-100 text-gray-600 text-[9px] md:text-[10px] font-bold px-2 py-1 rounded-md border border-gray-200 ml-auto">{{ order.numero_articoli }} pz</span>
            </div>
          </div>
        </transition-group>
      </div>
    </aside>

    <!-- MAIN AREA: DETTAGLIO ORDINE -->
    <main :class="['flex-1 bg-gray-100 flex-col h-full overflow-hidden relative', selectedOrder ? 'flex' : 'hidden md:flex']">

      <div v-if="!selectedOrder" class="absolute inset-0 flex flex-col items-center justify-center text-gray-400 bg-gray-100">
        <MousePointerClick class="size-16 md:size-24 opacity-20 mb-4 md:mb-6" />
        <h2 class="text-xl md:text-2xl font-bold text-gray-500">Gestione Comande</h2>
        <p class="text-sm text-gray-400 mt-2 hidden md:block">Seleziona un ordine per modificarlo o inviarlo in cucina.</p>
      </div>

      <div v-else :key="'det_'+selectedOrder.id" class="flex flex-col h-full w-full bg-white relative">

        <!-- Dettaglio Header -->
        <div class="bg-white border-b border-gray-200 p-3 md:p-5 shrink-0 shadow-sm z-10 flex flex-col sm:flex-row sm:justify-between sm:items-center gap-3 md:gap-4">
          <div class="flex items-center gap-3 flex-1">
            <button @click="selectedOrder = null" class="md:hidden p-2 -ml-2 bg-gray-100 hover:bg-gray-200 rounded-full text-gray-700 flex items-center justify-center">
              <ArrowLeft class="size-5" />
            </button>
            <div class="size-10 md:size-14 rounded-xl theme-bg text-white flex items-center justify-center font-black text-xl md:text-2xl shadow-inner shrink-0">
              {{ selectedOrder.tavolo }}
            </div>
            <div class="flex flex-col justify-center">
              <h2 class="text-lg md:text-2xl font-bold text-gray-800 leading-tight">Tavolo {{ selectedOrder.tavolo }}</h2>
              <div class="flex flex-wrap items-center gap-2 mt-0.5 md:mt-1">
                <span class="text-gray-500 text-[10px] md:text-xs font-medium"><Hash class="size-3 inline mr-0.5" />{{ selectedOrder.id.substring(0,8) }}</span>
                <span v-if="selectedOrder.preferenze_alimentari?.diete?.length > 0 || selectedOrder.preferenze_alimentari?.allergeni_dichiarati?.length > 0" class="text-red-500 font-bold uppercase text-[9px] flex items-center gap-0.5 bg-red-50 px-1.5 py-0.5 rounded border border-red-100">
                  <AlertTriangle class="size-3" /> Note Allergie
                </span>
              </div>
            </div>
          </div>

          <!-- Bottoni Azione -->
          <div class="flex gap-2 w-full sm:w-auto mt-2 sm:mt-0 items-center justify-end">
            <button @click="$emit('jump-to-cassa', selectedOrder.tavolo)" class="p-2.5 md:p-3 bg-gray-100 text-gray-700 hover:text-[var(--brand-primary)] hover:bg-[var(--brand-primary)]/10 border border-gray-200 hover:border-[var(--brand-primary)]/30 rounded-xl transition-all shadow-sm active:scale-95 flex items-center justify-center shrink-0" title="Apri Cassa Tavolo">
              <Calculator class="size-5 md:size-6" />
            </button>
            <div class="h-8 w-px bg-gray-200 mx-1 hidden sm:block"></div>

            <template v-if="selectedOrder.status === 'pending'">
              <button @click="store.changeOrderStatus(selectedOrder, 'rejected'); selectedOrder = null" class="flex-1 sm:flex-none px-3 py-2.5 md:py-3 bg-white text-red-600 border border-red-200 hover:bg-red-50 rounded-xl font-bold flex items-center justify-center gap-1.5 active:scale-95 transition-colors">
                <Trash2 class="size-5" /> <span class="hidden sm:inline text-xs md:text-sm">Elimina</span>
              </button>
              <button @click="store.changeOrderStatus(selectedOrder, 'accepted')" class="flex-[2] sm:flex-none px-4 py-2.5 md:py-3 theme-bg text-white shadow-md rounded-xl font-bold flex items-center justify-center gap-1.5 active:scale-95 hover:opacity-90 transition-opacity">
                <Printer class="size-5" /> <span class="hidden sm:inline text-xs md:text-sm">Accetta &amp; Stampa</span>
              </button>
            </template>
            <template v-else-if="selectedOrder.status === 'accepted'">
              <span class="w-full text-center px-4 py-2.5 md:py-3 bg-blue-50 text-blue-700 border border-blue-200 rounded-xl font-bold flex items-center justify-center gap-2">
                <ChefHat class="size-5" /> <span class="hidden sm:inline text-xs md:text-sm">In Cucina</span>
              </span>
            </template>
            <template v-else-if="selectedOrder.status === 'completed'">
              <span class="w-full text-center px-4 py-2.5 md:py-3 bg-emerald-50 text-emerald-700 border border-emerald-200 rounded-xl font-bold flex items-center justify-center gap-2">
                <CheckCircle class="size-5" /> <span class="hidden sm:inline text-xs md:text-sm">Incassato</span>
              </span>
            </template>
          </div>
        </div>

        <!-- Lista Piatti -->
        <div class="flex-1 overflow-y-auto bg-gray-100 p-2 md:p-4 min-h-0">
          <div v-if="selectedOrder.status === 'accepted'" class="mb-3 bg-blue-100 border border-blue-200 text-blue-800 p-3 rounded-xl text-[10px] md:text-xs font-bold flex items-center gap-2 shadow-sm">
            <ShieldCheck class="size-4 md:size-5 shrink-0" />
            Ordine in preparazione. In sola lettura. Usa la schermata "Sala/Cassa" per stornare o gestire il conto.
          </div>

          <div class="bg-white rounded-2xl shadow-sm border border-gray-200 overflow-hidden">
            <div class="divide-y divide-gray-100">
              <div v-for="(riga, index) in selectedOrder.righe_ordine" :key="riga.uid" class="p-2 md:p-3 hover:bg-gray-50 transition-colors" :class="{'bg-gray-50 opacity-60': riga.quantita_stornata === riga.quantita}">
                <div class="flex items-center justify-between gap-2 md:gap-4">
                  <div class="flex items-center gap-2 md:gap-3 flex-1 min-w-0">
                    <!-- Controlli +/- (Solo Pending) -->
                    <div v-if="selectedOrder.status === 'pending'" class="flex items-center gap-1 bg-gray-100 rounded-md p-0.5 border border-gray-200 shrink-0">
                      <button @click="store.updateQtyGlobal(selectedOrder, index, -1)" class="size-6 md:size-7 flex items-center justify-center bg-white text-gray-600 rounded shadow-sm active:scale-95"><Minus class="size-3" /></button>
                      <span class="w-5 md:w-6 text-center font-black text-xs md:text-sm text-gray-800">{{ riga.quantita }}</span>
                      <button @click="store.updateQtyGlobal(selectedOrder, index, 1)" class="size-6 md:size-7 flex items-center justify-center bg-white theme-text rounded shadow-sm active:scale-95"><Plus class="size-3" /></button>
                    </div>
                    <!-- Testo Lineare (Accettati) -->
                    <div v-else class="w-8 shrink-0 text-center font-black text-sm md:text-base text-gray-700">
                      {{ riga.quantita - (riga.quantita_stornata || 0) }}x
                    </div>
                    <!-- Informazioni Piatto -->
                    <div class="flex flex-col min-w-0 flex-1">
                      <div class="flex items-center gap-2">
                        <span class="font-bold text-sm md:text-base text-gray-800 leading-tight truncate" :class="{'line-through': riga.quantita_stornata === riga.quantita}">{{ riga.nome }}</span>
                        <span v-if="(riga.quantita_stornata || 0) > 0" class="text-[9px] text-red-500 font-bold uppercase tracking-widest border border-red-200 bg-red-50 px-1 rounded shrink-0">-{{ riga.quantita_stornata }} Stornati</span>
                      </div>
                      <div v-if="riga.note && riga.note.length > 0" class="text-[10px] md:text-xs text-amber-600 font-bold italic mt-0.5 truncate flex items-center gap-1">
                        <MessageSquareWarning class="size-3 shrink-0" /> Note: {{ riga.note.join(', ') }}
                      </div>
                      <!-- Modificatori varianti -->
                      <div v-if="riga.modificatori && riga.modificatori.length > 0" class="mt-0.5 flex flex-wrap gap-1">
                        <span v-for="(mod, mi) in riga.modificatori" :key="mi"
                          class="text-[9px] md:text-[10px] font-bold bg-purple-50 border border-purple-200 text-purple-700 px-1.5 py-0.5 rounded flex items-center gap-0.5">
                          <Sparkles class="size-2.5" />
                          {{ mod.nome }}{{ mod.prezzo > 0 ? ' +€' + mod.prezzo.toFixed(2) : '' }}
                        </span>
                      </div>
                      <!-- Uscita badge -->
                      <div v-if="riga.uscita && riga.uscita !== 'insieme'" class="mt-0.5">
                        <span class="text-[9px] font-bold uppercase tracking-widest px-1.5 py-0.5 rounded border"
                          :class="riga.uscita === 'prima' ? 'bg-orange-50 border-orange-200 text-orange-700' : 'bg-teal-50 border-teal-200 text-teal-700'">
                          <Layers class="size-2.5 inline mr-0.5" />{{ riga.uscita === 'prima' ? 'Esce prima' : 'Esce dopo' }}
                        </span>
                      </div>
                    </div>
                  </div>

                  <!-- Prezzo e Azioni -->
                  <div class="flex items-center gap-2 md:gap-4 shrink-0">
                    <div class="flex flex-col items-end">
                      <span class="font-black text-sm md:text-base text-gray-800" :class="{'line-through text-gray-400': riga.quantita_stornata === riga.quantita}">
                        {{ store.config.ui.currency }}{{ (rigaUnitPrice(riga) * (riga.quantita - (riga.quantita_stornata || 0))).toFixed(2) }}
                      </span>
                      <span v-if="selectedOrder.status === 'pending'" class="text-[9px] text-gray-400">{{ store.config.ui.currency }}{{ rigaUnitPrice(riga).toFixed(2) }} cad.</span>
                    </div>
                    <div v-if="selectedOrder.status === 'pending'" class="flex items-center gap-1 ml-1">
                      <button @click="openNoteModal(selectedOrder, index)" class="p-1.5 md:p-2 text-gray-500 hover:text-[var(--brand-primary)] bg-gray-50 border border-gray-200 hover:bg-gray-100 rounded-md transition-colors active:scale-95 shadow-sm" title="Modifica Note">
                        <PenLine class="size-4 md:size-4" />
                      </button>
                      <button @click="store.removeRowGlobal(selectedOrder, index)" class="p-1.5 md:p-2 text-red-500 hover:text-white bg-white border border-red-200 hover:bg-red-500 rounded-md transition-colors active:scale-95 shadow-sm" title="Rimuovi Voce">
                        <Trash2 class="size-4 md:size-4" />
                      </button>
                    </div>
                  </div>
                </div>
              </div>

              <!-- Bottone Aggiunta Rapida (Solo Pending) -->
              <div v-if="selectedOrder.status === 'pending'" class="p-3 bg-gray-50 border-t border-gray-100">
                <button @click="openAddMenu(selectedOrder)" class="theme-btn-outline w-full py-3 md:py-3.5 rounded-xl font-bold flex items-center justify-center gap-2 transition-all active:scale-95 text-xs md:text-sm">
                  <PlusCircle class="size-5" /> <span>Aggiungi Nuovi Piatti all'Ordine</span>
                </button>
              </div>
            </div>
          </div>
        </div>

        <!-- Footer Totali -->
        <div class="bg-white border-t border-gray-200 p-3 md:p-5 shrink-0 z-10 shadow-[0_-5px_15px_rgba(0,0,0,0.05)] flex justify-between items-end pb-8 md:pb-5">
          <div>
            <p class="text-gray-500 text-[10px] md:text-xs font-bold uppercase">Pezzi Attivi</p>
            <p class="text-gray-800 text-lg md:text-xl font-black">{{ selectedOrder.numero_articoli }}</p>
          </div>
          <div class="text-right">
            <p class="text-gray-400 font-bold uppercase tracking-wider text-[10px] md:text-xs mb-0.5">Importo Comanda</p>
            <p class="text-2xl md:text-4xl font-black theme-text leading-none">{{ store.config.ui.currency }}{{ selectedOrder.totale_importo.toFixed(2) }}</p>
          </div>
        </div>
      </div>
    </main>
  </div>

  <!-- ================================================================ -->
  <!-- MODAL: GESTIONE NOTE MULTIPLE                                     -->
  <!-- ================================================================ -->
  <div v-if="noteModal.show" class="fixed inset-0 z-[90] bg-black/60 backdrop-blur-sm flex items-end md:items-center justify-center p-0 md:p-4">
    <div class="bg-white rounded-t-3xl md:rounded-3xl shadow-2xl w-full max-w-md overflow-hidden flex flex-col">
      <div class="bg-gray-50 border-b border-gray-100 p-4 flex justify-between items-center">
        <h3 class="font-bold text-base md:text-lg flex items-center gap-2"><PenLine class="text-gray-500 size-4 md:size-5" /> Note Cucina</h3>
        <button @click="noteModal.show = false" class="text-gray-400 hover:text-gray-800 p-1.5 bg-gray-200 hover:bg-gray-300 rounded-full active:scale-95 transition-colors"><X class="size-5" /></button>
      </div>

      <div class="p-4 md:p-5">
        <p class="text-xs md:text-sm text-gray-500 mb-3 truncate">Variazioni per: <strong>{{ noteModal.rigaRiferimento?.nome }}</strong></p>

        <div v-if="noteModal.notesArray.length > 0" class="mb-4 space-y-1.5 max-h-[150px] overflow-y-auto border border-gray-100 p-2 rounded-xl bg-gray-50">
          <div v-for="(nota, idx) in noteModal.notesArray" :key="idx" class="flex justify-between items-center bg-white border border-gray-200 text-gray-700 px-3 py-2 rounded-lg text-xs font-bold shadow-sm">
            <span>{{ nota }}</span>
            <button @click="removeNoteFromModal(idx)" class="text-red-500 p-1 hover:bg-red-50 rounded-md transition-colors"><Trash2 class="size-4" /></button>
          </div>
        </div>

        <div class="flex gap-2">
          <input ref="noteInput" v-model="noteModal.inputText" type="text" placeholder="Scrivi una nota rapida..." class="w-full bg-gray-100 border border-gray-200 rounded-xl px-3 md:px-4 py-3 focus:bg-white theme-ring transition-all text-gray-800 font-medium text-sm" @keyup.enter="addNoteToModal">
          <button @click="addNoteToModal" class="theme-bg text-white px-4 rounded-xl font-bold shadow-sm active:scale-95 flex items-center justify-center"><Plus class="size-5" /></button>
        </div>

        <div class="flex flex-wrap gap-1.5 mt-4 pt-3 border-t border-gray-100">
          <button @click="noteModal.inputText = 'Senza sale'; addNoteToModal()" class="px-2.5 py-1.5 bg-gray-100 border border-gray-200 hover:bg-gray-200 rounded-lg text-[10px] md:text-xs font-bold text-gray-600 transition-colors active:scale-95">Senza sale</button>
          <button @click="noteModal.inputText = 'Ben cotto'; addNoteToModal()" class="px-2.5 py-1.5 bg-gray-100 border border-gray-200 hover:bg-gray-200 rounded-lg text-[10px] md:text-xs font-bold text-gray-600 transition-colors active:scale-95">Ben cotto</button>
          <button @click="noteModal.inputText = 'No formaggio'; addNoteToModal()" class="px-2.5 py-1.5 bg-gray-100 border border-gray-200 hover:bg-gray-200 rounded-lg text-[10px] md:text-xs font-bold text-gray-600 transition-colors active:scale-95">No formaggio</button>
          <button @click="noteModal.inputText = 'Da dividere'; addNoteToModal()" class="px-2.5 py-1.5 bg-gray-100 border border-gray-200 hover:bg-gray-200 rounded-lg text-[10px] md:text-xs font-bold text-gray-600 transition-colors active:scale-95">Da dividere</button>
        </div>
      </div>

      <div class="p-3 md:p-4 bg-gray-50 pb-8 md:pb-4 border-t border-gray-200">
        <button @click="saveNotes" class="w-full theme-bg text-white py-3 md:py-3.5 rounded-xl font-bold shadow-md hover:opacity-90 transition-opacity active:scale-95 text-sm md:text-base">Salva Note</button>
      </div>
    </div>
  </div>

  <!-- ================================================================ -->
  <!-- MODAL GLOBALE: CARRELLO AGGIUNTA MENU                            -->
  <!-- ================================================================ -->
  <div v-if="showAddMenuModal" class="fixed inset-0 z-[80] bg-black/80 backdrop-blur-sm flex items-end md:items-center justify-center p-0 md:p-4">
    <div class="bg-white rounded-t-3xl md:rounded-3xl shadow-2xl w-full max-w-6xl h-[95dvh] md:h-[85vh] flex flex-col overflow-hidden relative">

      <div class="bg-gray-900 text-white p-3 md:p-4 flex justify-between items-center shrink-0">
        <div class="flex flex-col">
          <h3 class="font-bold text-base md:text-xl flex items-center gap-2"><BookOpen class="size-4 md:size-5 text-emerald-400" /> Aggiunta Piatti in Comanda</h3>
          <p class="text-[10px] text-gray-400 uppercase tracking-widest mt-0.5">Destinazione: Ord #{{ targetOrderForMenu ? targetOrderForMenu.id.substring(0,6) : '' }} - Tavolo {{ targetOrderForMenu?.tavolo }}</p>
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
            <span v-if="activeMenuCategory === category" class="opacity-50 hidden md:flex items-center">
              <ChevronRight class="size-4" />
            </span>
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
              <h4 class="font-bold text-gray-800 text-xs md:text-sm leading-tight group-hover:theme-text transition-colors">{{ item.nome }}</h4>
              <span class="font-black theme-text text-xs md:text-sm shrink-0 bg-emerald-50 px-1.5 py-0.5 rounded border border-emerald-100">{{ store.config.ui.currency }}{{ item.prezzo.toFixed(2) }}</span>
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
                  <span class="font-bold text-sm text-gray-800 truncate">{{ cartItem.nome }}</span>
                  <span class="text-[10px] text-gray-500">{{ store.config.ui.currency }}{{ (cartItem.prezzo_unitario + (cartItem.modificatori || []).reduce((a,m) => a+m.prezzo,0)).toFixed(2) }} cad.</span>
                </div>
                <div class="flex items-center gap-1 bg-gray-100 rounded p-0.5 shrink-0 border border-gray-200">
                  <button @click="updateTempCartQty(idx, -1)" class="size-6 flex items-center justify-center bg-white text-gray-600 rounded shadow-sm active:scale-95"><Minus class="size-3" /></button>
                  <span class="w-5 text-center font-black text-sm">{{ cartItem.quantita }}</span>
                  <button @click="updateTempCartQty(idx, 1)" class="size-6 flex items-center justify-center bg-white theme-text rounded shadow-sm active:scale-95"><Plus class="size-3" /></button>
                </div>
              </div>
              <!-- Uscita selector -->
              <div class="px-2.5 pb-2 flex gap-1">
                <button v-for="opt in uscitaOptions" :key="opt.value" @click="cartItem.uscita = opt.value"
                  :class="cartItem.uscita === opt.value ? opt.activeClass : 'bg-gray-50 border-gray-200 text-gray-500'"
                  class="flex-1 text-[9px] font-bold py-1 rounded border transition-all active:scale-95">
                  {{ opt.label }}
                </button>
              </div>
              <!-- Modificatori -->
              <div class="px-2.5 pb-2">
                <div v-if="cartItem.modificatori && cartItem.modificatori.length > 0" class="flex flex-wrap gap-1 mb-1">
                  <span v-for="(mod, mi) in cartItem.modificatori" :key="mi"
                    class="text-[9px] font-bold bg-purple-50 border border-purple-200 text-purple-700 px-1.5 py-0.5 rounded flex items-center gap-1">
                    {{ mod.nome }}{{ mod.prezzo > 0 ? ' +€'+mod.prezzo.toFixed(2) : '' }}
                    <button @click="removeModFromCart(idx, mi)" class="text-purple-400 hover:text-red-500 transition-colors"><X class="size-2.5" /></button>
                  </span>
                </div>
                <button @click="openModModal(idx)" class="text-[9px] font-bold text-purple-600 hover:text-purple-800 flex items-center gap-0.5 transition-colors">
                  <Sparkles class="size-3" /> Aggiungi variante
                </button>
              </div>
            </div>
          </div>

          <!-- Footer Inserimento in Comanda -->
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
  <!-- MODAL: VARIANTI/MODIFICATORI                                      -->
  <!-- ================================================================ -->
  <div v-if="modModal.show" class="fixed inset-0 z-[95] bg-black/60 backdrop-blur-sm flex items-end md:items-center justify-center p-0 md:p-4">
    <div class="bg-white rounded-t-3xl md:rounded-3xl shadow-2xl w-full max-w-md overflow-hidden flex flex-col">
      <div class="bg-gray-50 border-b border-gray-100 p-4 flex justify-between items-center">
        <h3 class="font-bold text-base flex items-center gap-2"><Sparkles class="text-purple-500 size-5" /> Variante / Modificatore</h3>
        <button @click="modModal.show = false" class="text-gray-400 hover:text-gray-800 p-1.5 bg-gray-200 hover:bg-gray-300 rounded-full active:scale-95 transition-colors"><X class="size-5" /></button>
      </div>
      <div class="p-4 md:p-5">
        <p class="text-xs text-gray-500 mb-3">Aggiungi una variante a pagamento all'articolo in carrello.</p>
        <div class="flex gap-2 mb-3">
          <input v-model="modModal.nome" type="text" placeholder="Es. Mozzarella, Senza glutine..." class="flex-1 px-3 py-2.5 border border-gray-200 rounded-xl text-sm focus:border-[var(--brand-primary)] focus:outline-none" />
          <div class="relative w-24 shrink-0">
            <span class="absolute left-2 top-1/2 -translate-y-1/2 text-gray-400 text-sm font-bold">€</span>
            <input v-model.number="modModal.prezzo" type="number" min="0" step="0.50" placeholder="0.00" class="w-full pl-6 pr-2 py-2.5 border border-gray-200 rounded-xl text-sm focus:border-[var(--brand-primary)] focus:outline-none" />
          </div>
        </div>
        <!-- Quick presets -->
        <div class="flex flex-wrap gap-1.5 mb-4">
          <button @click="applyModPreset('Mozzarella', 1.50)" class="px-2.5 py-1.5 bg-purple-50 border border-purple-200 text-purple-700 rounded-lg text-[10px] font-bold hover:bg-purple-100 active:scale-95 transition-all">+ Mozzarella €1.50</button>
          <button @click="applyModPreset('Parmigiano', 1.00)" class="px-2.5 py-1.5 bg-purple-50 border border-purple-200 text-purple-700 rounded-lg text-[10px] font-bold hover:bg-purple-100 active:scale-95 transition-all">+ Parmigiano €1.00</button>
          <button @click="applyModPreset('Senza glutine', 0)" class="px-2.5 py-1.5 bg-purple-50 border border-purple-200 text-purple-700 rounded-lg text-[10px] font-bold hover:bg-purple-100 active:scale-95 transition-all">Senza glutine €0</button>
          <button @click="applyModPreset('Porzione extra', 2.00)" class="px-2.5 py-1.5 bg-purple-50 border border-purple-200 text-purple-700 rounded-lg text-[10px] font-bold hover:bg-purple-100 active:scale-95 transition-all">+ Porzione extra €2.00</button>
        </div>
        <button @click="saveModModal"
          class="w-full theme-bg text-white py-3 rounded-xl font-bold shadow-md hover:opacity-90 transition-opacity active:scale-95 text-sm flex items-center justify-center gap-2">
          <Plus class="size-5" /> Aggiungi Variante
        </button>
      </div>
    </div>
  </div>
</template>

<script setup>
import { ref, computed } from 'vue';
import {
  Bell, ChefHat, History, ClipboardList, Clock, AlertCircle, CheckCircle2, XCircle,
  MousePointerClick, ArrowLeft, Hash, AlertTriangle, Calculator, Trash2, Printer,
  CheckCircle, ShieldCheck, Minus, Plus, MessageSquareWarning, PenLine, PlusCircle,
  X, BookOpen, ChevronRight, ShoppingCart, Sparkles, Layers,
} from 'lucide-vue-next';
import { useAppStore } from '../store/index.js';
import { updateOrderTotals } from '../utils/index.js';

defineEmits(['jump-to-cassa']);

const store = useAppStore();

// ── Tab & selection state ──────────────────────────────────────────────────
const activeTab = ref('pending');
const selectedOrder = ref(null);

const filteredOrders = computed(() => {
  if (activeTab.value === 'history')
    return store.orders.filter(o => o.status === 'completed' || o.status === 'rejected');
  return store.orders
    .filter(o => o.status === activeTab.value)
    .sort((a, b) => b.time.localeCompare(a.time));
});

function changeTab(tab) {
  activeTab.value = tab;
  selectedOrder.value = null;
}

function selectOrder(ord) {
  selectedOrder.value = ord;
}

// ── Helper: calcola prezzo unitario di una riga inclusi i modificatori ──────
function rigaUnitPrice(riga) {
  const modTotal = (riga.modificatori || []).reduce((a, m) => a + (m.prezzo || 0), 0);
  return riga.prezzo_unitario + modTotal;
}

// ── Note modal ─────────────────────────────────────────────────────────────
const noteInput = ref(null);
const noteModal = ref({
  show: false, inputText: '', notesArray: [],
  rowIndex: null, targetOrd: null, rigaRiferimento: null,
});

function openNoteModal(ord, idx) {
  if (!ord || ord.status !== 'pending') return;
  noteModal.value.targetOrd = ord;
  noteModal.value.rowIndex = idx;
  noteModal.value.rigaRiferimento = ord.righe_ordine[idx];
  const existing = ord.righe_ordine[idx].note;
  noteModal.value.notesArray = Array.isArray(existing) ? [...existing] : [];
  noteModal.value.inputText = '';
  noteModal.value.show = true;
  setTimeout(() => noteInput.value?.focus(), 150);
}

function addNoteToModal() {
  const txt = noteModal.value.inputText.trim();
  if (txt && !noteModal.value.notesArray.includes(txt)) {
    noteModal.value.notesArray.push(txt);
  }
  noteModal.value.inputText = '';
}

function removeNoteFromModal(idx) {
  noteModal.value.notesArray.splice(idx, 1);
}

function saveNotes() {
  if (noteModal.value.rowIndex !== null && noteModal.value.targetOrd) {
    noteModal.value.targetOrd.righe_ordine[noteModal.value.rowIndex].note = [...noteModal.value.notesArray];
  }
  noteModal.value.show = false;
}

// ── Add Menu modal (also exposed for SalaView via TableManager) ────────────
const showAddMenuModal = ref(false);
const targetOrderForMenu = ref(null);
const tempCart = ref([]);
const activeMenuCategory = ref(Object.keys(store.config.menu)[0]);

// ── Uscita options ─────────────────────────────────────────────────────────
const uscitaOptions = [
  { value: 'prima', label: 'Esce prima', activeClass: 'bg-orange-100 border-orange-400 text-orange-800' },
  { value: 'insieme', label: 'Insieme', activeClass: 'theme-bg text-white border-transparent' },
  { value: 'dopo', label: 'Esce dopo', activeClass: 'bg-teal-100 border-teal-400 text-teal-800' },
];

// ── Modificatori modal ─────────────────────────────────────────────────────
const modModal = ref({ show: false, cartIdx: null, nome: '', prezzo: 0 });

function openModModal(idx) {
  modModal.value = { show: true, cartIdx: idx, nome: '', prezzo: 0 };
}

function applyModPreset(nome, prezzo) {
  modModal.value.nome = nome;
  modModal.value.prezzo = prezzo;
}

function saveModModal() {
  const nome = modModal.value.nome.trim();
  if (!nome) return;
  const cartItem = tempCart.value[modModal.value.cartIdx];
  if (!cartItem) return;
  if (!cartItem.modificatori) cartItem.modificatori = [];
  cartItem.modificatori.push({ nome, prezzo: modModal.value.prezzo || 0 });
  modModal.value.show = false;
}

function removeModFromCart(cartIdx, modIdx) {
  const cartItem = tempCart.value[cartIdx];
  if (cartItem && cartItem.modificatori) {
    cartItem.modificatori.splice(modIdx, 1);
  }
}

const tempCartTotal = computed(() =>
  tempCart.value.reduce((a, b) => {
    const modTotal = (b.modificatori || []).reduce((ma, m) => ma + (m.prezzo || 0), 0);
    return a + (b.prezzo_unitario + modTotal) * b.quantita;
  }, 0),
);

function getQtyCombined(itemId) {
  let qOrd = 0;
  if (targetOrderForMenu.value) {
    const ex = targetOrderForMenu.value.righe_ordine.find(
      r => r.id_piatto === itemId && (!r.note || r.note.length === 0),
    );
    if (ex) qOrd = ex.quantita - (ex.quantita_stornata || 0);
  }
  const cEx = tempCart.value.find(r => r.id_piatto === itemId);
  return qOrd + (cEx ? cEx.quantita : 0);
}

function addToTempCart(item) {
  const existing = tempCart.value.find(r => r.id_piatto === item.id && (!r.modificatori || r.modificatori.length === 0));
  if (existing) existing.quantita++;
  else tempCart.value.push({ uid: 'tmp_' + Math.random().toString(36).slice(2, 11), id_piatto: item.id, nome: item.nome, prezzo_unitario: item.prezzo, quantita: 1, note: [], quantita_stornata: 0, modificatori: [], uscita: 'insieme' });
}

function updateTempCartQty(idx, delta) {
  tempCart.value[idx].quantita += delta;
  if (tempCart.value[idx].quantita <= 0) tempCart.value.splice(idx, 1);
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
  const ordRef = targetOrderForMenu.value;
  tempCart.value.forEach(cartItem => {
    // Only merge if no modifiers and no uscita variation
    const hasModifiers = cartItem.modificatori && cartItem.modificatori.length > 0;
    const hasUscita = cartItem.uscita && cartItem.uscita !== 'insieme';
    if (!hasModifiers && !hasUscita) {
      const existing = ordRef.righe_ordine.find(
        r => r.id_piatto === cartItem.id_piatto && (!r.note || r.note.length === 0) && (!r.modificatori || r.modificatori.length === 0),
      );
      if (existing) { existing.quantita += cartItem.quantita; return; }
    }
    cartItem.uid = 'r_new_' + Math.random().toString(36).slice(2, 11);
    ordRef.righe_ordine.push(cartItem);
  });
  updateOrderTotals(ordRef);
  closeMenuModal();
  // Navigate to orders view and select the order
  activeTab.value = 'pending';
  selectedOrder.value = ordRef;
}

// ── Expose methods for parent (SalaView / TableManager) ───────────────────
defineExpose({ openAddMenu, selectedOrder, activeTab, changeTab });
</script>
