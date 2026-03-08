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
            <ClipboardList class="size-4 md:size-5" />
            <span
              v-if="store.pendingCount > 0"
              class="absolute -top-1.5 -right-2 bg-red-500 text-white text-[9px] font-bold size-4 flex items-center justify-center rounded-full border border-white"
            >{{ store.pendingCount }}</span>
          </div>
          <span class="text-[9px] md:text-[10px] uppercase tracking-wider hidden sm:inline">In Attesa</span>
        </button>
        <button
          @click="changeTab('accepted')"
          aria-label="In Cucina"
          :class="activeTab === 'accepted' ? 'bg-blue-100 text-blue-800 border-blue-200 font-bold' : 'bg-white text-gray-500 border-gray-200 hover:bg-gray-100'"
          class="flex-1 py-1.5 md:py-2 px-1 rounded-xl border transition-all flex items-center justify-center gap-1.5 shadow-sm"
        >
          <div class="relative shrink-0">
            <ChefHat class="size-4 md:size-5" />
            <span
              v-if="acceptedCount > 0"
              class="absolute -top-1.5 -right-2 bg-blue-500 text-white text-[9px] font-bold size-4 flex items-center justify-center rounded-full border border-white"
            >{{ acceptedCount }}</span>
          </div>
          <span class="text-[9px] md:text-[10px] uppercase tracking-wider hidden sm:inline">In Cucina</span>
        </button>
      </div>

      <!-- Order list -->
      <div class="flex-1 overflow-y-auto p-2 md:p-3 space-y-2.5 bg-gray-100/50 pb-20 md:pb-3">
        <div v-if="filteredOrders.length === 0" class="h-full flex flex-col items-center justify-center text-gray-400 opacity-60">
          <ClipboardList class="size-12 md:size-16 mb-4" />
          <p class="font-medium text-sm md:text-lg">Nessuna comanda</p>
          <p class="text-xs mt-1">{{ activeTab === 'pending' ? 'Vai su Sala per creare una nuova comanda.' : 'Nessun ordine in cucina al momento.' }}</p>
        </div>

        <transition-group name="list">
          <div
            v-for="order in filteredOrders"
            :key="order.id"
            @click="selectOrder(order)"
            :class="selectedOrder?.id === order.id ? 'ring-2 ring-offset-2 theme-border bg-white' : 'border-gray-200 hover:border-gray-300 bg-white'"
            class="p-3 md:p-4 rounded-2xl border shadow-sm cursor-pointer transition-all active:scale-[0.98]"
          >
            <div class="flex justify-between items-start mb-2">
              <div class="flex items-center gap-3">
                <div class="size-10 rounded-full flex items-center justify-center font-black text-sm md:text-base bg-gray-100 text-gray-800 border-2 border-gray-200 shrink-0">
                  {{ order.table }}
                </div>
                <div>
                  <h3 class="font-bold text-gray-800 text-sm md:text-base leading-tight">Tavolo {{ order.table }}</h3>
                  <p class="text-[10px] text-gray-500 flex items-center gap-1 mt-0.5"><Clock class="size-3" /> {{ order.time }}</p>
                </div>
              </div>
              <div class="text-right">
                <span class="font-black text-base md:text-lg text-gray-800">{{ store.config.ui.currency }}{{ order.totalAmount.toFixed(2) }}</span>
                <p class="text-[10px] text-gray-500">{{ order.itemCount }} pz</p>
              </div>
            </div>

            <div class="flex gap-2 flex-wrap mt-1 items-center">
              <span v-if="order.status === 'pending'" class="bg-amber-100 text-amber-800 text-[9px] md:text-[10px] uppercase font-bold px-2 py-1 rounded-md border border-amber-200 flex items-center gap-1">
                <AlertCircle class="size-3" /> In Attesa
              </span>
              <span v-else-if="order.status === 'accepted'" class="bg-blue-100 text-blue-800 text-[9px] md:text-[10px] uppercase font-bold px-2 py-1 rounded-md border border-blue-200 flex items-center gap-1">
                <ChefHat class="size-3" /> In Cucina
              </span>
              <span v-if="order.orderItems.length > 0" class="text-[9px] text-gray-500 truncate ml-auto">{{ order.orderItems.slice(0, 2).map(i => i.name).join(', ') }}{{ order.orderItems.length > 2 ? '…' : '' }}</span>
            </div>
          </div>
        </transition-group>
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

            <!-- Accepted order: read-only indicator -->
            <template v-else-if="selectedOrder.status === 'accepted'">
              <span class="w-full sm:w-auto text-center px-4 py-2.5 md:py-3 bg-blue-50 text-blue-700 border border-blue-200 rounded-xl font-bold flex items-center justify-center gap-2">
                <ChefHat class="size-5" />
                <span class="text-xs md:text-sm">In Cucina</span>
              </span>
            </template>
          </div>
        </div>

        <!-- Items list -->
        <div class="flex-1 overflow-y-auto bg-gray-100 p-2 md:p-4 min-h-0">

          <!-- Accepted: read-only notice -->
          <div v-if="selectedOrder.status === 'accepted'" class="mb-3 bg-blue-100 border border-blue-200 text-blue-800 p-3 rounded-xl text-[10px] md:text-xs font-bold flex items-center gap-2 shadow-sm">
            <ShieldCheck class="size-4 md:size-5 shrink-0" />
            Comanda già inviata in cucina — sola lettura.
          </div>

          <!-- Empty order hint -->
          <div v-if="selectedOrder.orderItems.length === 0" class="text-center py-10 text-gray-400">
            <ShoppingCart class="size-10 mx-auto mb-2 opacity-30" />
            <p class="text-sm font-medium">Nessun piatto aggiunto.</p>
            <button
              v-if="selectedOrder.status === 'pending'"
              @click="openAddMenu(selectedOrder)"
              class="mt-3 inline-flex items-center gap-1.5 text-xs font-bold theme-text hover:underline"
            >
              <PlusCircle class="size-4" /> Aggiungi dal menù
            </button>
          </div>

          <!-- Items card -->
          <div v-else class="bg-white rounded-2xl shadow-sm border border-gray-200 overflow-hidden">
            <div class="divide-y divide-gray-100">
              <template v-for="row in orderedOrderItems" :key="row.type === 'header' ? 'header_' + row.course : row.item?.uid">
                <!-- Course group header -->
                <div
                  v-if="row.type === 'header'"
                  class="px-3 py-1.5 flex items-center gap-1.5 text-[10px] font-black uppercase tracking-widest"
                  :class="{
                    'bg-orange-50 text-orange-700': row.course === 'prima',
                    'bg-gray-50 text-gray-500': row.course === 'insieme',
                    'bg-teal-50 text-teal-700': row.course === 'dopo',
                  }"
                >
                  <Layers class="size-3 shrink-0" />
                  {{ row.course === 'prima' ? '1 – Esce Prima' : row.course === 'insieme' ? '2 – Insieme' : '3 – Esce Dopo' }}
                </div>

                <!-- Item row -->
                <div v-else class="p-2 md:p-3 hover:bg-gray-50 transition-colors">
                  <div class="flex items-center justify-between gap-2 md:gap-4">
                    <div class="flex items-center gap-2 md:gap-3 flex-1 min-w-0">

                      <!-- +/- controls (pending only) -->
                      <div v-if="selectedOrder.status === 'pending'" class="flex items-center gap-1 bg-gray-100 rounded-md p-0.5 border border-gray-200 shrink-0">
                        <button
                          @click="store.updateQtyGlobal(selectedOrder, row.index, -1)"
                          class="size-6 md:size-7 flex items-center justify-center bg-white rounded shadow-sm active:scale-95 transition-colors"
                          :class="row.item.quantity === 1 ? 'text-red-500' : 'text-gray-600'"
                          :title="row.item.quantity === 1 ? 'Rimuovi voce' : 'Diminuisci quantità'"
                        >
                          <Trash2 v-if="row.item.quantity === 1" class="size-3" />
                          <Minus v-else class="size-3" />
                        </button>
                        <span class="w-5 md:w-6 text-center font-black text-xs md:text-sm text-gray-800">{{ row.item.quantity }}</span>
                        <button @click="store.updateQtyGlobal(selectedOrder, row.index, 1)" class="size-6 md:size-7 flex items-center justify-center bg-white theme-text rounded shadow-sm active:scale-95">
                          <Plus class="size-3" />
                        </button>
                      </div>

                      <!-- Read-only quantity (accepted) -->
                      <div v-else class="w-8 shrink-0 text-center font-black text-sm md:text-base text-gray-700">
                        {{ row.item.quantity - (row.item.voidedQuantity || 0) }}x
                      </div>

                      <!-- Item info -->
                      <div class="flex flex-col min-w-0 flex-1">
                        <span class="font-bold text-sm md:text-base text-gray-800 leading-tight truncate">{{ row.item.name }}</span>
                        <div v-if="row.item.notes && row.item.notes.length > 0" class="text-[10px] md:text-xs text-amber-600 font-bold italic mt-0.5 truncate flex items-center gap-1">
                          <MessageSquareWarning class="size-3 shrink-0" /> {{ row.item.notes.join(', ') }}
                        </div>
                        <div v-if="row.item.modifiers && row.item.modifiers.length > 0" class="mt-0.5 flex flex-wrap gap-1">
                          <span
                            v-for="(mod, mi) in row.item.modifiers"
                            :key="mi"
                            class="text-[9px] md:text-[10px] font-bold bg-purple-50 border border-purple-200 text-purple-700 px-1.5 py-0.5 rounded flex items-center gap-0.5"
                          >
                            <Sparkles class="size-2.5" />
                            {{ mod.name }}{{ mod.price > 0 ? ' +' + store.config.ui.currency + mod.price.toFixed(2) : '' }}
                          </span>
                        </div>
                      </div>
                    </div>

                    <!-- Price + note button -->
                    <div class="flex items-center gap-1.5 md:gap-2 shrink-0">
                      <span class="font-black text-sm md:text-base text-gray-800">
                        {{ store.config.ui.currency }}{{ getOrderItemRowTotal(row.item).toFixed(2) }}
                      </span>
                      <button
                        v-if="selectedOrder.status === 'pending'"
                        @click="openNoteModal(selectedOrder, row.index)"
                        class="p-1.5 text-gray-500 hover:text-[var(--brand-primary)] bg-gray-50 border border-gray-200 hover:bg-gray-100 rounded-md transition-colors active:scale-95 shadow-sm"
                        title="Note e Portata"
                      >
                        <PenLine class="size-3.5" />
                      </button>
                    </div>
                  </div>
                </div>
              </template>
            </div>
          </div>

          <!-- Order total (pending only) -->
          <div v-if="selectedOrder.status === 'pending' && selectedOrder.orderItems.length > 0" class="mt-3 bg-white rounded-xl border border-gray-200 shadow-sm p-3 flex justify-between items-center">
            <span class="text-sm font-bold text-gray-600">Totale Comanda</span>
            <span class="text-lg font-black text-gray-900">{{ store.config.ui.currency }}{{ selectedOrder.totalAmount.toFixed(2) }}</span>
          </div>

          <!-- Invia Comanda footer (pending with items) -->
          <div v-if="selectedOrder.status === 'pending' && selectedOrder.orderItems.length > 0" class="mt-3">
            <button
              @click="submitOrder"
              class="w-full py-3.5 theme-bg text-white rounded-xl font-bold shadow-md hover:opacity-90 active:scale-95 transition-all flex items-center justify-center gap-2"
            >
              <Send class="size-5" /> Invia Comanda in Cucina
            </button>
          </div>

        </div>
      </div>
    </main>

    <!-- ============================================================ -->
    <!-- ADD MENU PANEL (full-height overlay)                         -->
    <!-- ============================================================ -->
    <div v-if="showAddMenuModal" class="absolute inset-0 z-30 bg-white flex flex-col">

      <!-- Menu panel header -->
      <div class="bg-gray-900 text-white p-3 md:p-4 flex justify-between items-center shrink-0">
        <div class="flex items-center gap-2">
          <BookOpen class="size-5 md:size-6" />
          <div>
            <p class="font-bold text-sm md:text-base leading-none">Aggiungi Piatti</p>
            <p class="text-white/60 text-[10px] md:text-xs">Tavolo {{ targetOrderForMenu?.table }}</p>
          </div>
        </div>
        <button @click="closeMenuModal" class="bg-white/10 hover:bg-white/20 p-2 rounded-full transition-colors active:scale-95">
          <X class="size-5 md:size-6" />
        </button>
      </div>

      <!-- Category tabs -->
      <div class="flex overflow-x-auto gap-1.5 p-2 bg-gray-50 border-b border-gray-200 shrink-0 no-scrollbar">
        <button
          v-for="cat in menuCategories"
          :key="cat"
          @click="activeMenuCategory = cat"
          :class="activeMenuCategory === cat ? 'theme-bg text-white shadow-md' : 'bg-white text-gray-600 hover:bg-gray-100 border border-gray-200'"
          class="px-3 py-1.5 rounded-xl font-bold text-[10px] md:text-xs whitespace-nowrap transition-all active:scale-95 shrink-0"
        >
          {{ cat }}
        </button>
      </div>

      <!-- Main content: menu items + cart -->
      <div class="flex-1 flex overflow-hidden min-h-0">

        <!-- Menu items grid -->
        <div class="flex-1 overflow-y-auto p-2 md:p-3 bg-gray-100/60">
          <div v-if="menuLoading" class="flex items-center justify-center h-full text-gray-400">
            <div class="text-center">
              <RefreshCw class="size-8 mx-auto mb-2 animate-spin opacity-40" />
              <p class="text-sm">Caricamento menù…</p>
            </div>
          </div>
          <div v-else-if="currentMenuItems.length === 0" class="text-center py-8 text-gray-400">
            <p class="text-sm">Nessun articolo in questa categoria.</p>
          </div>
          <div v-else class="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-2 md:gap-3">
            <button
              v-for="item in currentMenuItems"
              :key="item.id"
              @click="addToTempCart(item)"
              class="bg-white rounded-xl border border-gray-200 p-2.5 md:p-3 text-left hover:border-[var(--brand-primary)] hover:shadow-md active:scale-95 transition-all flex flex-col gap-1 relative group"
            >
              <!-- Quantity badge -->
              <span v-if="getQtyCombined(item.id) > 0" class="absolute top-2 right-2 size-5 theme-bg text-white text-[9px] font-black rounded-full flex items-center justify-center shadow-sm">
                {{ getQtyCombined(item.id) }}
              </span>
              <span class="font-bold text-xs md:text-sm text-gray-800 leading-tight pr-5">{{ item.name }}</span>
              <span class="text-[10px] font-black theme-text mt-auto">{{ store.config.ui.currency }}{{ item.price.toFixed(2) }}</span>
            </button>
          </div>
        </div>

        <!-- Cart sidebar -->
        <div class="w-[180px] md:w-[220px] bg-white border-l border-gray-200 flex flex-col shrink-0">
          <div class="p-2 md:p-3 border-b border-gray-100 shrink-0">
            <p class="font-bold text-[10px] md:text-xs text-gray-500 uppercase tracking-widest flex items-center gap-1">
              <ShoppingCart class="size-3.5" /> Carrello ({{ tempCart.length }})
            </p>
          </div>

          <div class="flex-1 overflow-y-auto p-1.5 md:p-2 space-y-1.5 min-h-0">
            <div v-if="tempCart.length === 0" class="text-center py-6 text-gray-400">
              <p class="text-[10px]">Aggiungi piatti dal menù</p>
            </div>

            <div v-for="(cartItem, idx) in tempCart" :key="cartItem.uid" class="bg-gray-50 rounded-lg border border-gray-200 p-1.5 md:p-2">
              <div class="flex items-start justify-between gap-1 mb-1">
                <span class="text-[10px] md:text-xs font-bold text-gray-800 leading-tight">{{ cartItem.name }}</span>
                <!-- Course badge -->
                <button
                  @click="cycleCourse(idx)"
                  :class="courseButtonProps(cartItem.course).classes"
                  class="size-5 flex items-center justify-center rounded shadow-sm active:scale-95 font-black text-[10px] transition-colors shrink-0"
                  :title="courseButtonProps(cartItem.course).title"
                >
                  {{ courseButtonProps(cartItem.course).num }}
                </button>
              </div>
              <!-- Cart +/- -->
              <div class="flex items-center justify-between gap-1">
                <div class="flex items-center gap-0.5 bg-white rounded border border-gray-200">
                  <button
                    @click="updateTempCartQty(idx, -1)"
                    class="size-5 flex items-center justify-center rounded active:scale-95"
                    :class="cartItem.quantity === 1 ? 'text-red-500' : 'text-gray-600'"
                  >
                    <Trash2 v-if="cartItem.quantity === 1" class="size-2.5" />
                    <Minus v-else class="size-2.5" />
                  </button>
                  <span class="w-4 text-center font-black text-[11px] text-gray-800">{{ cartItem.quantity }}</span>
                  <button @click="updateTempCartQty(idx, 1)" class="size-5 flex items-center justify-center rounded active:scale-95 theme-text">
                    <Plus class="size-2.5" />
                  </button>
                </div>
                <button @click="openCartNoteModal(idx)" class="p-1 text-gray-400 hover:text-[var(--brand-primary)] transition-colors" title="Note">
                  <PenLine class="size-3" />
                </button>
              </div>
              <!-- Modifiers -->
              <div v-if="cartItem.modifiers && cartItem.modifiers.length > 0" class="mt-1 flex flex-wrap gap-0.5">
                <span
                  v-for="(mod, mi) in cartItem.modifiers"
                  :key="mi"
                  class="text-[8px] font-bold bg-purple-50 border border-purple-200 text-purple-700 px-1 py-0.5 rounded flex items-center gap-0.5"
                >
                  <Sparkles class="size-2" />{{ mod.name }}
                  <button @click="removeModFromCart(idx, mi)" class="text-purple-400 hover:text-red-500"><X class="size-2" /></button>
                </span>
              </div>
            </div>
          </div>

          <!-- Confirm cart -->
          <div class="p-2 md:p-3 border-t border-gray-200 shrink-0">
            <div class="flex justify-between items-center mb-2">
              <span class="text-[9px] font-bold text-gray-500 uppercase tracking-widest">Totale:</span>
              <span class="font-black text-sm text-gray-900">{{ store.config.ui.currency }}{{ tempCartTotal.toFixed(2) }}</span>
            </div>
            <button
              @click="confirmAndPushCart"
              :disabled="tempCart.length === 0"
              class="w-full theme-bg text-white py-2.5 rounded-xl font-bold shadow-md hover:opacity-90 transition-opacity active:scale-95 text-xs flex items-center justify-center gap-1.5 disabled:opacity-50 disabled:cursor-not-allowed"
            >
              <CheckCircle class="size-4" /> Inserisci
            </button>
          </div>
        </div>
      </div>
    </div>

    <!-- ============================================================ -->
    <!-- NOTE + COURSE MODAL                                          -->
    <!-- ============================================================ -->
    <div v-if="noteModal.show" class="fixed inset-0 z-[80] bg-black/60 backdrop-blur-sm flex items-end md:items-center justify-center p-0 md:p-4">
      <div class="bg-white rounded-t-3xl md:rounded-3xl shadow-2xl w-full max-w-lg p-5 md:p-6 flex flex-col gap-4 max-h-[85dvh] overflow-y-auto">

        <div class="flex justify-between items-center shrink-0">
          <h4 class="font-black text-gray-800 text-base">Note & Portata</h4>
          <button @click="noteModal.show = false" class="p-1.5 rounded-full bg-gray-100 hover:bg-gray-200 text-gray-600 active:scale-95">
            <X class="size-5" />
          </button>
        </div>

        <!-- Course selector -->
        <div>
          <p class="text-[10px] font-bold uppercase text-gray-500 tracking-widest mb-2">Portata</p>
          <div class="flex gap-2">
            <button
              v-for="c in ['prima', 'insieme', 'dopo']"
              :key="c"
              @click="noteModal.course = c"
              :class="noteModal.course === c ? courseButtonProps(c).classes + ' ring-2 ring-offset-1 ring-current' : 'bg-gray-100 text-gray-500 hover:bg-gray-200'"
              class="flex-1 py-2 rounded-xl font-bold text-xs transition-all active:scale-95"
            >
              {{ c === 'prima' ? '1 · Prima' : c === 'insieme' ? '2 · Insieme' : '3 · Dopo' }}
            </button>
          </div>
        </div>

        <!-- Notes -->
        <div>
          <p class="text-[10px] font-bold uppercase text-gray-500 tracking-widest mb-2">Note Aggiuntive</p>
          <div class="flex gap-2 mb-2">
            <input
              ref="noteInput"
              v-model="noteModal.inputText"
              @keydown.enter.prevent="addNoteToModal"
              type="text"
              placeholder="es. senza cipolla…"
              class="flex-1 border border-gray-200 rounded-xl px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-[var(--brand-primary)]"
            />
            <button @click="addNoteToModal" class="theme-bg text-white px-3 py-2 rounded-xl font-bold text-sm active:scale-95 shadow-sm">
              <Plus class="size-4" />
            </button>
          </div>
          <div v-if="noteModal.notesArray.length > 0" class="flex flex-wrap gap-1.5">
            <span
              v-for="(note, ni) in noteModal.notesArray"
              :key="ni"
              class="bg-amber-100 border border-amber-200 text-amber-800 text-xs font-bold px-2 py-1 rounded-full flex items-center gap-1"
            >
              {{ note }}
              <button @click="removeNoteFromModal(ni)" class="text-amber-600 hover:text-red-500"><X class="size-3" /></button>
            </span>
          </div>
        </div>

        <!-- Modifiers (variants) -->
        <div v-if="store.config.ui.allowCustomVariants">
          <p class="text-[10px] font-bold uppercase text-gray-500 tracking-widest mb-2">Varianti</p>
          <!-- Presets -->
          <div class="flex flex-wrap gap-1.5 mb-2">
            <button
              v-for="preset in modPresets"
              :key="preset.name"
              @click="applyNoteModPreset(preset.name, preset.price)"
              class="text-[10px] font-bold border border-purple-200 text-purple-700 bg-purple-50 hover:bg-purple-100 px-2 py-1 rounded-full transition-colors active:scale-95"
            >
              {{ preset.label }}
            </button>
          </div>
          <!-- Custom modifier -->
          <div class="flex gap-1.5 mb-2">
            <input
              v-model="noteModal.modName"
              type="text"
              placeholder="Nome variante"
              class="flex-[2] border border-gray-200 rounded-xl px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-purple-400"
            />
            <input
              v-model.number="noteModal.modPrice"
              type="number"
              min="0"
              step="0.50"
              placeholder="€"
              class="w-16 border border-gray-200 rounded-xl px-2 py-2 text-sm text-center focus:outline-none focus:ring-2 focus:ring-purple-400"
            />
            <button @click="addModToNoteModal" class="bg-purple-500 text-white px-2.5 py-2 rounded-xl font-bold text-sm active:scale-95 shadow-sm">
              <Plus class="size-4" />
            </button>
          </div>
          <div v-if="noteModal.modifiersArray.length > 0" class="flex flex-wrap gap-1.5">
            <span
              v-for="(mod, mi) in noteModal.modifiersArray"
              :key="mi"
              class="bg-purple-50 border border-purple-200 text-purple-700 text-xs font-bold px-2 py-1 rounded-full flex items-center gap-1"
            >
              <Sparkles class="size-3" />
              {{ mod.name }}{{ mod.price > 0 ? ' +' + store.config.ui.currency + mod.price.toFixed(2) : '' }}
              <button @click="removeModFromNoteModal(mi)" class="text-purple-400 hover:text-red-500"><X class="size-3" /></button>
            </span>
          </div>
        </div>

        <!-- Save button -->
        <button @click="saveNotes" class="w-full theme-bg text-white py-3 rounded-xl font-bold shadow-md hover:opacity-90 active:scale-95 transition-all flex items-center justify-center gap-2">
          <CheckCircle class="size-5" /> Salva
        </button>
      </div>
    </div>

    <!-- ============================================================ -->
    <!-- SUBMIT CONFIRMATION MODAL                                    -->
    <!-- ============================================================ -->
    <div v-if="showSubmitConfirm" class="fixed inset-0 z-[80] bg-black/60 backdrop-blur-sm flex items-center justify-center p-4">
      <div class="bg-white rounded-3xl shadow-2xl w-full max-w-sm p-6">
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
import { ref, computed, nextTick } from 'vue';
import {
  ClipboardList, ChefHat, Clock, AlertCircle, MousePointerClick, ArrowLeft,
  AlertTriangle, Trash2, PlusCircle, Send, ShieldCheck, Minus, Plus,
  MessageSquareWarning, PenLine, X, BookOpen, ShoppingCart, Sparkles,
  Layers, CheckCircle, LayoutGrid, RefreshCw,
} from 'lucide-vue-next';
import { useAppStore } from '../store/index.js';
import { updateOrderTotals, getOrderItemRowTotal } from '../utils/index.js';

