<template>
  <!-- MODAL: CRUSCOTTO CASSA -->
  <div v-if="modelValue" class="fixed inset-0 z-[90] bg-black/70 backdrop-blur-sm flex items-end md:items-center justify-center p-0 md:p-4">
    <div class="bg-white rounded-t-3xl md:rounded-3xl shadow-2xl w-full max-w-3xl h-[95dvh] md:h-[90dvh] flex flex-col overflow-hidden">

      <!-- Header -->
      <div class="bg-gray-900 text-white p-4 md:p-5 flex justify-between items-center shrink-0">
        <div class="flex items-center gap-3">
          <div class="size-10 md:size-12 rounded-full bg-white/10 flex items-center justify-center">
            <Landmark class="size-5 md:size-6 text-emerald-400" />
          </div>
          <div>
            <h3 class="font-bold text-base md:text-xl leading-tight">Cruscotto Cassa</h3>
            <p class="text-white/60 text-[10px] md:text-xs">Fondo, Movimenti e Chiusure Giornaliere</p>
          </div>
        </div>
        <button @click="$emit('update:modelValue', false)" class="bg-white/10 hover:bg-white/20 p-2 md:p-2.5 rounded-full transition-colors active:scale-95">
          <X class="size-5 md:size-6" />
        </button>
      </div>

      <!-- Tabs -->
      <div class="flex bg-gray-50 border-b border-gray-200 shrink-0">
        <button v-for="tab in tabs" :key="tab.id" @click="activeTab = tab.id"
          class="flex-1 py-2.5 md:py-3 px-2 text-[10px] md:text-xs font-bold uppercase tracking-wider transition-all flex items-center justify-center gap-1.5"
          :class="activeTab === tab.id ? 'bg-white border-b-2 border-[var(--brand-primary)] theme-text shadow-sm' : 'text-gray-500 hover:bg-gray-100'">
          <component :is="tab.icon" class="size-4 md:size-5 shrink-0" />
          {{ tab.label }}
        </button>
      </div>

      <!-- Content -->
      <div class="flex-1 overflow-y-auto p-4 md:p-6 bg-gray-50">

        <!-- TAB: FONDO CASSA -->
        <div v-if="activeTab === 'cashBalance'" class="space-y-4">
          <div class="bg-white rounded-2xl border border-gray-200 shadow-sm p-4 md:p-6">
            <h4 class="font-bold text-gray-700 text-sm uppercase tracking-wider mb-4 flex items-center gap-2">
              <Wallet class="size-4 text-emerald-600" /> Fondo Cassa Iniziale
            </h4>
            <div class="flex items-center gap-3">
              <div class="relative flex-1">
                <span class="absolute left-3 top-1/2 -translate-y-1/2 font-black text-gray-500 text-lg">€</span>
                <NumericInput
                  v-model="cashBalanceInput"
                  min="0" step="0.50"
                  :prefix="configStore.config.ui.currency"
                  class="w-full pl-8 pr-4 py-3 border-2 border-gray-200 rounded-xl font-black text-xl text-gray-800 focus:border-[var(--brand-primary)] focus:outline-none transition-colors"
                  placeholder="0.00" />
              </div>
              <button @click="saveCashBalance"
                class="theme-bg text-white px-5 py-3 rounded-xl font-bold shadow-md hover:opacity-90 transition-opacity active:scale-95 flex items-center gap-2 shrink-0">
                <Save class="size-5" /> Salva
              </button>
            </div>
            <div class="flex items-center gap-2 mt-2">
              <span class="text-[10px] font-bold text-gray-400 uppercase tracking-wider shrink-0">Preset:</span>
              <button v-for="preset in [50, 100, 150, 200]" :key="preset" @click="cashBalanceInput = preset"
                class="px-3 py-1.5 text-xs font-bold rounded-lg border border-gray-200 bg-white hover:bg-gray-50 text-gray-700 active:scale-95 transition-all shadow-sm">
                {{ configStore.config.ui.currency }}{{ preset }}
              </button>
            </div>
            <div class="mt-3 flex items-center gap-2 p-3 bg-emerald-50 border border-emerald-100 rounded-xl">
              <TrendingUp class="size-4 text-emerald-600 shrink-0" />
              <span class="text-xs font-bold text-emerald-700">Fondo attuale: <span class="text-base">€{{ orderStore.cashBalance.toFixed(2) }}</span></span>
            </div>
          </div>

          <!-- Movimenti -->
          <div class="bg-white rounded-2xl border border-gray-200 shadow-sm p-4 md:p-6">
            <h4 class="font-bold text-gray-700 text-sm uppercase tracking-wider mb-4 flex items-center gap-2">
              <ArrowLeftRight class="size-4 text-blue-600" /> Versamenti &amp; Prelievi
            </h4>

            <div class="grid grid-cols-2 gap-2 mb-4">
              <button @click="movementType = 'deposit'"
                :class="movementType === 'deposit' ? 'bg-emerald-100 border-emerald-400 text-emerald-800' : 'bg-white border-gray-200 text-gray-600 hover:bg-gray-50'"
                class="py-2.5 px-3 rounded-xl border-2 font-bold text-xs md:text-sm flex items-center justify-center gap-2 transition-all active:scale-95">
                <ArrowDownCircle class="size-4" /> Versamento
              </button>
              <button @click="movementType = 'withdrawal'"
                :class="movementType === 'withdrawal' ? 'bg-red-100 border-red-400 text-red-800' : 'bg-white border-gray-200 text-gray-600 hover:bg-gray-50'"
                class="py-2.5 px-3 rounded-xl border-2 font-bold text-xs md:text-sm flex items-center justify-center gap-2 transition-all active:scale-95">
                <ArrowUpCircle class="size-4" /> Prelievo
              </button>
            </div>

            <div class="flex flex-col sm:flex-row gap-2 mb-4">
              <div class="relative flex-1">
                <span class="absolute left-3 top-1/2 -translate-y-1/2 font-black text-gray-400">€</span>
                <NumericInput
                  v-model="movementAmount"
                  min="0.01" step="0.50"
                  :prefix="configStore.config.ui.currency"
                  class="w-full pl-8 pr-3 py-2.5 border border-gray-200 rounded-xl text-sm font-bold focus:border-[var(--brand-primary)] focus:outline-none"
                  placeholder="Importo" />
              </div>
              <input type="text" v-model="movementReason"
                class="flex-[2] px-3 py-2.5 border border-gray-200 rounded-xl text-sm focus:border-[var(--brand-primary)] focus:outline-none"
                placeholder="Causale (es. Cambio moneta)" />
              <button @click="addMovement"
                :class="movementType === 'deposit' ? 'bg-emerald-600 hover:bg-emerald-700' : 'bg-red-600 hover:bg-red-700'"
                class="text-white px-4 py-2.5 rounded-xl font-bold text-sm flex items-center gap-1.5 shrink-0 transition-colors active:scale-95 shadow-sm">
                <Plus class="size-4" /> Aggiungi
              </button>
            </div>

            <!-- Lista movimenti -->
            <div class="space-y-2 max-h-48 overflow-y-auto">
              <div v-if="orderStore.cashMovements.length === 0" class="text-center text-gray-400 py-4 text-sm">
                Nessun movimento registrato.
              </div>
              <div v-for="mov in [...orderStore.cashMovements].reverse()" :key="mov.id"
                class="flex items-center justify-between p-3 rounded-xl border text-sm font-bold"
                :class="mov.type === 'deposit' ? 'bg-emerald-50 border-emerald-100 text-emerald-800' : 'bg-red-50 border-red-100 text-red-800'">
                <div class="flex items-center gap-2">
                  <component :is="mov.type === 'deposit' ? ArrowDownCircle : ArrowUpCircle" class="size-4 shrink-0" />
                  <span class="font-medium text-xs md:text-sm">{{ mov.reason || mov.type }}</span>
                </div>
                <div class="flex items-center gap-2 shrink-0">
                  <span class="font-black">{{ mov.type === 'deposit' ? '+' : '-' }}€{{ mov.amount.toFixed(2) }}</span>
                  <span class="text-[9px] opacity-60">{{ new Date(mov.timestamp).toLocaleTimeString(locale, { hour: '2-digit', minute: '2-digit', timeZone: timezone }) }}</span>
                </div>
              </div>
            </div>
          </div>
        </div>

        <!-- TAB: LETTURA X (PREVIEW) -->
        <div v-if="activeTab === 'xReport'" class="space-y-4">
          <div class="bg-amber-50 border border-amber-200 rounded-xl p-3 md:p-4 flex items-start gap-2 text-sm">
            <Eye class="size-5 text-amber-600 shrink-0 mt-0.5" />
            <div>
              <p class="font-bold text-amber-800">Lettura X – Anteprima Giornata</p>
              <p class="text-amber-700 text-xs mt-0.5">Riepilogo senza azzeramento. La giornata rimane aperta.</p>
            </div>
          </div>

          <div v-if="xSummary" class="space-y-3">
            <!-- Totale incassato (scontrino, mance escluse) -->
            <div class="bg-white rounded-2xl border border-gray-200 shadow-sm p-4 md:p-5">
              <p class="text-[10px] font-bold uppercase text-gray-400 mb-1">Totale Incassato (scontrino)</p>
              <p class="text-4xl md:text-5xl font-black theme-text">€{{ xSummary.totalReceived.toFixed(2) }}</p>
              <p v-if="xSummary.totalTips > 0" class="text-xs font-bold text-amber-600 mt-1 flex items-center gap-1">
                <Gift class="size-3.5" /> + €{{ xSummary.totalTips.toFixed(2) }} mance
              </p>
            </div>

            <!-- Per metodo pagamento -->
            <div class="bg-white rounded-2xl border border-gray-200 shadow-sm p-4">
              <h5 class="font-bold text-gray-600 text-xs uppercase tracking-wider mb-3 flex items-center gap-1">
                <CreditCard class="size-4" /> Per Metodo di Pagamento
              </h5>
              <div v-if="Object.keys(xSummary.byMethod).length === 0" class="text-sm text-gray-400 italic">Nessuna transazione.</div>
              <div v-for="(val, method) in xSummary.byMethod" :key="method"
                class="py-2 border-b border-gray-100 last:border-0">
                <div class="flex justify-between items-center">
                  <span class="font-bold text-sm text-gray-700 flex items-center gap-2">
                    <component :is="getMethodIcon(method)" class="size-4 text-gray-500" />
                    {{ method }}
                  </span>
                  <span class="font-black text-base text-gray-800">€{{ val.toFixed(2) }}</span>
                </div>
                <div v-if="xSummary.tipsByMethod && xSummary.tipsByMethod[method]"
                  class="flex justify-between items-center mt-0.5 ml-6">
                  <span class="text-[11px] text-amber-600 flex items-center gap-1">
                    <Gift class="size-3" /> mancia
                  </span>
                  <span class="text-[11px] font-bold text-amber-600">+€{{ xSummary.tipsByMethod[method].toFixed(2) }}</span>
                </div>
              </div>
              <!-- Mance autonome (metodi non presenti nello scontrino, es. "Mancia" post-pagamento) -->
              <template v-if="xSummary.tipsByMethod">
                <template v-for="(tipVal, tipMethod) in xSummary.tipsByMethod" :key="'tip_' + tipMethod">
                  <div v-if="!Object.prototype.hasOwnProperty.call(xSummary.byMethod, tipMethod)"
                    class="flex justify-between items-center py-2 border-b border-gray-100 last:border-0">
                    <span class="text-sm text-amber-700 flex items-center gap-2 font-bold">
                      <Gift class="size-4 text-amber-500" /> {{ tipMethod }}
                    </span>
                    <span class="text-sm font-black text-amber-600">+€{{ tipVal.toFixed(2) }}</span>
                  </div>
                </template>
              </template>
            </div>

            <!-- Tipologia Chiusura Conto -->
            <div v-if="xHasClosureTypeData" class="bg-white rounded-2xl border border-gray-200 shadow-sm p-4">
              <h5 class="font-bold text-gray-600 text-xs uppercase tracking-wider mb-3 flex items-center gap-1">
                <ClipboardList class="size-4" /> Tipologia Chiusura Conto
              </h5>
              <div class="space-y-2 text-sm">
                <div v-if="xSummary.fiscalCount > 0" class="flex justify-between items-center py-2 border-b border-gray-100 last:border-0">
                  <span class="font-bold text-gray-700 flex items-center gap-2">
                    <Receipt class="size-4 text-blue-500" /> Scontrino Fiscale
                    <span class="text-[10px] font-bold text-blue-400 bg-blue-50 px-1.5 py-0.5 rounded-full">× {{ xSummary.fiscalCount }}</span>
                  </span>
                  <span class="font-black text-blue-700">€{{ xSummary.fiscalTotal.toFixed(2) }}</span>
                </div>
                <div v-if="xSummary.invoiceCount > 0" class="flex justify-between items-center py-2 border-b border-gray-100 last:border-0">
                  <span class="font-bold text-gray-700 flex items-center gap-2">
                    <FileText class="size-4 text-violet-500" /> Fattura
                    <span class="text-[10px] font-bold text-violet-400 bg-violet-50 px-1.5 py-0.5 rounded-full">× {{ xSummary.invoiceCount }}</span>
                  </span>
                  <span class="font-black text-violet-700">€{{ xSummary.invoiceTotal.toFixed(2) }}</span>
                </div>
              </div>
            </div>

            <!-- Coperti e scontrino medio -->
            <div class="grid grid-cols-3 gap-3">
              <div class="bg-white rounded-2xl border border-gray-200 shadow-sm p-3 md:p-4 text-center">
                <Users class="size-5 mx-auto mb-1 text-blue-500" />
                <p class="text-2xl md:text-3xl font-black text-gray-800">{{ xSummary.totalCovers }}</p>
                <p class="text-[10px] font-bold text-gray-400 uppercase mt-0.5">Coperti</p>
              </div>
              <div class="bg-white rounded-2xl border border-gray-200 shadow-sm p-3 md:p-4 text-center">
                <Receipt class="size-5 mx-auto mb-1 text-purple-500" />
                <p class="text-2xl md:text-3xl font-black text-gray-800">{{ xSummary.receiptCount }}</p>
                <p class="text-[10px] font-bold text-gray-400 uppercase mt-0.5">Scontrini</p>
              </div>
              <div class="bg-white rounded-2xl border border-gray-200 shadow-sm p-3 md:p-4 text-center">
                <TrendingUp class="size-5 mx-auto mb-1 text-emerald-500" />
                <p class="text-xl md:text-2xl font-black text-gray-800">€{{ xSummary.averageReceipt.toFixed(2) }}</p>
                <p class="text-[10px] font-bold text-gray-400 uppercase mt-0.5">Scontrino Medio</p>
              </div>
            </div>

            <!-- Sconti e Mance -->
            <div v-if="xSummary.totalDiscount > 0 || xSummary.totalTips > 0" class="bg-white rounded-2xl border border-gray-200 shadow-sm p-4">
              <h5 class="font-bold text-gray-600 text-xs uppercase tracking-wider mb-3 flex items-center gap-1">
                <Tag class="size-4" /> Rettifiche
              </h5>
              <div class="space-y-2 text-sm">
                <div v-if="xSummary.totalDiscount > 0" class="flex justify-between items-center">
                  <span class="text-gray-500 flex items-center gap-1.5"><Tag class="size-3.5 text-red-400" /> Sconti applicati</span>
                  <span class="font-bold text-red-600">-€{{ xSummary.totalDiscount.toFixed(2) }}</span>
                </div>
                <div v-if="xSummary.totalTips > 0" class="flex justify-between items-center">
                  <span class="text-gray-500 flex items-center gap-1.5"><Gift class="size-3.5 text-amber-500" /> Mance incassate</span>
                  <span class="font-bold text-amber-600">+€{{ xSummary.totalTips.toFixed(2) }}</span>
                </div>
                <div v-if="xSummary.totalDiscount > 0" class="flex justify-between items-center border-t border-gray-100 pt-2 mt-1">
                  <span class="text-gray-500">Lordo (incluse mance, prima degli sconti)</span>
                  <span class="font-bold text-gray-700">€{{ (xSummary.totalReceived + xSummary.totalTips + xSummary.totalDiscount).toFixed(2) }}</span>
                </div>
              </div>
            </div>

            <!-- Fondo e movimenti -->
            <div class="bg-white rounded-2xl border border-gray-200 shadow-sm p-4">
              <h5 class="font-bold text-gray-600 text-xs uppercase tracking-wider mb-3 flex items-center gap-1">
                <Wallet class="size-4" /> Cassa Fisica
              </h5>
              <div class="space-y-2 text-sm">
                <div class="flex justify-between"><span class="text-gray-500">Fondo iniziale</span><span class="font-bold">€{{ xSummary.cashBalance.toFixed(2) }}</span></div>
                <div class="flex justify-between"><span class="text-gray-500">Movimenti netti</span><span class="font-bold" :class="xSummary.totalMovements >= 0 ? 'text-emerald-600' : 'text-red-600'">{{ xSummary.totalMovements >= 0 ? '+' : '' }}€{{ xSummary.totalMovements.toFixed(2) }}</span></div>
                <div class="flex justify-between border-t border-gray-100 pt-2 mt-1"><span class="font-bold text-gray-700">Fondo Finale Stimato</span><span class="font-black text-lg theme-text">€{{ xSummary.finalBalance.toFixed(2) }}</span></div>
              </div>
            </div>
          </div>

          <button @click="refreshXReport"
            class="w-full py-4 theme-bg text-white rounded-2xl font-bold shadow-md hover:opacity-90 transition-opacity active:scale-95 flex items-center justify-center gap-2 text-sm md:text-base">
            <RefreshCw class="size-5" /> Aggiorna Lettura X
          </button>

          <!-- Stampa X fiscale RT -->
          <button v-if="hasFiscalPrinter" @click="printFiscalX"
            :disabled="fiscalBusy"
            class="w-full py-3 bg-amber-600 hover:bg-amber-700 disabled:opacity-50 disabled:cursor-not-allowed text-white rounded-2xl font-bold shadow-md transition-colors active:scale-95 flex items-center justify-center gap-2 text-sm">
            <Printer class="size-5" /> Stampa Lettura X Fiscale (stampante RT)
          </button>
        </div>

        <!-- TAB: LETTURA Z (CHIUSURA) -->
        <div v-if="activeTab === 'zReport'" class="space-y-4">
          <div class="bg-red-50 border border-red-200 rounded-xl p-3 md:p-4 flex items-start gap-2 text-sm">
            <AlertTriangle class="size-5 text-red-600 shrink-0 mt-0.5" />
            <div>
              <p class="font-bold text-red-800">Lettura Z – Chiusura Giornata</p>
              <p class="text-red-700 text-xs mt-0.5">Azzera le transazioni e registra la chiusura. Operazione irreversibile.</p>
            </div>
          </div>

          <!-- Storico chiusure -->
          <div v-if="orderStore.dailyClosures.length > 0" class="bg-white rounded-2xl border border-gray-200 shadow-sm p-4">
            <h5 class="font-bold text-gray-600 text-xs uppercase tracking-wider mb-3 flex items-center gap-1">
              <History class="size-4" /> Chiusure Precedenti
            </h5>
            <div class="space-y-2 max-h-40 overflow-y-auto">
              <div v-for="(ch, idx) in [...orderStore.dailyClosures].reverse()" :key="idx"
                class="flex justify-between items-center p-3 bg-gray-50 rounded-xl border border-gray-100 text-sm">
                <div>
                  <p class="font-bold text-gray-800">Chiusura Z #{{ orderStore.dailyClosures.length - idx }}</p>
                  <p class="text-[10px] text-gray-400">{{ new Date(ch.timestamp).toLocaleString(locale, { timeZone: timezone }) }}</p>
                </div>
                <div class="text-right">
                  <p class="font-black text-base theme-text">€{{ ch.totalReceived.toFixed(2) }}</p>
                  <p class="text-[10px] text-gray-400">{{ ch.receiptCount }} scontrini</p>
                  <p v-if="ch.totalDiscount > 0" class="text-[10px] text-red-500">-€{{ ch.totalDiscount.toFixed(2) }} sconti</p>
                  <p v-if="ch.totalTips > 0" class="text-[10px] text-amber-600">+€{{ ch.totalTips.toFixed(2) }} mance</p>
                </div>
              </div>
            </div>
          </div>

          <!-- Preview prima di chiudere -->
          <div v-if="zPreview" class="bg-white rounded-2xl border border-red-200 shadow-sm p-4">
            <h5 class="font-bold text-red-600 text-xs uppercase tracking-wider mb-3 flex items-center gap-1">
              <ClipboardList class="size-4" /> Riepilogo da Chiudere
            </h5>
            <div class="space-y-1 text-sm">
              <div class="flex justify-between"><span class="text-gray-500">Totale scontrino</span><span class="font-black theme-text text-base">€{{ zPreview.totalReceived.toFixed(2) }}</span></div>
              <!-- Scontrino per metodo -->
              <div v-for="(val, method) in zPreview.byMethod" :key="method" class="text-xs">
                <div class="flex justify-between ml-3">
                  <span class="text-gray-400">– {{ method }}</span>
                  <span class="font-bold">€{{ val.toFixed(2) }}</span>
                </div>
                <div v-if="zPreview.tipsByMethod && zPreview.tipsByMethod[method]"
                  class="flex justify-between ml-6">
                  <span class="text-amber-500 flex items-center gap-0.5"><Gift class="size-2.5" /> mancia</span>
                  <span class="font-bold text-amber-500">+€{{ zPreview.tipsByMethod[method].toFixed(2) }}</span>
                </div>
              </div>
              <!-- Mance autonome (metodi non presenti nello scontrino) -->
              <template v-if="zPreview.tipsByMethod">
                <template v-for="(tipVal, tipMethod) in zPreview.tipsByMethod" :key="'ztip_' + tipMethod">
                  <div v-if="!(tipMethod in zPreview.byMethod)" class="flex justify-between ml-3 text-xs">
                    <span class="text-amber-500 flex items-center gap-1"><Gift class="size-2.5" /> {{ tipMethod }}</span>
                    <span class="font-bold text-amber-500">+€{{ tipVal.toFixed(2) }}</span>
                  </div>
                </template>
              </template>
              <div v-if="zPreview.totalDiscount > 0 || zPreview.totalTips > 0" class="pt-1 border-t border-gray-100 mt-1 space-y-1">
                <div v-if="zPreview.totalDiscount > 0" class="flex justify-between items-center">
                  <span class="text-gray-500 flex items-center gap-1"><Tag class="size-3 text-red-400" /> Sconti applicati</span>
                  <span class="font-bold text-red-600">-€{{ zPreview.totalDiscount.toFixed(2) }}</span>
                </div>
                <div v-if="zPreview.totalTips > 0" class="flex justify-between items-center">
                  <span class="text-gray-500 flex items-center gap-1"><Gift class="size-3 text-amber-500" /> Mance incassate</span>
                  <span class="font-bold text-amber-600">+€{{ zPreview.totalTips.toFixed(2) }}</span>
                </div>
              </div>
              <div class="flex justify-between pt-1 border-t border-gray-100 mt-1"><span class="text-gray-500">Scontrini</span><span class="font-bold">{{ zPreview.receiptCount }}</span></div>
              <div class="flex justify-between"><span class="text-gray-500">Coperti totali</span><span class="font-bold">{{ zPreview.totalCovers }}</span></div>
              <div class="flex justify-between"><span class="text-gray-500">Scontrino medio</span><span class="font-bold">€{{ zPreview.averageReceipt.toFixed(2) }}</span></div>
              <template v-if="zHasClosureTypeData">
                <div class="pt-1 border-t border-gray-100 mt-1">
                  <p class="text-[10px] font-bold text-gray-400 uppercase tracking-wider mb-1">Tipologia Chiusura</p>
                  <div v-if="zPreview.fiscalCount > 0" class="flex justify-between items-center py-1">
                    <span class="text-gray-500 flex items-center gap-1.5"><Receipt class="size-3 text-blue-400" /> Scontrino Fiscale <span class="text-[10px] text-blue-400">×{{ zPreview.fiscalCount }}</span></span>
                    <span class="font-bold text-blue-600">€{{ zPreview.fiscalTotal.toFixed(2) }}</span>
                  </div>
                  <div v-if="zPreview.invoiceCount > 0" class="flex justify-between items-center py-1">
                    <span class="text-gray-500 flex items-center gap-1.5"><FileText class="size-3 text-violet-400" /> Fattura <span class="text-[10px] text-violet-400">×{{ zPreview.invoiceCount }}</span></span>
                    <span class="font-bold text-violet-600">€{{ zPreview.invoiceTotal.toFixed(2) }}</span>
                  </div>
                </div>
              </template>
            </div>
          </div>

          <button @click="previewDailyClose"
            class="w-full py-3 bg-gray-100 hover:bg-gray-200 text-gray-700 rounded-2xl font-bold border border-gray-200 transition-colors active:scale-95 flex items-center justify-center gap-2 text-sm">
            <Eye class="size-5" /> Anteprima Chiusura
          </button>

          <!-- Stampa Z fiscale RT (prima della chiusura locale) -->
          <button v-if="hasFiscalPrinter && isAdmin" @click="printFiscalZ"
            :disabled="fiscalBusy"
            class="w-full py-3 bg-orange-600 hover:bg-orange-700 disabled:opacity-50 disabled:cursor-not-allowed text-white rounded-2xl font-bold shadow-md transition-colors active:scale-95 flex items-center justify-center gap-2 text-sm">
            <Printer class="size-5" /> Stampa Lettura Z Fiscale (stampante RT)
          </button>

          <button v-if="isAdmin" @click="confirmDailyClose"
            class="w-full py-4 bg-red-600 hover:bg-red-700 text-white rounded-2xl font-bold shadow-md transition-colors active:scale-95 flex items-center justify-center gap-2 text-sm md:text-base">
            <Lock class="size-5" /> Esegui Lettura Z (Chiudi Giornata)
          </button>
        </div>

        <!-- TAB: STAMPANTE FISCALE RT -->
        <div v-if="activeTab === 'fiscal'" class="space-y-4">

          <div v-if="!hasFiscalPrinter" class="bg-amber-50 border border-amber-200 rounded-xl p-4 text-sm text-amber-800 flex items-start gap-2">
            <Info class="size-5 shrink-0 mt-0.5" />
            <div>
              <p class="font-bold">Nessuna stampante fiscale RT configurata.</p>
              <p class="text-xs mt-1">Configurare una stampante di tipo <code>fpmate</code> nelle impostazioni per abilitare le operazioni fiscali.</p>
            </div>
          </div>

          <template v-else>

            <!-- Stato operazione -->
            <div v-if="fiscalMessage" class="rounded-xl p-3 flex items-start gap-2 text-sm"
              :class="fiscalMessage.ok ? 'bg-emerald-50 border border-emerald-200 text-emerald-800' : 'bg-red-50 border border-red-200 text-red-800'">
              <component :is="fiscalMessage.ok ? CheckCircle2 : XCircle" class="size-5 shrink-0 mt-0.5" />
              <p class="font-medium whitespace-pre-line">{{ fiscalMessage.text }}</p>
            </div>

            <!-- Stato stampante -->
            <div class="bg-white rounded-2xl border border-gray-200 shadow-sm p-4 md:p-5">
              <h4 class="font-bold text-gray-700 text-sm uppercase tracking-wider mb-3 flex items-center gap-2">
                <Info class="size-4 text-blue-600" /> Stato Stampante
              </h4>
              <button @click="queryFiscalStatus('1')"
                :disabled="fiscalBusy"
                class="w-full py-2.5 bg-blue-600 hover:bg-blue-700 disabled:opacity-50 text-white rounded-xl font-bold text-sm flex items-center justify-center gap-2 active:scale-95 transition-all">
                <RefreshCw class="size-4" :class="fiscalBusy ? 'animate-spin' : ''" /> Interroga stato RT
              </button>
              <div v-if="fiscalStatus" class="mt-3 space-y-1.5 text-sm">
                <div class="flex justify-between"><span class="text-gray-500">Giornata aperta</span><span class="font-bold" :class="fiscalStatus.rtDailyOpen === '1' ? 'text-emerald-600' : 'text-red-600'">{{ fiscalStatus.rtDailyOpen === '1' ? 'Sì' : 'No' }}</span></div>
                <div class="flex justify-between"><span class="text-gray-500">Z necessario</span><span class="font-bold" :class="fiscalStatus.rtNoWorkingPeriod === '1' ? 'text-amber-600' : 'text-gray-700'">{{ fiscalStatus.rtNoWorkingPeriod === '1' ? 'Sì' : 'No' }}</span></div>
                <div class="flex justify-between"><span class="text-gray-500">File da inviare</span><span class="font-bold" :class="Number(fiscalStatus.rtFileToSend) > 0 ? 'text-amber-600' : 'text-gray-700'">{{ fiscalStatus.rtFileToSend ?? '0' }}</span></div>
                <div v-if="Number(fiscalStatus.rtFileRejected) > 0" class="flex justify-between"><span class="text-gray-500">File rifiutati</span><span class="font-bold text-red-600">{{ fiscalStatus.rtFileRejected }}</span></div>
                <div class="flex justify-between"><span class="text-gray-500">Stato principale</span><span class="font-bold text-gray-700">{{ fiscalStatus.rtMainStatus ?? '–' }}</span></div>
                <div class="flex justify-between"><span class="text-gray-500">Matricola</span><span class="font-bold text-gray-700">{{ fiscalStatus.serialNumber ?? '–' }}</span></div>
                <div v-if="fiscalStatus.rtExpiryCD" class="flex justify-between"><span class="text-gray-500">Scadenza certificato</span><span class="font-bold text-gray-700">{{ fiscalStatus.rtExpiryCD }}</span></div>
              </div>
            </div>

            <!-- Operazioni rapide -->
            <div class="bg-white rounded-2xl border border-gray-200 shadow-sm p-4 md:p-5">
              <h4 class="font-bold text-gray-700 text-sm uppercase tracking-wider mb-3 flex items-center gap-2">
                <Coins class="size-4 text-emerald-600" /> Operazioni Rapide
              </h4>
              <div class="grid grid-cols-2 gap-2">
                <button @click="openDrawer" :disabled="fiscalBusy"
                  class="py-2.5 bg-gray-700 hover:bg-gray-800 disabled:opacity-50 text-white rounded-xl font-bold text-sm flex items-center justify-center gap-2 active:scale-95 transition-all">
                  <Coins class="size-4" /> Apri Cassetto
                </button>
                <button @click="printDuplicate" :disabled="fiscalBusy"
                  class="py-2.5 bg-blue-600 hover:bg-blue-700 disabled:opacity-50 text-white rounded-xl font-bold text-sm flex items-center justify-center gap-2 active:scale-95 transition-all">
                  <Copy class="size-4" /> Duplicato Scontrino
                </button>
              </div>
            </div>

            <!-- Movimento cassa fiscale -->
            <div class="bg-white rounded-2xl border border-gray-200 shadow-sm p-4 md:p-5">
              <h4 class="font-bold text-gray-700 text-sm uppercase tracking-wider mb-3 flex items-center gap-2">
                <ArrowLeftRight class="size-4 text-purple-600" /> Movimento Cassa Fiscale
              </h4>
              <p class="text-xs text-gray-400 mb-3">Versamento o prelievo registrato nella memoria fiscale della stampante RT.</p>
              <div class="space-y-3">
                <div class="flex gap-2">
                  <button @click="cashDir = 'in'" :class="cashDir === 'in' ? 'bg-emerald-600 text-white' : 'bg-gray-100 text-gray-600'" class="flex-1 py-2.5 rounded-xl font-bold text-sm transition-all">Versamento</button>
                  <button @click="cashDir = 'out'" :class="cashDir === 'out' ? 'bg-red-600 text-white' : 'bg-gray-100 text-gray-600'" class="flex-1 py-2.5 rounded-xl font-bold text-sm transition-all">Prelievo</button>
                </div>
                <NumericInput v-model="cashAmountInput" min="0" step="1" :prefix="configStore.config.ui.currency"
                  class="w-full px-4 py-3 border-2 border-gray-200 rounded-xl font-black text-xl text-gray-800 focus:border-[var(--brand-primary)] focus:outline-none" placeholder="0.00" />
                <button @click="execFiscalCash" :disabled="fiscalBusy || !cashAmount"
                  class="w-full py-3 bg-purple-600 hover:bg-purple-700 disabled:opacity-50 text-white rounded-xl font-bold text-sm flex items-center justify-center gap-2 active:scale-95 transition-all">
                  <ArrowLeftRight class="size-4" /> Conferma {{ cashDir === 'in' ? 'Versamento' : 'Prelievo' }}
                </button>
              </div>
            </div>

            <!-- Annullo scontrino (VOID) -->
            <div class="bg-white rounded-2xl border border-gray-200 shadow-sm p-4 md:p-5">
              <h4 class="font-bold text-gray-700 text-sm uppercase tracking-wider mb-3 flex items-center gap-2">
                <RotateCcw class="size-4 text-red-600" /> Annullo Scontrino (Void)
              </h4>
              <p class="text-xs text-gray-400 mb-3">Seleziona uno scontrino emesso oggi per emettere il documento di annullo fiscale. Operazione irreversibile.</p>
              <div v-if="voidableReceipts.length === 0" class="text-sm text-gray-400 italic py-2">Nessuno scontrino fiscale emesso disponibile.</div>
              <template v-else>
                <select v-model="voidSelection" class="w-full px-3 py-2.5 border-2 border-gray-200 rounded-xl text-sm font-bold text-gray-700 focus:border-[var(--brand-primary)] focus:outline-none mb-3">
                  <option value="">Seleziona scontrino…</option>
                  <option v-for="r in voidableReceipts" :key="r.id" :value="r.id">
                    #{{ r.fiscalReceiptNumber }} · {{ r.tableLabel || r.table }} · €{{ Number(r.totalAmount).toFixed(2) }} · {{ r.fiscalReceiptDate }}
                  </option>
                </select>
                <button @click="execFiscalVoid" :disabled="fiscalBusy || !voidSelection"
                  class="w-full py-3 bg-red-600 hover:bg-red-700 disabled:opacity-50 text-white rounded-xl font-bold text-sm flex items-center justify-center gap-2 active:scale-95 transition-all">
                  <RotateCcw class="size-4" /> Emetti Annullo
                </button>
              </template>
            </div>

          </template>
        </div>

      </div>
    </div>
  </div>
