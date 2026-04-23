<template>
  <!-- WORKSPACE: WAITER ORDER MANAGEMENT -->
  <div class="flex-1 flex overflow-hidden relative">

    <!-- ============================================================ -->
    <!-- SIDEBAR: Order list                                          -->
    <!-- ============================================================ -->
    <aside :class="['w-full md:w-[380px] lg:w-[420px] bg-white border-r border-gray-200 flex flex-col shadow-lg z-10 h-full shrink-0', selectedOrder ? 'hidden md:flex' : 'flex']">

      <!-- Tabs: In Attesa / In Cucina -->
      <div class="flex p-2 gap-1.5 bg-gray-50 border-b border-gray-200 shrink-0">
        <button
          @click="changeTab('pending')"
          aria-label="In Attesa"
          :class="activeTab === 'pending' ? 'bg-amber-100 text-amber-800 border-amber-200 font-bold' : 'bg-white text-gray-500 border-gray-200 hover:bg-gray-100'"
          class="flex-1 py-1.5 md:py-2 px-1 rounded-xl border transition-all flex items-center justify-center gap-1.5 shadow-sm"
        >
          <div class="relative shrink-0">
            <Bell class="size-4 md:size-5" />
            <span
              v-if="orderStore.pendingCount > 0"
              class="absolute -top-1.5 -right-2 bg-red-500 text-white text-[9px] font-bold size-4 flex items-center justify-center rounded-full border border-white"
            >{{ orderStore.pendingCount }}</span>
          </div>
          <span class="text-[9px] md:text-[10px] uppercase tracking-wider hidden sm:inline">In Attesa</span>
        </button>
        <button
          @click="changeTab('accepted')"
          aria-label="In Cucina"
          :class="activeTab === 'accepted' ? 'bg-teal-100 text-teal-800 border-teal-200 font-bold' : 'bg-white text-gray-500 border-gray-200 hover:bg-gray-100'"
          class="flex-1 py-1.5 md:py-2 px-1 rounded-xl border transition-all flex items-center justify-center gap-1.5 shadow-sm"
        >
          <div class="relative shrink-0">
            <ChefHat class="size-4 md:size-5" />
            <span
              v-if="acceptedCount > 0"
              class="absolute -top-1.5 -right-2 bg-teal-600 text-white text-[9px] font-bold size-4 flex items-center justify-center rounded-full border border-white"
            >{{ acceptedCount }}</span>
          </div>
          <span class="text-[9px] md:text-[10px] uppercase tracking-wider hidden sm:inline">In Cucina</span>
        </button>
        <button
          @click="changeTab('history')"
          aria-label="Chiusi"
          :class="activeTab === 'history' ? 'bg-gray-200 text-gray-800 border-gray-300 font-bold' : 'bg-white text-gray-500 border-gray-200 hover:bg-gray-100'"
          class="flex-1 py-1.5 md:py-2 px-1 rounded-xl border transition-all flex items-center justify-center gap-1.5 shadow-sm"
        >
          <div class="relative shrink-0">
            <History class="size-4 md:size-5" />
            <span
              v-if="historyCount > 0"
              class="absolute -top-1.5 -right-2 bg-gray-500 text-white text-[9px] font-bold size-4 flex items-center justify-center rounded-full border border-white"
            >{{ historyCount }}</span>
          </div>
          <span class="text-[9px] md:text-[10px] uppercase tracking-wider hidden sm:inline">Chiusi</span>
        </button>
      </div>

      <!-- Order list -->
      <div class="flex-1 overflow-y-auto p-2 md:p-3 space-y-2.5 bg-gray-100/50 pb-20 md:pb-3">
        <div v-if="filteredOrders.length === 0" class="h-full flex flex-col items-center justify-center text-gray-400 opacity-60">
          <ClipboardList class="size-12 md:size-16 mb-4" />
          <p class="font-medium text-sm md:text-lg">Nessuna comanda</p>
          <p class="text-xs mt-1">{{ activeTab === 'pending' ? 'Vai su Sala per creare una nuova comanda.' : activeTab === 'accepted' ? 'Nessun ordine in cucina al momento.' : 'Nessun ordine chiuso.' }}</p>
        </div>

        <template v-for="(order, idx) in filteredOrders" :key="order.id">
          <!-- Section divider before first delivered order (In Cucina tab only) -->
          <div
            v-if="activeTab === 'accepted' && order.status === 'delivered' && (idx === 0 || filteredOrders[idx - 1].status !== 'delivered')"
            class="flex items-center gap-2 pt-1 pb-0.5 text-[10px] uppercase font-bold tracking-widest text-gray-500"
          >
            <CheckCircle2 class="size-3.5 shrink-0" />
            <span>Consegnate</span>
            <div class="flex-1 h-px bg-gray-200 ml-0.5"></div>
          </div>
          <OrderSidebarCard
            :order="order"
            :selected="selectedOrder?.id === order.id"
            note-visibility-key="sala"
            @click="selectOrder(order)"
          />
        </template>
      </div>
    </aside>

    <!-- ============================================================ -->
    <!-- MAIN AREA: Order detail                                      -->
    <!-- ============================================================ -->
    <main :class="['flex-1 bg-gray-100 flex-col h-full overflow-hidden relative', selectedOrder ? 'flex' : 'hidden md:flex']">

      <!-- Empty state -->
      <div v-if="!selectedOrder" class="absolute inset-0 flex flex-col items-center justify-center text-gray-400 bg-gray-100">
        <MousePointerClick class="size-16 md:size-24 opacity-20 mb-4 md:mb-6" />
        <h2 class="text-xl md:text-2xl font-bold text-gray-500">Gestione Comande</h2>
        <p class="text-sm text-gray-400 mt-2 hidden md:block">Seleziona una comanda per visualizzarla o modificarla.</p>
      </div>

      <!-- Order detail -->
      <div v-else :key="'det_' + selectedOrder.id" class="flex flex-col h-full w-full bg-white relative">

        <!-- Detail header -->
        <div class="bg-white border-b border-gray-200 p-3 md:p-5 shrink-0 shadow-sm z-10 flex flex-col sm:flex-row sm:justify-between sm:items-center gap-3 md:gap-4">
          <div class="flex items-center gap-3 flex-1">
            <button @click="selectedOrder = null" class="md:hidden p-2 -ml-2 bg-gray-100 hover:bg-gray-200 rounded-full text-gray-700 flex items-center justify-center">
              <ArrowLeft class="size-5" />
            </button>
            <div class="size-10 md:size-14 rounded-xl theme-bg text-white flex items-center justify-center font-black text-xl md:text-2xl shadow-inner shrink-0">
              {{ selectedOrder.table }}
            </div>
            <div class="flex flex-col justify-center">
              <h2 class="text-lg md:text-2xl font-bold text-gray-800 leading-tight">Tavolo {{ selectedOrder.table }}</h2>
              <div class="flex flex-wrap items-center gap-2 mt-0.5 md:mt-1">
                <span class="text-gray-500 text-[10px] md:text-xs font-medium flex items-center gap-1">
                  <Clock class="size-3" />{{ selectedOrder.time }}
                </span>
                <span class="text-gray-500 text-[10px] md:text-xs font-medium"><Hash class="size-3 inline mr-0.5" />{{ formatOrderIdShort(selectedOrder.id) }}</span>
                <span v-if="selectedOrder.dietaryPreferences?.diete?.length > 0 || selectedOrder.dietaryPreferences?.allergeni_dichiarati?.length > 0"
                  class="text-red-500 font-bold uppercase text-[9px] flex items-center gap-0.5 bg-red-50 px-1.5 py-0.5 rounded border border-red-100">
                  <AlertTriangle class="size-3" /> Note Allergie
                </span>
              </div>
            </div>
          </div>

          <!-- Action buttons -->
          <div class="flex gap-2 w-full sm:w-auto items-center justify-end">
            <!-- Jump to table (sala) button -->
            <button
              @click="$emit('jump-to-sala', selectedOrder.table)"
              class="px-2.5 py-2.5 md:p-3 bg-gray-100 text-gray-700 hover:text-[var(--brand-primary)] hover:bg-[var(--brand-primary)]/10 border border-gray-200 hover:border-[var(--brand-primary)]/30 rounded-xl transition-all shadow-sm active:scale-95 flex items-center justify-center gap-1.5 shrink-0"
              title="Vai al Tavolo"
            >
              <LayoutGrid class="size-5 md:size-6" />
              <span class="hidden sm:inline text-xs font-bold">Tavolo</span>
            </button>
            <button
              @click="openGlobalNoteModal()"
              :class="selectedOrder.globalNote ? 'bg-amber-50 text-amber-700 border-amber-200 hover:bg-amber-100' : 'bg-gray-100 text-gray-700 border-gray-200 hover:text-[var(--brand-primary)] hover:bg-[var(--brand-primary)]/10 hover:border-[var(--brand-primary)]/30'"
              class="px-2.5 py-2.5 md:p-3 border rounded-xl transition-all shadow-sm active:scale-95 flex items-center justify-center gap-1.5 shrink-0"
              :title="selectedOrder.globalNote ? 'Nota ordine presente — clicca per modificare' : 'Aggiungi nota ordine'"
              :aria-label="selectedOrder.globalNote ? 'Nota ordine presente — clicca per modificare' : 'Aggiungi nota ordine'"
            >
              <MessageSquareWarning class="size-5 md:size-6" />
              <span class="hidden sm:inline text-xs font-bold">Nota</span>
            </button>

            <div class="h-8 w-px bg-gray-200 mx-1 hidden sm:block"></div>

            <!-- Pending order actions -->
            <template v-if="selectedOrder.status === 'pending'">
              <button
                @click="deleteOrder"
                class="flex-1 sm:flex-none px-3 py-2.5 md:py-3 bg-white text-red-600 border border-red-200 hover:bg-red-50 rounded-xl font-bold flex items-center justify-center gap-1.5 active:scale-95 transition-colors"
                title="Elimina comanda"
              >
                <Trash2 class="size-5" />
                <span class="hidden sm:inline text-xs md:text-sm">Elimina</span>
              </button>
              <button
                @click="openAddMenu(selectedOrder)"
                class="flex-1 sm:flex-none px-3 py-2.5 md:py-3 bg-gray-100 text-gray-700 border border-gray-200 hover:bg-gray-200 rounded-xl font-bold flex items-center justify-center gap-1.5 active:scale-95 transition-colors"
                title="Aggiungi piatti"
              >
                <PlusCircle class="size-5" />
                <span class="hidden sm:inline text-xs md:text-sm">Aggiungi</span>
              </button>
              <button
                @click="submitOrder"
                :disabled="selectedOrder.orderItems.length === 0"
                class="flex-[2] sm:flex-none px-4 py-2.5 md:py-3 theme-bg text-white shadow-md rounded-xl font-bold flex items-center justify-center gap-1.5 active:scale-95 hover:opacity-90 transition-opacity disabled:opacity-40 disabled:cursor-not-allowed"
                title="Invia comanda in cucina"
              >
                <Send class="size-5" />
                <span class="hidden sm:inline text-xs md:text-sm">Invia</span>
              </button>
            </template>

            <!-- Accepted order: override deliver available -->
            <template v-else-if="selectedOrder.status === 'accepted'">
              <div class="flex gap-2 w-full sm:w-auto items-center">
                <span class="flex-1 text-center px-3 py-2.5 md:py-3 bg-amber-50 text-amber-700 border border-amber-200 rounded-xl font-bold flex items-center justify-center gap-2 text-xs">
                  <ChefHat class="size-4" />
                  <span class="hidden sm:inline text-xs">In Cucina</span>
                </span>
                <button
                  @click="markDelivered(selectedOrder)"
                  class="px-3 py-2.5 md:py-3 bg-gray-500 hover:bg-gray-600 text-white shadow-md rounded-xl font-bold flex items-center justify-center gap-1.5 active:scale-95 transition-colors text-xs shrink-0"
                  title="Segna consegnata (override cucina)"
                >
                  <CheckCircle2 class="size-4" />
                  <span class="hidden sm:inline text-xs">Consegnata</span>
                </button>
              </div>
            </template>
            <template v-else-if="selectedOrder.status === 'preparing'">
              <div class="flex gap-2 w-full sm:w-auto items-center">
                <span class="flex-1 text-center px-3 py-2.5 md:py-3 bg-blue-50 text-blue-700 border border-blue-200 rounded-xl font-bold flex items-center justify-center gap-2 text-xs">
                  <Flame class="size-4" />
                  <span class="hidden sm:inline text-xs">In Cottura</span>
                </span>
                <button
                  @click="markDelivered(selectedOrder)"
                  class="px-3 py-2.5 md:py-3 bg-gray-500 hover:bg-gray-600 text-white shadow-md rounded-xl font-bold flex items-center justify-center gap-1.5 active:scale-95 transition-colors text-xs shrink-0"
                  title="Segna consegnata (override cucina)"
                >
                  <CheckCircle2 class="size-4" />
                  <span class="hidden sm:inline text-xs">Consegnata</span>
                </button>
              </div>
            </template>
            <template v-else-if="selectedOrder.status === 'ready'">
              <div class="flex gap-2 w-full sm:w-auto items-center">
                <span class="flex-1 text-center px-3 py-2.5 md:py-3 bg-teal-50 text-teal-700 border border-teal-200 rounded-xl font-bold flex items-center justify-center gap-2 text-xs">
                  <BellRing class="size-4" />
                  <span class="hidden sm:inline text-xs">Pronta</span>
                </span>
                <button
                  @click="markDelivered(selectedOrder)"
                  class="px-3 py-2.5 md:py-3 bg-gray-500 hover:bg-gray-600 text-white shadow-md rounded-xl font-bold flex items-center justify-center gap-1.5 active:scale-95 transition-colors text-xs shrink-0"
                >
                  <CheckCircle2 class="size-4" />
                  <span class="hidden sm:inline text-xs">Consegnata</span>
                </button>
              </div>
            </template>
            <template v-else-if="selectedOrder.status === 'delivered'">
              <span class="w-full sm:w-auto text-center px-4 py-2.5 md:py-3 bg-gray-100 text-gray-600 border border-gray-200 rounded-xl font-bold flex items-center justify-center gap-2">
                <CheckCircle2 class="size-5" />
                <span class="text-xs md:text-sm">Consegnata</span>
              </span>
            </template>
            <template v-else-if="selectedOrder.status === 'completed'">
              <span class="w-full sm:w-auto text-center px-4 py-2.5 md:py-3 bg-emerald-50 text-emerald-700 border border-emerald-200 rounded-xl font-bold flex items-center justify-center gap-2">
                <CheckCircle class="size-5" />
                <span class="text-xs md:text-sm">Pagato</span>
              </span>
            </template>
          </div>
        </div>

        <!-- Items list -->
        <OrderItemsList
          :order="selectedOrder"
          note-visibility-key="sala"
          read-only-message="Comanda già inviata in cucina — sola lettura."
          @edit-item="openNoteModal(selectedOrder, $event)"
          @add-items="openAddMenu(selectedOrder)"
        />

        <!-- Footer Totali -->
        <div class="bg-white border-t border-gray-200 p-3 md:p-5 shrink-0 z-10 shadow-[0_-5px_15px_rgba(0,0,0,0.05)] flex justify-between items-end pb-8 md:pb-5">
          <div>
            <p class="text-gray-500 text-[10px] md:text-xs font-bold uppercase">Pezzi Attivi</p>
            <p class="text-gray-800 text-lg md:text-xl font-black">{{ selectedOrder.itemCount }}</p>
          </div>
          <div class="text-right">
            <p class="text-gray-400 font-bold uppercase tracking-wider text-[10px] md:text-xs mb-0.5">Importo Comanda</p>
            <p class="text-2xl md:text-4xl font-black theme-text leading-none">{{ configStore.config.ui.currency }}{{ selectedOrder.totalAmount.toFixed(2) }}</p>
          </div>
        </div>
      </div>
    </main>

    <!-- ============================================================ -->
    <!-- MODAL: NOTA ORDINE                                          -->
    <!-- ============================================================ -->
    <GlobalOrderNoteModal v-model="globalNoteModal.show" :order="selectedOrder" />

    <!-- ============================================================ -->
    <!-- MODAL GLOBALE: CARRELLO AGGIUNTA MENU                        -->
    <!-- ============================================================ -->
    <div v-if="showAddMenuModal" class="fixed inset-0 z-[80] bg-black/80 backdrop-blur-sm flex items-end md:items-center justify-center p-0 md:p-4">
      <div class="bg-white rounded-t-3xl md:rounded-3xl shadow-2xl w-full max-w-6xl h-[95dvh] md:h-[85dvh] flex flex-col overflow-hidden relative">

        <div class="bg-gray-900 text-white p-3 md:p-4 flex justify-between items-center shrink-0">
          <div class="flex flex-col">
            <h3 class="font-bold text-base md:text-xl flex items-center gap-2"><BookOpen class="size-4 md:size-5 text-emerald-400" /> Aggiunta Piatti in Comanda</h3>
            <p class="text-[10px] text-gray-400 uppercase tracking-widest mt-0.5">Destinazione: Ord #{{ targetOrderForMenu ? formatOrderIdShort(targetOrderForMenu.id, 6, 4) : '' }} - Tavolo {{ targetOrderForMenu?.table }}</p>
          </div>
          <button @click="closeMenuModal" class="bg-white/10 hover:bg-white/20 p-2 md:p-2.5 rounded-full transition-colors active:scale-95"><X class="size-5 md:size-5" /></button>
        </div>

        <div class="flex flex-1 min-h-0 flex-col md:flex-row">

          <!-- Categorie Menu -->
          <div class="w-full md:w-[220px] border-b md:border-b-0 md:border-r border-gray-200 bg-gray-50 flex md:flex-col overflow-x-auto md:overflow-y-auto no-scrollbar shrink-0">
            <button v-for="(items, category) in configStore.config.menu" :key="'cat_'+category" @click="activeMenuCategory = category"
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
            <div v-for="item in configStore.config.menu[activeMenuCategory]" :key="'item_'+item.id"
                class="bg-white border border-gray-200 rounded-xl md:rounded-2xl shadow-sm hover:border-emerald-400 transition-all group flex flex-col h-full min-h-[100px] md:min-h-[120px] relative overflow-visible">

              <span v-if="getQtyCombined(item.id) > 0" class="absolute -top-2 -right-2 bg-emerald-500 text-white size-6 md:size-7 rounded-full flex items-center justify-center text-[10px] md:text-xs font-black border-2 border-white shadow-sm z-10">
                {{ getQtyCombined(item.id) }}
              </span>

              <!-- Title area — tap/click = quick-add -->
              <button @click="addToTempCart(item)"
                  :aria-label="'Aggiungi ' + item.name + ' al carrello'"
                  class="flex-1 flex items-start text-left p-3 md:p-4 pb-1 md:pb-2 w-full">
                <h4 class="font-bold text-gray-800 text-xs md:text-sm leading-tight group-hover:theme-text transition-colors line-clamp-3">{{ item.name }}</h4>
              </button>

              <!-- Bottom row: price left, icon actions + add button right -->
              <div class="px-3 md:px-4 pb-3 md:pb-4 flex items-center justify-between gap-1">
                <span class="font-black theme-text text-xs md:text-sm bg-emerald-50 px-1.5 py-0.5 rounded border border-emerald-100 shrink-0">{{ configStore.config.ui.currency }}{{ item.price.toFixed(2) }}</span>
                <div class="flex items-center gap-0.5 shrink-0">
                  <!-- Info button -->
                  <button @click="showItemInfo(item)"
                      :aria-label="'Informazioni su ' + item.name"
                      class="size-6 md:size-7 flex items-center justify-center rounded-lg text-gray-400 hover:text-teal-600 hover:bg-teal-50 transition-colors active:scale-95"
                      title="Dettagli piatto">
                    <Info class="size-3 md:size-3.5" />
                  </button>
                  <!-- Details (pen) button -->
                  <button @click="addToTempCartWithModal(item)"
                      :aria-label="'Aggiungi ' + item.name + ' con dettagli'"
                      class="size-6 md:size-7 flex items-center justify-center rounded-lg text-gray-400 hover:text-purple-600 hover:bg-purple-50 transition-colors active:scale-95"
                      title="Aggiungi con portata, note e varianti">
                    <PenLine class="size-3 md:size-3.5" />
                  </button>
                  <!-- Prominent add button -->
                  <button @click="addToTempCart(item)"
                      :aria-label="'Aggiungi ' + item.name + ' al carrello'"
                      class="size-7 md:size-8 flex items-center justify-center rounded-lg theme-bg text-white shadow-sm hover:opacity-90 active:scale-95 transition-all ml-0.5"
                      title="Aggiungi al carrello">
                    <Plus class="size-3.5 md:size-4" />
                  </button>
                </div>
              </div>
            </div>
          </div>

          <!-- CARRELLO TEMPORANEO -->
          <div class="w-full md:w-[320px] bg-gray-50 border-t md:border-t-0 md:border-l border-gray-200 flex flex-col shrink-0 h-[40vh] max-h-[40vh] md:max-h-none md:h-auto min-h-0">
            <div class="p-3 bg-gray-100 border-b border-gray-200 font-bold text-gray-700 text-xs uppercase tracking-wider flex items-center gap-2 shrink-0 shadow-sm z-10">
              <ShoppingCart class="size-4" /> Carrello Preparazione
            </div>

            <div class="flex-1 overflow-y-auto min-h-0 p-3 space-y-2">
              <div v-if="tempCart.length === 0" class="text-center text-gray-400 py-8 flex flex-col items-center">
                <MousePointerClick class="size-8 opacity-30 mb-2" />
                <p class="text-xs font-medium">Tocca i piatti nel menu per prepararli qui, poi inseriscili.</p>
              </div>
              <div v-for="(cartItem, idx) in tempCart" :key="cartItem.uid" class="bg-white rounded-lg shadow-sm overflow-hidden border-l-4" :class="getCourseBorderClass(cartItem.course)">
                <div class="p-2.5 flex items-start justify-between">
                  <div class="flex flex-col flex-1 min-w-0 pr-2">
                    <span class="font-bold text-sm text-gray-800 truncate">{{ cartItem.name }}</span>
                    <span class="text-[10px] text-gray-500">{{ configStore.config.ui.currency }}{{ getItemUnitPrice(cartItem).toFixed(2) }} cad.</span>
                    <div v-if="cartItem.notes && cartItem.notes.length > 0" class="text-[9px] text-amber-600 font-bold italic mt-0.5 truncate flex items-center gap-1">
                      <MessageSquareWarning class="size-3 shrink-0" /> {{ cartItem.notes.join(', ') }}
                    </div>
                  </div>
                  <div class="flex items-center gap-1.5 shrink-0">
                    <!-- Qty +/- -->
                    <div class="flex items-center gap-1 bg-gray-100 rounded p-0.5 border border-gray-200">
                      <button @click="updateTempCartQty(idx, -1)"
                        class="size-6 flex items-center justify-center bg-white rounded shadow-sm active:scale-95 transition-colors"
                        :class="cartItem.quantity === 1 ? 'text-red-500' : 'text-gray-600'"
                        :title="cartItem.quantity === 1 ? 'Rimuovi voce' : 'Diminuisci quantità'">
                        <Trash2 v-if="cartItem.quantity === 1" class="size-3" />
                        <Minus v-else class="size-3" />
                      </button>
                      <span class="w-5 text-center font-black text-sm">{{ cartItem.quantity }}</span>
                      <button @click="updateTempCartQty(idx, 1)" class="size-6 flex items-center justify-center bg-white theme-text rounded shadow-sm active:scale-95"><Plus class="size-3" /></button>
                    </div>
                    <!-- Note/Varianti edit button -->
                    <button @click="openCartNoteModal(idx)" class="p-1.5 text-gray-500 hover:text-[var(--brand-primary)] bg-gray-50 border border-gray-200 hover:bg-gray-100 rounded-md transition-colors active:scale-95 shadow-sm" title="Note e Varianti">
                      <PenLine class="size-3.5" />
                    </button>
                  </div>
                </div>
                <!-- Modificatori -->
                <div v-if="cartItem.modifiers && cartItem.modifiers.length > 0" class="px-2.5 pb-2">
                  <div class="flex flex-wrap gap-1">
                    <span v-for="(mod, mi) in cartItem.modifiers" :key="mi"
                      class="text-[9px] font-bold bg-purple-50 border border-purple-200 text-purple-700 px-1.5 py-0.5 rounded flex items-center gap-1">
                      <Sparkles class="size-2.5" />
                      {{ mod.name }}{{ mod.price > 0 ? ' +' + configStore.config.ui.currency + mod.price.toFixed(2) : '' }}
                      <button @click="removeModFromCart(idx, mi)" class="text-purple-400 hover:text-red-500 transition-colors"><X class="size-2.5" /></button>
                    </span>
                  </div>
                </div>
              </div>
            </div>

            <!-- Footer Inserimento in Comanda -->
            <div class="p-3 md:p-4 bg-white border-t border-gray-200 shrink-0 pb-8 md:pb-4 shadow-[0_-5px_15px_rgba(0,0,0,0.05)] z-10">
              <div class="flex justify-between items-center mb-3">
                <span class="text-[10px] font-bold text-gray-500 uppercase tracking-widest">Totale Aggiunte:</span>
                <span class="font-black text-lg text-gray-900">{{ configStore.config.ui.currency }}{{ tempCartTotal.toFixed(2) }}</span>
              </div>
              <button @click="confirmAndPushCart" :disabled="tempCart.length === 0" class="w-full theme-bg text-white py-3 md:py-4 rounded-xl font-bold shadow-md hover:opacity-90 transition-opacity active:scale-95 text-sm flex items-center justify-center gap-2 disabled:opacity-50 disabled:cursor-not-allowed">
                <CheckCircle class="size-5" /> <span>Inserisci nella Comanda</span>
              </button>
            </div>
          </div>
        </div>
      </div>
    </div>

    <!-- ============================================================ -->
    <!-- MODAL: INFO PIATTO                                           -->
    <!-- ============================================================ -->
    <DishInfoModal
      v-model="infoModal.show"
      :item="infoModal.item"
      @add-quick="infoModalAddQuick"
      @add-with-details="infoModalAddWithDetails"
    />

    <!-- ============================================================ -->
    <!-- NOTE + COURSE MODAL                                          -->
    <!-- Layout aligned with OrderManager for UI consistency.        -->
    <!-- ============================================================ -->
    <div v-if="noteModal.show" class="fixed inset-0 z-[80] bg-black/60 backdrop-blur-sm flex items-end md:items-center justify-center p-0 md:p-4">
      <div class="bg-white rounded-t-3xl md:rounded-3xl shadow-2xl w-full max-w-md overflow-hidden flex flex-col max-h-[92dvh] md:max-h-[85dvh]">

        <!-- Fixed header -->
        <div class="bg-gray-50 border-b border-gray-100 p-4 flex justify-between items-center shrink-0">
          <h3 class="font-bold text-base md:text-lg flex items-center gap-2">
            <PenLine class="text-gray-500 size-4 md:size-5" /> Note e Varianti
          </h3>
          <button ref="noteModalCloseBtn" @click="noteModal.show = false" aria-label="Chiudi" class="text-gray-400 hover:text-gray-800 p-1.5 bg-gray-200 hover:bg-gray-300 rounded-full active:scale-95 transition-colors">
            <X class="size-5" />
          </button>
        </div>

        <!-- Scrollable body -->
        <div class="overflow-y-auto flex-1 p-4 md:p-5 space-y-5">
          <p class="text-xs md:text-sm text-gray-500 truncate">Per: <strong>{{ noteModal.itemRef?.name }}</strong></p>

          <!-- Course selector -->
          <div>
            <p class="text-xs font-bold text-gray-500 uppercase tracking-widest mb-2 flex items-center gap-1.5">
              <Layers class="size-3.5" /> Ordine di Uscita
            </p>
            <div class="flex gap-2">
              <button
                @click="noteModal.course = 'prima'"
                :class="noteModal.course === 'prima' ? 'bg-orange-400 text-white border-orange-400' : 'bg-gray-100 text-gray-600 border-gray-200 hover:bg-gray-200'"
                class="flex-1 py-2.5 rounded-xl font-bold text-xs border transition-colors active:scale-95 flex flex-col items-center gap-1"
              >
                <span class="text-[9px] font-black uppercase tracking-wider opacity-70">1ª portata</span>
                Esce Prima
              </button>
              <button
                @click="noteModal.course = 'insieme'"
                :class="noteModal.course === 'insieme' ? 'theme-bg text-white theme-border' : 'bg-gray-100 text-gray-600 border-gray-200 hover:bg-gray-200'"
                class="flex-1 py-2.5 rounded-xl font-bold text-xs border transition-colors active:scale-95 flex flex-col items-center gap-1"
              >
                <span class="text-[9px] font-black uppercase tracking-wider opacity-70">2ª portata</span>
                Insieme
              </button>
              <button
                @click="noteModal.course = 'dopo'"
                :class="noteModal.course === 'dopo' ? 'bg-purple-500 text-white border-purple-500' : 'bg-gray-100 text-gray-600 border-gray-200 hover:bg-gray-200'"
                class="flex-1 py-2.5 rounded-xl font-bold text-xs border transition-colors active:scale-95 flex flex-col items-center gap-1"
              >
                <span class="text-[9px] font-black uppercase tracking-wider opacity-70">3ª portata</span>
                Esce Dopo
              </button>
            </div>
          </div>

          <!-- Variants / modifiers section -->
          <div class="pt-4 border-t border-gray-100">
            <p class="text-xs font-bold text-purple-600 uppercase tracking-widest mb-2 flex items-center gap-1.5">
              <Sparkles class="size-3.5" /> Varianti a Pagamento
            </p>

            <div v-if="noteModal.modifiersArray.length > 0" class="mb-3 space-y-1.5 max-h-[120px] overflow-y-auto border border-purple-100 p-2 rounded-xl bg-purple-50">
              <div
                v-for="(mod, idx) in noteModal.modifiersArray"
                :key="idx"
                class="flex justify-between items-center bg-white border border-purple-200 text-purple-800 px-3 py-2 rounded-lg text-xs font-bold shadow-sm"
              >
                <span>{{ mod.name }}{{ mod.price > 0 ? ' +' + configStore.config.ui.currency + mod.price.toFixed(2) : '' }}</span>
                <button @click="removeModFromNoteModal(idx)" class="text-red-500 p-1 hover:bg-red-50 rounded-md transition-colors">
                  <Trash2 class="size-4" />
                </button>
              </div>
            </div>

            <div v-if="configStore.config.ui.allowCustomVariants" class="flex gap-2 mb-3">
              <input
                v-model="noteModal.modName"
                type="text"
                placeholder="Es. Mozzarella, Senza glutine..."
                class="flex-1 bg-gray-100 border border-gray-200 rounded-xl px-3 py-3 focus:bg-white theme-ring transition-all text-gray-800 font-medium text-sm"
                @keyup.enter="addModToNoteModal"
              />
              <div class="relative w-24 shrink-0">
                <span class="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400 text-sm font-bold">{{ configStore.config.ui.currency }}</span>
                <input
                  :value="noteModal.modPrice"
                  type="text"
                  inputmode="decimal"
                  autocomplete="off"
                  placeholder="0.00"
                  class="w-full pl-7 pr-2 py-3 bg-gray-100 border border-gray-200 rounded-xl focus:bg-white theme-ring transition-all text-gray-800 font-medium text-sm"
                  @input="onModPriceInput"
                  @keyup.enter="addModToNoteModal"
                />
              </div>
              <button @click="addModToNoteModal" aria-label="Aggiungi variante" class="bg-purple-600 hover:bg-purple-700 text-white px-4 rounded-xl font-bold shadow-sm active:scale-95 flex items-center justify-center">
                <Plus class="size-5" />
              </button>
            </div>

            <div class="flex flex-wrap gap-1.5">
              <button
                v-for="preset in modPresets"
                :key="preset.name"
                @click="applyNoteModPreset(preset.name, preset.price)"
                class="px-2.5 py-1.5 bg-purple-50 border border-purple-200 text-purple-700 rounded-lg text-[10px] md:text-xs font-bold hover:bg-purple-100 active:scale-95 transition-all"
              >
                {{ preset.label }}
              </button>
            </div>
          </div>

          <!-- Kitchen notes section -->
          <div class="pt-4 border-t border-gray-100">
            <p class="text-xs font-bold text-gray-500 uppercase tracking-widest mb-2 flex items-center gap-1.5">
              <MessageSquareWarning class="size-3.5" /> Note Cucina
            </p>

            <div v-if="noteModal.notesArray.length > 0" class="mb-3 space-y-1.5 max-h-[120px] overflow-y-auto border border-gray-100 p-2 rounded-xl bg-gray-50">
              <div
                v-for="(nota, idx) in noteModal.notesArray"
                :key="idx"
                class="flex justify-between items-center bg-white border border-gray-200 text-gray-700 px-3 py-2 rounded-lg text-xs font-bold shadow-sm"
              >
                <span>{{ nota }}</span>
                <button @click="removeNoteFromModal(idx)" class="text-red-500 p-1 hover:bg-red-50 rounded-md transition-colors">
                  <Trash2 class="size-4" />
                </button>
              </div>
            </div>

            <div class="flex gap-2">
              <input
                ref="noteInput"
                v-model="noteModal.inputText"
                type="text"
                placeholder="Scrivi una nota rapida..."
                class="w-full bg-gray-100 border border-gray-200 rounded-xl px-3 md:px-4 py-3 focus:bg-white theme-ring transition-all text-gray-800 font-medium text-sm"
                @keyup.enter="addNoteToModal"
              />
              <button @click="addNoteToModal" aria-label="Aggiungi nota" class="theme-bg text-white px-4 rounded-xl font-bold shadow-sm active:scale-95 flex items-center justify-center">
                <Plus class="size-5" />
              </button>
            </div>

            <div class="flex flex-wrap gap-1.5 mt-3">
              <button @click="noteModal.inputText = 'Senza sale'; addNoteToModal()" class="px-2.5 py-1.5 bg-gray-100 border border-gray-200 hover:bg-gray-200 rounded-lg text-[10px] md:text-xs font-bold text-gray-600 transition-colors active:scale-95">Senza sale</button>
              <button @click="noteModal.inputText = 'Ben cotto'; addNoteToModal()" class="px-2.5 py-1.5 bg-gray-100 border border-gray-200 hover:bg-gray-200 rounded-lg text-[10px] md:text-xs font-bold text-gray-600 transition-colors active:scale-95">Ben cotto</button>
              <button @click="noteModal.inputText = 'No formaggio'; addNoteToModal()" class="px-2.5 py-1.5 bg-gray-100 border border-gray-200 hover:bg-gray-200 rounded-lg text-[10px] md:text-xs font-bold text-gray-600 transition-colors active:scale-95">No formaggio</button>
              <button @click="noteModal.inputText = 'Da dividere'; addNoteToModal()" class="px-2.5 py-1.5 bg-gray-100 border border-gray-200 hover:bg-gray-200 rounded-lg text-[10px] md:text-xs font-bold text-gray-600 transition-colors active:scale-95">Da dividere</button>
            </div>
          </div>
        </div>

        <!-- Fixed footer with save button -->
        <div class="p-3 md:p-4 bg-gray-50 pb-8 md:pb-4 border-t border-gray-200 shrink-0">
          <button @click="saveNotes" class="w-full theme-bg text-white py-3 md:py-3.5 rounded-xl font-bold shadow-md hover:opacity-90 transition-opacity active:scale-95 text-sm md:text-base">
            Salva Note, Varianti e Uscita
          </button>
        </div>
      </div>
    </div>

    <!-- ============================================================ -->
    <!-- REJECT CONFIRMATION MODAL                                    -->
    <!-- ============================================================ -->
    <div v-if="showRejectConfirm" class="fixed inset-0 z-[80] bg-black/60 backdrop-blur-sm flex items-center justify-center p-4">
      <div class="bg-white rounded-3xl shadow-2xl w-full max-w-sm p-6 max-h-[90dvh] overflow-y-auto">
        <div class="text-center mb-4">
          <div class="size-16 bg-red-100 rounded-full flex items-center justify-center mx-auto mb-3">
            <Trash2 class="size-8 text-red-600" />
          </div>
          <h3 class="text-lg font-black text-gray-800">Rifiuta Comanda?</h3>
          <p class="text-sm text-gray-500 mt-1">Sei sicuro di voler rifiutare questa comanda?</p>
        </div>
        <div class="mb-4">
          <p class="text-xs font-bold text-gray-600 uppercase tracking-widest mb-2">Causale rifiuto <span class="text-gray-400 font-normal normal-case">(opzionale)</span></p>
          <div class="flex flex-col gap-2">
            <label v-for="reason in rejectReasons" :key="reason.value" class="flex items-center gap-2 cursor-pointer p-2.5 rounded-xl border transition-all" :class="rejectReason === reason.value ? 'border-red-400 bg-red-50' : 'border-gray-200 hover:bg-gray-50'">
              <input type="radio" :value="reason.value" v-model="rejectReason" class="accent-red-500" />
              <span class="text-sm font-medium text-gray-700">{{ reason.label }}</span>
            </label>
          </div>
          <textarea v-if="rejectReason === 'altro'" v-model="rejectOtherText" rows="2" placeholder="Descrivi la causale…" class="mt-2 w-full border border-gray-200 rounded-xl p-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-red-300 resize-none" />
        </div>
        <div class="flex gap-3">
          <button
            @click="cancelDeleteOrder"
            class="flex-1 py-3 rounded-xl border border-gray-200 font-bold text-gray-600 hover:bg-gray-50 active:scale-95 transition-all"
          >
            Annulla
          </button>
          <button
            @click="confirmDeleteOrder"
            :disabled="rejectReason === 'altro' && !rejectOtherText.trim()"
            class="flex-[2] py-3 rounded-xl bg-red-600 text-white font-bold shadow-md hover:bg-red-700 active:scale-95 transition-all flex items-center justify-center gap-2 disabled:opacity-50 disabled:cursor-not-allowed"
          >
            <Trash2 class="size-5" /> Rifiuta
          </button>
        </div>
      </div>
    </div>

    <!-- ============================================================ -->
    <!-- SUBMIT CONFIRMATION MODAL                                    -->
    <!-- ============================================================ -->
    <div v-if="showSubmitConfirm" class="fixed inset-0 z-[80] bg-black/60 backdrop-blur-sm flex items-center justify-center p-4">
      <div class="bg-white rounded-3xl shadow-2xl w-full max-w-sm p-6 max-h-[90dvh] overflow-y-auto">
        <div class="text-center mb-4">
          <div class="size-16 theme-bg rounded-full flex items-center justify-center mx-auto mb-3 shadow-md">
            <Send class="size-8 text-white" />
          </div>
          <h3 class="text-lg font-black text-gray-800">Invia Comanda?</h3>
          <p class="text-sm text-gray-500 mt-1">
            Tavolo {{ orderToSubmit?.table }} · {{ orderToSubmit?.itemCount }} pz
          </p>
        </div>
        <div class="flex gap-3">
          <button
            @click="showSubmitConfirm = false; orderToSubmit = null"
            class="flex-1 py-3 rounded-xl border border-gray-200 font-bold text-gray-600 hover:bg-gray-50 active:scale-95 transition-all"
          >
            Annulla
          </button>
          <button
            @click="confirmSubmitOrder"
            class="flex-[2] py-3 rounded-xl theme-bg text-white font-bold shadow-md hover:opacity-90 active:scale-95 transition-all flex items-center justify-center gap-2"
          >
            <Send class="size-5" /> Invia
          </button>
        </div>
      </div>
    </div>

  </div>