const emit = defineEmits(['jump-to-sala']);

const store = useAppStore();

// ── Menu loading state ──────────────────────────────────────────────────────
const menuLoading = computed(() => store.menuLoading);

// ── Tab & selection ────────────────────────────────────────────────────────
const activeTab = ref('pending');
const selectedOrder = ref(null);

const filteredOrders = computed(() => {
  return store.orders
    .filter(o => o.status === activeTab.value)
    .sort((a, b) => b.time.localeCompare(a.time));
});

const acceptedCount = computed(() =>
  store.orders.filter(o => o.status === 'accepted').length,
);

function changeTab(tab) {
  activeTab.value = tab;
  selectedOrder.value = null;
}

function selectOrder(ord) {
  selectedOrder.value = ord;
}

// ── Course helpers ──────────────────────────────────────────────────────────
const DEFAULT_COURSE = 'insieme';
const courseOrder = ['prima', DEFAULT_COURSE, 'dopo'];

const courseButtonMap = {
  prima:   { num: '1', classes: 'bg-orange-400 text-white', title: 'Esce prima' },
  insieme: { num: '2', classes: 'theme-bg text-white',      title: 'Insieme'    },
  dopo:    { num: '3', classes: 'bg-teal-500 text-white',   title: 'Esce dopo'  },
};