</template>

<script setup>
import { ref, computed, watch } from 'vue';
import {
  X, Landmark, Wallet, ArrowLeftRight, ArrowDownCircle, ArrowUpCircle, Plus,
  Eye, AlertTriangle, Lock, RefreshCw, Save, TrendingUp, CreditCard, Users,
  Receipt, History, ClipboardList, Tag, Gift, FileText, Printer, Copy, RotateCcw,
  Coins, Info, CheckCircle2, XCircle,
} from 'lucide-vue-next';
import { Banknote } from 'lucide-vue-next';
import { useConfigStore, useOrderStore } from '../store/index.js';
import { useAuth } from '../composables/useAuth.js';
import NumericInput from './NumericInput.vue';
import {
  dispatchFiscalZReport, dispatchFiscalXReport, dispatchFiscalStatus,
  dispatchFiscalDuplicate, dispatchFiscalOpenDrawer, dispatchFiscalCash,
  dispatchFiscalVoid, resolveFiscalPrinter,
} from '../composables/useFiscalPrint.js';

defineProps({ modelValue: Boolean });
defineEmits(['update:modelValue']);

const configStore = useConfigStore();
const orderStore = useOrderStore();
const { isAdmin } = useAuth();
const locale = computed(() => configStore.config?.locale ?? 'it-IT');
const timezone = computed(() => configStore.config?.timezone ?? 'Europe/Rome');