</template>

<script setup>
import { ref, computed, nextTick, watch } from 'vue';
import {
  Bell, ClipboardList, ChefHat, Clock, Hash, MousePointerClick, ArrowLeft,
  AlertTriangle, Trash2, PlusCircle, Send, ShieldCheck, Minus, Plus,
  MessageSquareWarning, PenLine, X, BookOpen, ShoppingCart, Sparkles,
  Layers, CheckCircle, CheckCircle2, History, LayoutGrid, ChevronRight, Info, Flame, BellRing,
} from 'lucide-vue-next';
import { useConfigStore, useOrderStore } from '../store/index.js';
import {
  updateOrderTotals,
  KITCHEN_ACTIVE_STATUSES,
  KITCHEN_STATUS_PRIORITY,
  DEFAULT_COURSE,
  getCourseBorderClass,
  formatOrderIdShort,
} from '../utils/index.js';
import { enqueuePrintJobs } from '../composables/usePrintQueue.js';
import OrderSidebarCard from './shared/OrderSidebarCard.vue';
import OrderItemsList from './shared/OrderItemsList.vue';
import GlobalOrderNoteModal from './shared/GlobalOrderNoteModal.vue';
import DishInfoModal from './shared/DishInfoModal.vue';

const emit = defineEmits(['jump-to-sala']);