function courseButtonProps(course) {
  return courseButtonMap[course] ?? courseButtonMap.insieme;
}

// ── Ordered items by course ─────────────────────────────────────────────────
const orderedOrderItems = computed(() => {
  if (!selectedOrder.value) return [];
  const groups = { prima: [], insieme: [], dopo: [] };
  selectedOrder.value.orderItems.forEach((item, index) => {
    const course = item.course && courseOrder.includes(item.course) ? item.course : DEFAULT_COURSE;
    groups[course].push({ item, index });
  });
  const nonEmpty = courseOrder.filter(c => groups[c].length > 0);
  const showHeaders = nonEmpty.length > 1;
  const result = [];
  courseOrder.forEach(course => {
    if (groups[course].length > 0) {
      if (showHeaders) result.push({ type: 'header', course });
      groups[course].forEach(entry => result.push({ type: 'item', ...entry }));
    }
  });
  return result;
});

// ── Note modal ─────────────────────────────────────────────────────────────
const noteInput = ref(null);
const noteModal = ref({
  show: false, inputText: '', notesArray: [],
  rowIndex: null, targetOrd: null, itemRef: null,
  modifiersArray: [], modName: '', modPrice: 0,
  course: DEFAULT_COURSE, cartIdx: null,
});

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
  noteModal.value.modPrice = 0;
  noteModal.value.show = true;
  nextTick(() => noteInput.value?.focus());
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
  noteModal.value.modPrice = 0;
  noteModal.value.show = true;
  nextTick(() => noteInput.value?.focus());
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
  noteModal.value.modifiersArray.push({ name, price: noteModal.value.modPrice || 0 });
  noteModal.value.modName = '';
  noteModal.value.modPrice = 0;
}