const tabs = [
  { id: 'cashBalance', label: 'Fondo Cassa', icon: Wallet },
  { id: 'xReport', label: 'Lettura X', icon: Eye },
  { id: 'zReport', label: 'Lettura Z', icon: Lock },
  { id: 'fiscal', label: 'Fiscale RT', icon: Printer },
];

const activeTab = ref('cashBalance');

watch(activeTab, (tab) => {
  if (tab === 'xReport') {
    refreshXReport();
  }
});

// ── Cash Balance ────────────────────────────────────────────────────────────
const cashBalanceInput = ref(orderStore.cashBalance);

function saveCashBalance() {
  const amount = parseFloat(cashBalanceInput.value);
  if (!isNaN(amount) && amount >= 0) {
    orderStore.setFondoCassa(amount);
  }
}

// ── Cash Movements ─────────────────────────────────────────────────────────
const movementType = ref('deposit');
const movementAmount = ref(0);
const movementReason = ref('');

async function addMovement() {
  const amount = parseFloat(movementAmount.value);
  if (isNaN(amount) || amount <= 0) return;
  await orderStore.addCashMovement(movementType.value, amount, movementReason.value || movementType.value);
  movementAmount.value = 0;
  movementReason.value = '';
}

// ── X Report ──────────────────────────────────────────────────────────────
const xSummary = ref(null);