const configStore = useConfigStore();
const orderStore = useOrderStore();

// ── Tab & selection ────────────────────────────────────────────────────────
const activeTab = ref('pending');
const selectedOrder = ref(null);

const filteredOrders = computed(() => {
  if (activeTab.value === 'history')
    return orderStore.orders
      .filter(o => (o.status === 'completed' || o.status === 'rejected') && !o.isDirectEntry)
      .sort((a, b) => b.time.localeCompare(a.time));
  if (activeTab.value === 'accepted')
    return orderStore.orders
      .filter(o => KITCHEN_ACTIVE_STATUSES.includes(o.status) && !o.isDirectEntry)
      .sort((a, b) => {
        const pa = KITCHEN_STATUS_PRIORITY[a.status] ?? 4;
        const pb = KITCHEN_STATUS_PRIORITY[b.status] ?? 4;
        if (pa !== pb) return pa - pb;
        return b.time.localeCompare(a.time);
      });
  return orderStore.orders
    .filter(o => o.status === activeTab.value && !o.isDirectEntry)
    .sort((a, b) => a.time.localeCompare(b.time)); // oldest first → most urgent on top
});

const orderStatusCounts = computed(() =>
  orderStore.orders.reduce(
    (acc, o) => {
      if (o.isDirectEntry) return acc;
      // Badge counts only active kitchen orders (not delivered — those are already handled)
      if (['accepted', 'preparing', 'ready'].includes(o.status)) acc.accepted += 1;
      if (o.status === 'completed' || o.status === 'rejected') acc.history += 1;
      return acc;
    },
    { accepted: 0, history: 0 },
  ),
);