function applyNoteModPreset(name, price) {
  noteModal.value.modName = name;
  noteModal.value.modPrice = price;
  addModToNoteModal();
}

function removeModFromNoteModal(idx) {
  noteModal.value.modifiersArray.splice(idx, 1);
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
  const c = store.config.ui.currency;
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
const activeMenuCategory = ref(Object.keys(store.config.menu)[0] || '');

const menuCategories = computed(() => Object.keys(store.config.menu));

const currentMenuItems = computed(() => {
  if (!activeMenuCategory.value) return [];
  return store.config.menu[activeMenuCategory.value] || [];
});

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

function addToTempCart(item) {
  const blank = { dishId: item.id, notes: [], modifiers: [], course: DEFAULT_COURSE };
  const existing = tempCart.value.find(r => itemsAreMergeable(r, blank));
  if (existing) { existing.quantity++; return; }
  tempCart.value.push({
    uid: 'tmp_' + Math.random().toString(36).slice(2, 11),
    dishId: item.id,
    name: item.name,
    unitPrice: item.price,
    quantity: 1,
    notes: [],
    voidedQuantity: 0,
    modifiers: [],
    course: DEFAULT_COURSE,
  });
}

function updateTempCartQty(idx, delta) {
  tempCart.value[idx].quantity += delta;
  if (tempCart.value[idx].quantity <= 0) tempCart.value.splice(idx, 1);
}

function cycleCourse(idx) {
  const current = tempCart.value[idx].course || DEFAULT_COURSE;
  const next = courseOrder[(courseOrder.indexOf(current) + 1) % courseOrder.length];
  tempCart.value[idx].course = next;
}

function openAddMenu(targetOrder) {
  targetOrderForMenu.value = targetOrder;
  tempCart.value = [];
  activeMenuCategory.value = Object.keys(store.config.menu)[0] || '';
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
    const existing = ordRef.orderItems.find(r => itemsAreMergeable(r, cartItem));
    if (existing) { existing.quantity += cartItem.quantity; return; }
    cartItem.uid = 'r_new_' + Math.random().toString(36).slice(2, 11);
    ordRef.orderItems.push(cartItem);
  });
  updateOrderTotals(ordRef);
  closeMenuModal();
  activeTab.value = 'pending';
  selectedOrder.value = ordRef;
}