function refreshXReport() {
  xSummary.value = orderStore.generateXReport();
}

// ── Daily Close ────────────────────────────────────────────────────────────
const zPreview = ref(null);

function previewDailyClose() {
  zPreview.value = orderStore.generateXReport();
}

async function confirmDailyClose() {
  if (!zPreview.value) {
    zPreview.value = orderStore.generateXReport();
  }
  if (!confirm(`Confermi la Chiusura Z? Totale: €${zPreview.value.totalReceived.toFixed(2)}. Questa operazione è irreversibile.`)) return;
  await orderStore.performDailyClose();
  zPreview.value = null;
  cashBalanceInput.value = orderStore.cashBalance;
}

// ── Helpers ────────────────────────────────────────────────────────────────
function getMethodIcon(methodLabel) {
  const m = configStore.config.paymentMethods.find(x => x.label === methodLabel);
  if (!m) return Banknote;
  return m.icon === 'credit-card' ? CreditCard : Banknote;
}

const xHasClosureTypeData = computed(() =>
  xSummary.value != null && (xSummary.value.fiscalCount > 0 || xSummary.value.invoiceCount > 0),
);
const zHasClosureTypeData = computed(() =>
  zPreview.value != null && (zPreview.value.fiscalCount > 0 || zPreview.value.invoiceCount > 0),
);