const acceptedCount = computed(() => orderStatusCounts.value.accepted);
const historyCount = computed(() => orderStatusCounts.value.history);

function changeTab(tab) {
  activeTab.value = tab;
  selectedOrder.value = null;
}

function selectOrder(ord) {
  selectedOrder.value = ord;
}

watch(
  () => orderStore.orders,
  (nextOrders) => {
    const currentId = selectedOrder.value?.id;
    if (!currentId) return;
    const refreshed = nextOrders.find(o => String(o.id) === String(currentId)) || null;
    selectedOrder.value = refreshed;
  },
);

async function markDelivered(order) {
  await orderStore.changeOrderStatus(order, 'delivered');

}

// ── Helper: unit price for an item including modifiers ────────────────────
function getItemUnitPrice(item) {
  const modTotal = (item.modifiers || []).reduce((a, m) => a + (m.price || 0), 0);
  return item.unitPrice + modTotal;
}

// ── Note modal ─────────────────────────────────────────────────────────────
const noteInput = ref(null);
const noteModalCloseBtn = ref(null);
const noteModal = ref({
  show: false, inputText: '', notesArray: [],
  rowIndex: null, targetOrd: null, itemRef: null,
  modifiersArray: [], modName: '', modPrice: '',
  course: DEFAULT_COURSE, cartIdx: null,
});