// ── Delete order ────────────────────────────────────────────────────────────
function deleteOrder() {
  if (!selectedOrder.value || selectedOrder.value.status !== 'pending') return;
  store.changeOrderStatus(selectedOrder.value, 'rejected');
  selectedOrder.value = null;
}

// ── Submit order (send to kitchen) ─────────────────────────────────────────
const showSubmitConfirm = ref(false);
const orderToSubmit = ref(null);

function submitOrder() {
  if (!selectedOrder.value || selectedOrder.value.orderItems.length === 0) return;
  orderToSubmit.value = selectedOrder.value;
  showSubmitConfirm.value = true;
}

function confirmSubmitOrder() {
  if (!orderToSubmit.value) return;
  const ord = orderToSubmit.value;
  // TODO API: replace with POST /api/orders when API is available.
  // For now the order is already in the shared store as 'pending';
  // a real waiter terminal would submit it here and receive a server-assigned id.
  showSubmitConfirm.value = false;
  orderToSubmit.value = null;
  // Move the order out of "In Attesa" by marking it as accepted/sent to kitchen.
  store.changeOrderStatus(ord, 'accepted');
  // Deselect the order and remain on the pending tab.
  selectedOrder.value = null;
}

// ── Expose for parent (WaiterOrderView) ────────────────────────────────────
defineExpose({ openAddMenu, selectedOrder, activeTab, changeTab });
</script>