// ── Stampante fiscale RT ─────────────────────────────────────────────────────
const hasFiscalPrinter = computed(() => resolveFiscalPrinter() != null);
const fiscalBusy = ref(false);
const fiscalMessage = ref(null); // { ok: boolean, text: string }
const fiscalStatus = ref(null);  // addInfo mappa dalla risposta queryPrinterStatus RT
const cashDir = ref('in');
const cashAmountInput = ref(0);
const cashAmount = computed(() => parseFloat(cashAmountInput.value) || 0);
const voidSelection = ref('');

// Scontrini fiscali emessi con numero scontrino → candidati all'annullo (VOID).
// orderStore.fiscalReceipts is auto-unwrapped by Pinia to the array value.
const voidableReceipts = computed(() => {
  const list = orderStore?.fiscalReceipts ?? [];
  return list.filter((r) => r && r.fiscalReceiptNumber && r.status !== 'void')
    .slice().reverse();
});

function setFiscalMessage(ok, text) {
  fiscalMessage.value = { ok, text };
}

async function runFiscal(fn, successMsg) {
  if (fiscalBusy.value) return;
  fiscalBusy.value = true;
  fiscalMessage.value = null;
  try {
    const res = await fn();
    if (res.ok) {
      setFiscalMessage(true, successMsg);
    } else {
      setFiscalMessage(false, res.error || 'Operazione non riuscita.');
    }
    return res;
  } catch (err) {
    setFiscalMessage(false, err?.message ?? String(err));
    return { ok: false, error: err?.message };
  } finally {
    fiscalBusy.value = false;
  }
}