// ── Global note modal ───────────────────────────────────────────────────────
const globalNoteModal = ref({ show: false });
function openGlobalNoteModal() {
  globalNoteModal.value.show = true;
}

// ── Info modal ─────────────────────────────────────────────────────────────
const infoModal = ref({ show: false, item: null });

function showItemInfo(item) {
  infoModal.value = { show: true, item };
}

function infoModalAddQuick() {
  const item = infoModal.value.item;
  infoModal.value.show = false;
  addToTempCart(item);
}

function infoModalAddWithDetails() {
  const item = infoModal.value.item;
  infoModal.value.show = false;
  addToTempCartWithModal(item);
}

function openNoteModal(ord, idx) {
  if (!ord || ord.status !== 'pending') return;
  noteModal.value.targetOrd = ord;
  noteModal.value.rowIndex = idx;
  noteModal.value.cartIdx = null;
  noteModal.value.itemRef = ord.orderItems[idx];
  const existing = ord.orderItems[idx].notes;
  noteModal.value.notesArray = Array.isArray(existing) ? [...existing] : [];
  const existingMods = ord.orderItems[idx].modifiers;
  noteModal.value.modifiersArray = Array.isArray(existingMods) ? existingMods.map(m => ({ ...m })) : [];
  noteModal.value.course = ord.orderItems[idx].course || DEFAULT_COURSE;
  noteModal.value.inputText = '';
  noteModal.value.modName = '';
  noteModal.value.modPrice = '';
  noteModal.value.show = true;
  nextTick(() => noteModalCloseBtn.value?.focus());
}