async function printFiscalX() {
  return runFiscal(() => dispatchFiscalXReport(), 'Lettura X fiscale inviata alla stampante RT.');
}

async function printFiscalZ() {
  if (!confirm('Confermi la stampa della Lettura Z fiscale? Trasmette i dati all\'Agenzia delle Entrate e chiude la giornata fiscale.')) return;
  return runFiscal(() => dispatchFiscalZReport(), 'Lettura Z fiscale inviata. Chiusura fiscale in corso sulla stampante RT.');
}

async function queryFiscalStatus(statusType = '1') {
  return runFiscal(async () => {
    const res = await dispatchFiscalStatus({ statusType });
    if (res.ok) {
      const addInfo = res.fiscal?.addInfo ?? {};
      fiscalStatus.value = addInfo;
      return { ok: true };
    }
    fiscalStatus.value = null;
    return res;
  }, 'Stato stampante interrogato.');
}

async function openDrawer() {
  return runFiscal(() => dispatchFiscalOpenDrawer(), 'Apertura cassetto inviata alla stampante fiscale.');
}

async function printDuplicate() {
  return runFiscal(() => dispatchFiscalDuplicate(), 'Duplicato ultimo scontrino inviato alla stampante fiscale.');
}

async function execFiscalCash() {
  if (cashAmount.value <= 0) { setFiscalMessage(false, 'Inserire un importo valido.'); return; }
  const verb = cashDir.value === 'in' ? 'versamento di' : 'prelievo di';
  if (!confirm(`Confermi il ${verb} €${cashAmount.value.toFixed(2)} sulla stampante fiscale?`)) return;
  return runFiscal(
    () => dispatchFiscalCash({ direction: cashDir.value, amount: cashAmount.value }),
    `${cashDir.value === 'in' ? 'Versamento' : 'Prelievo'} di €${cashAmount.value.toFixed(2)} registrato sulla stampante fiscale.`,
  );
}