function openCartNoteModal(idx) {
  const cartItem = tempCart.value[idx];
  if (!cartItem) return;
  noteModal.value.targetOrd = null;
  noteModal.value.rowIndex = null;
  noteModal.value.cartIdx = idx;
  noteModal.value.itemRef = cartItem;
  noteModal.value.notesArray = Array.isArray(cartItem.notes) ? [...cartItem.notes] : [];
  noteModal.value.modifiersArray = Array.isArray(cartItem.modifiers) ? cartItem.modifiers.map(m => ({ ...m })) : [];
  noteModal.value.course = cartItem.course || DEFAULT_COURSE;
  noteModal.value.inputText = '';
  noteModal.value.modName = '';
  noteModal.value.modPrice = '';
  noteModal.value.show = true;
  nextTick(() => noteModalCloseBtn.value?.focus());
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

function addModToNoteModal() {
  const name = noteModal.value.modName.trim();
  if (!name) return;
  noteModal.value.modifiersArray.push({ name, price: parseFloat(String(noteModal.value.modPrice).replace(/,/g, '.')) || 0 });
  noteModal.value.modName = '';
  noteModal.value.modPrice = '';
}

function applyNoteModPreset(name, price) {
  noteModal.value.modName = name;
  noteModal.value.modPrice = price;
  addModToNoteModal();
}

function removeModFromNoteModal(idx) {
  noteModal.value.modifiersArray.splice(idx, 1);
}

function onModPriceInput(event) {
  const raw = event.target.value;
  const normalized = raw.replace(/,/g, '.');
  if (normalized !== raw) event.target.value = normalized;
  noteModal.value.modPrice = normalized;
}

function saveNotes() {
  if (noteModal.value.cartIdx !== null) {
    const cartItem = tempCart.value[noteModal.value.cartIdx];
    if (cartItem) {
      cartItem.notes = [...noteModal.value.notesArray];
      cartItem.modifiers = noteModal.value.modifiersArray.map(m => ({ ...m }));
      cartItem.course = noteModal.value.course;
    }
  } else if (noteModal.value.rowIndex !== null && noteModal.value.targetOrd) {
    const item = noteModal.value.targetOrd.orderItems[noteModal.value.rowIndex];
    item.notes = [...noteModal.value.notesArray];
    item.modifiers = noteModal.value.modifiersArray.map(m => ({ ...m }));
    item.course = noteModal.value.course;
    updateOrderTotals(noteModal.value.targetOrd);
  }
  noteModal.value.show = false;
}

// ── Modifier presets ───────────────────────────────────────────────────────
const modPresets = computed(() => {
  const c = configStore.config.ui.currency;
  return [
    { name: 'Mozzarella',     price: 1.50, label: `+ Mozzarella ${c}1.50` },
    { name: 'Parmigiano',     price: 1.00, label: `+ Parmigiano ${c}1.00` },
    { name: 'Senza glutine',  price: 0,    label: 'Senza glutine' },
    { name: 'Porzione extra', price: 2.00, label: `+ Porzione extra ${c}2.00` },
  ];
});

// ── Add menu modal ─────────────────────────────────────────────────────────
const showAddMenuModal = ref(false);
const targetOrderForMenu = ref(null);
const tempCart = ref([]);
const activeMenuCategory = ref(Object.keys(configStore.config.menu)[0] || '');

function removeModFromCart(cartIdx, modIdx) {
  const cartItem = tempCart.value[cartIdx];
  if (cartItem && cartItem.modifiers) cartItem.modifiers.splice(modIdx, 1);
}

const tempCartTotal = computed(() =>
  tempCart.value.reduce((a, b) => {
    const modTotal = (b.modifiers || []).reduce((ma, m) => ma + (m.price || 0), 0);
    return a + (b.unitPrice + modTotal) * b.quantity;
  }, 0),
);

const orderQtyMap = computed(() => {
  const map = new Map();
  if (targetOrderForMenu.value) {
    for (const r of targetOrderForMenu.value.orderItems) {
      map.set(r.dishId, (map.get(r.dishId) || 0) + (r.quantity - (r.voidedQuantity || 0)));
    }
  }
  return map;
});

const cartQtyMap = computed(() => {
  const map = new Map();
  for (const r of tempCart.value) {
    map.set(r.dishId, (map.get(r.dishId) || 0) + r.quantity);
  }
  return map;
});

function getQtyCombined(itemId) {
  return (orderQtyMap.value.get(itemId) || 0) + (cartQtyMap.value.get(itemId) || 0);
}

function itemsAreMergeable(a, b) {
  if (a.dishId !== b.dishId) return false;
  if ((a.course || DEFAULT_COURSE) !== (b.course || DEFAULT_COURSE)) return false;
  const notesA = [...(a.notes || [])].sort();
  const notesB = [...(b.notes || [])].sort();
  if (notesA.length !== notesB.length || notesA.some((n, i) => n !== notesB[i])) return false;
  const normMod = m => ({ name: String(m.name), price: Number(m.price) || 0 });
  const modsA = [...(a.modifiers || [])].map(normMod).sort((x, y) => x.name < y.name ? -1 : x.name > y.name ? 1 : x.price - y.price);
  const modsB = [...(b.modifiers || [])].map(normMod).sort((x, y) => x.name < y.name ? -1 : x.name > y.name ? 1 : x.price - y.price);
  if (modsA.length !== modsB.length) return false;
  return modsA.every((m, i) => m.name === modsB[i].name && m.price === modsB[i].price);
}

function makeTempCartRow(item) {
  return {
    uid: 'tmp_' + Math.random().toString(36).slice(2, 11),
    dishId: item.id,
    name: item.name,
    unitPrice: item.price,
    quantity: 1,
    notes: [],
    voidedQuantity: 0,
    modifiers: [],
    course: DEFAULT_COURSE,
  };
}

function addToTempCart(item) {
  const blank = { dishId: item.id, notes: [], modifiers: [], course: DEFAULT_COURSE };
  const existing = tempCart.value.find(r => itemsAreMergeable(r, blank));
  if (existing) { existing.quantity++; return; }
  tempCart.value.push(makeTempCartRow(item));
}

function updateTempCartQty(idx, delta) {
  tempCart.value[idx].quantity += delta;
  if (tempCart.value[idx].quantity <= 0) tempCart.value.splice(idx, 1);
}

function addToTempCartWithModal(item) {
  tempCart.value.push(makeTempCartRow(item));
  openCartNoteModal(tempCart.value.length - 1);
}

function openAddMenu(targetOrder) {
  targetOrderForMenu.value = targetOrder;

  // Ensure activeMenuCategory is valid for the current menu before showing modal
  const menu = (configStore.config && configStore.config.menu) ? configStore.config.menu : {};
  const categoryKeys = Object.keys(menu);
  if (categoryKeys.length === 0) {
    // No categories available; clear any previously selected category
    if (activeMenuCategory && activeMenuCategory.value !== null) {
      activeMenuCategory.value = null;
    }
  } else {
    const currentKey = activeMenuCategory ? activeMenuCategory.value : null;
    if (!currentKey || !Object.prototype.hasOwnProperty.call(menu, currentKey)) {
      // Previously selected category is missing or invalid; select the first available one
      if (activeMenuCategory) {
        activeMenuCategory.value = categoryKeys[0];
      }
    }
  }
  tempCart.value = [];
  showAddMenuModal.value = true;
}

function closeMenuModal() {
  showAddMenuModal.value = false;
  targetOrderForMenu.value = null;
  tempCart.value = [];
}

async function confirmAndPushCart() {
  if (!targetOrderForMenu.value || tempCart.value.length === 0) return;
  const ordId = targetOrderForMenu.value.id;
  const cartSnapshot = tempCart.value.map(item => ({ ...item }));
  closeMenuModal();
  activeTab.value = 'pending';
  await orderStore.addItemsToOrder(ordId, cartSnapshot);
  selectedOrder.value = orderStore.orders.find(o => String(o.id) === String(ordId)) || selectedOrder.value;
}

// ── Delete order ────────────────────────────────────────────────────────────
const showRejectConfirm = ref(false);
const orderToReject = ref(null);
const rejectReason = ref('');
const rejectOtherText = ref('');
const rejectReasons = computed(() => configStore.config.orders?.rejectionReasons ?? [
  { value: 'duplicato',        label: 'Ordine duplicato' },
  { value: 'errore_cameriere', label: 'Errore cameriere' },
  { value: 'altro',            label: 'Altro' },
]);

function deleteOrder() {
  if (!selectedOrder.value || selectedOrder.value.status !== 'pending') return;
  orderToReject.value = selectedOrder.value;
  rejectReason.value = '';
  rejectOtherText.value = '';
  showRejectConfirm.value = true;
}

async function confirmDeleteOrder() {
  if (!orderToReject.value) return;
  let reason = null;
  if (rejectReason.value === 'altro') {
    reason = rejectOtherText.value.trim() || null;
  } else if (rejectReason.value) {
    reason = rejectReasons.value.find(r => r.value === rejectReason.value)?.label ?? rejectReason.value;
  }
  await orderStore.changeOrderStatus(orderToReject.value, 'rejected', reason);

  showRejectConfirm.value = false;
  orderToReject.value = null;
  selectedOrder.value = null;
}

function cancelDeleteOrder() {
  showRejectConfirm.value = false;
  orderToReject.value = null;
  rejectReason.value = '';
  rejectOtherText.value = '';
}

// ── Submit order (send to kitchen) ─────────────────────────────────────────
const showSubmitConfirm = ref(false);
const orderToSubmit = ref(null);

function submitOrder() {
  if (!selectedOrder.value || selectedOrder.value.orderItems.length === 0) return;
  orderToSubmit.value = selectedOrder.value;
  showSubmitConfirm.value = true;
}

async function confirmSubmitOrder() {
  if (!orderToSubmit.value) return;
  const ord = orderToSubmit.value;
  // TODO API: replace with POST /api/orders when API is available.
  // For now the order is already in the shared store as 'pending';
  // a real sala terminal would submit it here and receive a server-assigned id.
  showSubmitConfirm.value = false;
  orderToSubmit.value = null;
  // Move the order out of "In Attesa" by marking it as accepted/sent to kitchen.
  await orderStore.changeOrderStatus(ord, 'accepted');
  // Dispatch print jobs to the configured ESC/POS printer(s).
  enqueuePrintJobs(ord);
  // Deselect the order and remain on the pending tab.
  selectedOrder.value = null;
}

// ── Expose for parent (SalaOrderView) ────────────────────────────────────
defineExpose({ openAddMenu, selectedOrder, activeTab, changeTab });
</script>