async function execFiscalVoid() {
  const target = voidableReceipts.value.find((r) => r.id === voidSelection.value);
  if (!target) { setFiscalMessage(false, 'Selezionare uno scontrino da annullare.'); return; }
  if (!confirm(`Confermi l'annullo fiscale dello scontrino #${target.fiscalReceiptNumber} (€${Number(target.totalAmount).toFixed(2)})? Operazione irreversibile.`)) return;
  // fiscalReceiptDate is "dd/mm/yyyy"; fall back to the ISO basic datetime
  // (YYYYMMDDTHHMMSS) only by converting it to "dd/mm/yyyy" so the server-side
  // formatter receives a date it can normalize to ddmmyyyy (not raw YYYYMMDD,
  // which would be misread as ddmmyyyy with the year first).
  const isoFallback = (() => {
    const iso = target.receiptISODateTime ?? '';
    const m = /^(\d{4})(\d{2})(\d{2})/.exec(iso);
    return m ? `${m[3]}/${m[2]}/${m[1]}` : '';
  })();
  const receiptRef = {
    zRepNumber: target.zRepNumber ?? target.fiscalZRepNumber ?? '',
    fiscalReceiptNumber: target.fiscalReceiptNumber,
    date: target.fiscalReceiptDate ?? isoFallback,
    serialNumber: target.serialNumber ?? '',
  };
  const res = await runFiscal(
    () => dispatchFiscalVoid({ receiptRef }),
    `Annullo scontrino #${target.fiscalReceiptNumber} inviato alla stampante fiscale.`,
  );
  // Mark the original receipt as voided in the store so it drops out of
  // voidableReceipts (status !== 'void'), preventing repeated void attempts and
  // keeping local audit state consistent with the fiscal printer.
  if (res?.ok) {
    orderStore.updateFiscalReceipt(target.id, { status: 'void', voidedAt: new Date().toISOString() });
    voidSelection.value = '';
  }
  return res;
}
</script>
