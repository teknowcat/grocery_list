<script lang="ts">
  import { onMount, tick } from 'svelte';
  import { supabase } from '$lib/supabaseClient';
  import { version } from '$lib/version';

  export let data;

  let stores = [];
  let selectedStore = '';
  let newStoreName = '';
  let showNewStoreInput = false;
  let items = [];
  let filteredItems = [];
  let loading = true;
  let searchTerm = '';
  let sortColumn = '';
  let sortDirection = 'asc';
  let showAddForm = false;
  let newItem = { id: null, name: '', type: 'Produce', quantity: 1, aisle: 'Produce', note: '', location: '' };
  let nameInput;
  let swipedItemId = null;

  const storeLogos = {
    "Trader Joe's": 'https://tgxkodolhdibzglkgawv.supabase.co/storage/v1/object/public/store_logos/tj_standard_00.png',
    "Vons": 'https://tgxkodolhdibzglkgawv.supabase.co/storage/v1/object/public/store_logos/vons_standard_01.png',
    "Costco": 'https://tgxkodolhdibzglkgawv.supabase.co/storage/v1/object/public/store_logos/costco_02.jpg'
  };

  const storeLogoSizes = {
    "Trader Joe's": 'height: 48px; max-width: 140px;',
    "Vons": 'height: 36px; max-width: 110px;',
    "Costco": 'height: 36px; max-width: 100px;'
  };

  const itemTypes = ['Baking', 'Beans', 'Breads', 'Canned', 'Condiments', 'Dairy', 'Deli', 'Frozen', 'Grains', 'Household', 'Meat', 'Produce', 'Snacks', 'Spices', 'Coffee / Tea', 'Drinks', 'Herbs', 'Kitchen', 'Mexican'];
  const aisleOptions = ['Dairy', 'Deli / Butcher', 'Produce', 'Frozen', 'Bakery / Breads', '1', '2', '3', '4', '5', '6', '7', '8', '9', '10', '11', '12', '13', '14', '15', '16', '17', '18', '19', '20'];

  let shoppingMode = false;
  let shopSort = 'alpha';

  let toastMsg = '';
  let toastType = 'error';
  let toastTimer = null;
  let pendingDelete = null;

  let warnShow = false;
  let warnMsg = '';
  function showWarn(msg) { warnMsg = msg; warnShow = true; }

  function showToast(msg, type = 'error') {
    toastMsg = msg;
    toastType = type;
    clearTimeout(toastTimer);
    if (type !== 'undo') toastTimer = setTimeout(() => toastMsg = '', 3000);
  }

  async function undoDelete() {
    if (!pendingDelete) return;
    clearTimeout(pendingDelete.timer);
    items = [...items, pendingDelete.item].sort((a, b) => a.name.localeCompare(b.name));
    applyFilters();
    await loadStores();
    pendingDelete = null;
    toastMsg = '';
  }

  $: if (showAddForm) tick().then(() => nameInput?.focus());

  let confirmShow = false;
  let confirmMessage = '';
  let confirmAction = null;
  function askConfirm(message, action) { confirmMessage = message; confirmAction = action; confirmShow = true; }
  function doConfirm() { const fn = confirmAction; confirmShow = false; confirmAction = null; fn?.(); }
  function dismissConfirm() { confirmShow = false; confirmAction = null; }

  $: todoItems = filteredItems.filter(i => !i.is_done && (!shoppingMode || i.quantity > 0));
  $: doneItems = filteredItems.filter(i => i.is_done);

  $: aisleGroups = (() => {
    const groups: Record<string, typeof todoItems> = {};
    todoItems.forEach(item => {
      const aisle = item.aisle || 'Other';
      if (!groups[aisle]) groups[aisle] = [];
      groups[aisle].push(item);
    });
    return Object.entries(groups)
      .sort(([a], [b]) => {
        const numA = Number(a), numB = Number(b);
        if (!isNaN(numA) && !isNaN(numB)) return numA - numB;
        if (!isNaN(numA)) return 1;
        if (!isNaN(numB)) return -1;
        return a.localeCompare(b);
      })
      .map(([aisle, items]) => ({ aisle, items: [...items].sort((a, b) => a.name.localeCompare(b.name)) }));
  })();

  onMount(async () => {
    await loadStores();
    await loadItems();
    loading = false;
    const subscription = supabase.channel('grocery_changes').on('postgres_changes', { event: '*', schema: 'public', table: 'grocery_items' }, () => loadItems()).subscribe();
    return () => subscription.unsubscribe();
  });

  async function logout() {
    await supabase.auth.signOut();
    window.location.href = '/login';
  }

  async function loadStores() {
    const { data: userStores, error } = await supabase.from('stores').select('*').order('name');
    if (error) { showToast('Failed to load stores'); return; }
    if (userStores && userStores.length > 0) {
      const storesWithCounts = await Promise.all(userStores.map(async (store) => {
        const { count } = await supabase
          .from('grocery_items')
          .select('*', { count: 'exact', head: true })
          .eq('location', store.name);
        return { ...store, itemCount: count ?? 0 };
      }));
      stores = storesWithCounts;
    } else {
      const defaultStores = ["Vons", "Trader Joe's", "Other"];
      for (const store of defaultStores) {
        await supabase.from('stores').insert([{ name: store, user_id: data.user.id }]);
      }
      await loadStores();
    }
  }

  async function addStore() {
    if (!newStoreName.trim()) return;
    const storeName = newStoreName.trim();
    const { error } = await supabase.from('stores').insert([{ name: storeName, user_id: data.user.id }]);
    if (error) { showToast('Failed to add store'); return; }
    newStoreName = '';
    showNewStoreInput = false;
    selectedStore = storeName;
    await loadStores();
    await tick();
    await loadItems();
  }

  async function deleteStore(store) {
    if (store.itemCount > 0) return;
    const { error } = await supabase.from('stores').delete().eq('id', store.id);
    if (error) { showToast('Failed to delete store'); return; }
    if (selectedStore === store.name) selectedStore = '';
    await loadStores();
  }

  async function loadItems() {
    let query = supabase.from('grocery_items').select('*');
    if (selectedStore) query = query.eq('location', selectedStore);
    const { data: itemsData, error } = await query.order('name', { ascending: true });
    if (error) { showToast('Failed to load items'); return; }
    if (itemsData) {
      items = itemsData;
      applyFilters();
    }
  }

  function applyFilters() {
    let result = [...items];
    if (searchTerm) result = result.filter(item => item.name.toLowerCase().includes(searchTerm.toLowerCase()));
    if (sortColumn) {
      result.sort((a, b) => {
        let aVal = a[sortColumn], bVal = b[sortColumn];
        if (typeof aVal === 'string') { aVal = aVal.toLowerCase(); bVal = bVal.toLowerCase(); }
        if (aVal < bVal) return sortDirection === 'asc' ? -1 : 1;
        if (aVal > bVal) return sortDirection === 'asc' ? 1 : -1;
        return 0;
      });
    }
    filteredItems = result;
  }

  async function editItem(item) {
    newItem = { ...item };
    showAddForm = true;
    swipedItemId = null;
    await tick();
    document.querySelector('.add-form')?.scrollIntoView({ behavior: 'smooth', block: 'start' });
  }

  async function deleteItem(id) {
    const item = items.find(i => i.id === id);
    if (!item) return;
    items = items.filter(i => i.id !== id);
    applyFilters();
    swipedItemId = null;
    if (pendingDelete) {
      clearTimeout(pendingDelete.timer);
      const { error } = await supabase.from('grocery_items').delete().eq('id', pendingDelete.id);
      if (error) showToast('Delete failed');
      await loadStores();
    }
    const timer = setTimeout(async () => {
      const { error } = await supabase.from('grocery_items').delete().eq('id', id);
      if (error) showToast('Delete failed — item may not have been removed');
      await loadStores();
      pendingDelete = null;
      toastMsg = '';
    }, 4000);
    pendingDelete = { id, item, timer };
    showToast(`Deleted "${item.name}"`, 'undo');
  }

  async function toggleCollected(item) {
    if (!shoppingMode) { showWarn("You can't collect an item unless you are in Shopping Mode!"); return; }
    const { error } = await supabase.from('grocery_items').update({ is_done: !item.is_done }).eq('id', item.id);
    if (error) { showToast('Failed to update item'); return; }
    await loadItems();
  }

  async function updateQuantity(item, newQuantity) {
    if (newQuantity < 0) newQuantity = 0;
    const { error } = await supabase.from('grocery_items').update({ quantity: newQuantity }).eq('id', item.id);
    if (error) { showToast('Failed to update quantity'); return; }
    await loadItems();
  }

  async function resetQuantitiesAndCollected() {
    const { error } = await supabase
      .from('grocery_items')
      .update({ quantity: 0, is_done: false })
      .eq('location', selectedStore);
    if (error) { showToast('Reset failed'); return; }
    await loadItems();
  }

  async function addOrFindItem() {
    if (!newItem.name.trim()) return;

    if (newItem.id) {
      const { error } = await supabase.from('grocery_items').update({
        name: newItem.name.trim(),
        type: newItem.type,
        quantity: newItem.quantity,
        aisle: newItem.aisle,
        note: newItem.note || null,
        location: newItem.location
      }).eq('id', newItem.id);
      if (error) { showToast('Failed to save item'); return; }
      await loadItems();
      showAddForm = false;
      newItem = { id: null, name: '', type: 'Produce', quantity: 1, aisle: 'Produce', note: '', location: '' };
      return;
    }

    const { data: existing, error: findError } = await supabase.from('grocery_items').select('*').eq('name', newItem.name.trim());
    if (findError) { showToast('Failed to search items'); return; }
    if (existing && existing.length > 0) {
      showToast(`"${newItem.name}" already exists`, 'info');
    } else {
      const { error: insertError } = await supabase.from('grocery_items').insert([{
        name: newItem.name.trim(),
        type: newItem.type,
        location: selectedStore,
        quantity: newItem.quantity,
        aisle: newItem.aisle,
        note: newItem.note || null,
        is_done: false,
        user_id: data.user.id
      }]);
      if (insertError) { showToast('Failed to add item'); return; }
      await loadItems();
      showAddForm = false;
      newItem = { id: null, name: '', type: 'Produce', quantity: 1, aisle: 'Produce', note: '', location: '' };
    }
  }

  function toggleSwipe(id) {
    swipedItemId = swipedItemId === id ? null : id;
  }
</script>

<style>
  :global(body) {
    background: #f5f4f0;
    font-family: 'DM Sans', system-ui, sans-serif;
    overflow-x: hidden;
  }

  .app {
    max-width: 480px;
    margin: 0 auto;
    min-height: 100vh;
    background: #f5f4f0;
    overflow-x: hidden;
  }

  .topbar {
    background: #1a1a2e;
    padding: 16px 20px 14px;
    display: flex;
    justify-content: space-between;
    align-items: center;
    gap: 12px;
    overflow: hidden;
  }
  .topbar-left { flex: 1; min-width: 0; }
  .topbar-title {
    font-size: 18px;
    font-weight: 600;
    color: #fff;
    letter-spacing: -0.3px;
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
  }
  .topbar-sub {
    font-size: 11px;
    color: rgba(255,255,255,0.45);
    margin-top: 1px;
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
  }
  .topbar-actions { display: flex; flex-direction: column; align-items: flex-end; gap: 6px; flex-shrink: 0; }
  .topbar-actions-row { display: flex; align-items: center; gap: 8px; }
  .print-btn {
    font-size: 18px; line-height: 1; text-decoration: none;
    padding: 4px; border-radius: 8px; transition: background 0.15s;
  }
  .print-btn:hover { background: rgba(255,255,255,0.1); }
  .add-store-btn {
    font-size: 11px; color: rgba(255,255,255,0.5);
    border: none; background: transparent;
    cursor: pointer; padding: 0;
    transition: color 0.15s;
  }
  .add-store-btn:hover { color: #fff; }
  .logout-btn {
    font-size: 12px;
    color: rgba(255,255,255,0.55);
    border: 0.5px solid rgba(255,255,255,0.2);
    border-radius: 20px;
    padding: 5px 12px;
    background: transparent;
    cursor: pointer;
    transition: all 0.15s;
  }
  .logout-btn:hover { color: #fff; border-color: rgba(255,255,255,0.5); }

  .store-bar {
    background: #1a1a2e;
    padding: 0 20px 14px 20px;
    display: flex;
    gap: 2px;
    overflow-x: auto;
    -webkit-overflow-scrolling: touch;
    scrollbar-width: none;
    scroll-snap-type: x mandatory;
  }
  
  .store-bar::-webkit-scrollbar { display: none; }
  .store-tab {
    flex-shrink: 0;
    font-size: 12px;
    font-weight: 500;
    padding: 5px 10px;
    border-radius: 20px;
    border: 0.5px solid rgba(255,255,255,0.2);
    color: rgba(255,255,255,0.55);
    background: transparent;
    cursor: pointer;
    transition: all 0.15s;
    display: flex;
    align-items: center;
    gap: 6px;
    white-space: nowrap;
  }
  .store-tab:first-child { padding-left: 0; border-left: none; border-radius: 0 20px 20px 0; }
  .store-tab:hover { color: #fff; border-color: rgba(255,255,255,0.45); }
  .store-tab.active { background: #7c6ff7; border-color: #7c6ff7; color: #fff; }
  .store-tab.add-tab { border-style: dashed; }
  .delete-dot {
    width: 14px;
    height: 14px;
    border-radius: 50%;
    background: rgba(255,255,255,0.15);
    color: rgba(255,255,255,0.7);
    font-size: 10px;
    display: flex;
    align-items: center;
    justify-content: center;
    line-height: 1;
    transition: all 0.15s;
  }
  .delete-dot.can-delete { background: #e24b4a; color: #fff; }
  .delete-dot.can-delete:hover { background: #c73c3b; }

  .new-store-bar {
    background: #1a1a2e;
    padding: 0 20px 14px;
    display: flex;
    gap: 8px;
  }
  .new-store-input {
    flex: 1;
    background: rgba(255,255,255,0.1);
    border: 0.5px solid rgba(255,255,255,0.2);
    border-radius: 20px;
    padding: 7px 14px;
    font-size: 13px;
    color: #fff;
    outline: none;
  }
  .new-store-input::placeholder { color: rgba(255,255,255,0.35); }
  .new-store-input:focus { border-color: #7c6ff7; }
  .new-store-save {
    background: #7c6ff7;
    border: none;
    border-radius: 20px;
    padding: 7px 16px;
    font-size: 12px;
    font-weight: 500;
    color: #fff;
    cursor: pointer;
  }

  .toolbar {
    padding: 12px 16px;
    display: flex;
    gap: 8px;
    align-items: center;
    background: #f5f4f0;
  }
  .search-wrap { flex: 1; }
  .search-input {
    width: 100%;
    background: #fff;
    border: 0.5px solid #e0deda;
    border-radius: 20px;
    padding: 9px 14px;
    font-size: 13px;
    color: #1a1a2e;
    outline: none;
    box-sizing: border-box;
    transition: border-color 0.15s;
  }
  .search-input:focus { border-color: #7c6ff7; }
  .search-input::placeholder { color: #aaa; }
  .tool-btn {
    width: 36px;
    height: 36px;
    border-radius: 50%;
    border: 0.5px solid #e0deda;
    background: #fff;
    display: flex;
    align-items: center;
    justify-content: center;
    cursor: pointer;
    flex-shrink: 0;
    font-size: 16px;
    color: #1a1a2e;
    transition: all 0.15s;
  }
  .tool-btn:hover { border-color: #7c6ff7; color: #7c6ff7; }
  .tool-btn.primary { background: #7c6ff7; border-color: #7c6ff7; color: #fff; font-size: 20px; font-weight: 300; }
  .tool-btn.primary:hover { background: #6b5ef0; }

  .add-form {
    margin: 0 16px 12px;
    background: #fff;
    border-radius: 16px;
    border: 0.5px solid #e0deda;
    padding: 16px;
  }
  .add-form-title {
    font-size: 14px;
    font-weight: 600;
    color: #1a1a2e;
    margin-bottom: 12px;
  }
  .form-grid {
    display: grid;
    grid-template-columns: 1fr 1fr;
    gap: 8px;
    margin-bottom: 8px;
  }
  .form-full { grid-column: 1 / -1; }
  .form-input, .form-select {
    width: 100%;
    border: 0.5px solid #e0deda;
    border-radius: 10px;
    padding: 8px 10px;
    font-size: 13px;
    color: #1a1a2e;
    background: #faf9f7;
    outline: none;
    box-sizing: border-box;
    transition: border-color 0.15s;
  }
  .form-input:focus, .form-select:focus { border-color: #7c6ff7; }
  .form-actions { display: flex; gap: 8px; margin-top: 12px; }
  .form-save {
    flex: 1;
    background: #7c6ff7;
    border: none;
    border-radius: 10px;
    padding: 9px;
    font-size: 13px;
    font-weight: 500;
    color: #fff;
    cursor: pointer;
  }
  .form-cancel {
    flex: 1;
    background: #f0ede8;
    border: none;
    border-radius: 10px;
    padding: 9px;
    font-size: 13px;
    color: #666;
    cursor: pointer;
  }

  .section-label {
    font-size: 10px;
    font-weight: 600;
    letter-spacing: 0.08em;
    text-transform: uppercase;
    color: #aaa;
    padding: 8px 20px 4px;
  }

  .item-list {
    padding: 0 16px;
    display: flex;
    flex-direction: column;
    gap: 6px;
    margin-bottom: 6px;
  }
  .item-wrap {
    position: relative;
    overflow: hidden;
    border-radius: 14px;
  }
  .item-actions-bg {
    position: absolute;
    right: 0;
    top: 0;
    bottom: 0;
    display: flex;
    align-items: stretch;
    border-radius: 0 14px 14px 0;
    overflow: hidden;
  }
  .action-btn {
    width: 64px;
    display: flex;
    flex-direction: column;
    align-items: center;
    justify-content: center;
    gap: 3px;
    font-size: 11px;
    font-weight: 500;
    cursor: pointer;
    border: none;
    color: #fff;
  }
  .action-btn.edit { background: #7c6ff7; }
  .action-btn.delete { background: #e24b4a; }
  .action-icon { font-size: 16px; line-height: 1; }

  .item-card {
    background: #fff;
    border-radius: 14px;
    padding: 12px 14px;
    display: flex;
    align-items: center;
    gap: 12px;
    position: relative;
    transition: transform 0.2s ease;
    cursor: pointer;
    border: 0.5px solid #e8e5e0;
  }
  .item-card.swiped { transform: translateX(-128px); border-radius: 14px 0 0 14px; pointer-events: none; }
  .item-card.done-card { background: #f0ede8; opacity: 0.7; }

  .check-box {
    width: 22px;
    height: 22px;
    border-radius: 6px;
    border: 1.5px solid #ddd;
    flex-shrink: 0;
    display: flex;
    align-items: center;
    justify-content: center;
    transition: all 0.15s;
    cursor: pointer;
  }
  .check-box.checked { background: #2d9e6b; border-color: #2d9e6b; }
  .check-mark {
    width: 5px;
    height: 9px;
    border: 2px solid #fff;
    border-top: none;
    border-left: none;
    transform: rotate(45deg) translateY(-1px);
  }

  .item-info { flex: 1; min-width: 0; }
  .item-name {
    font-size: 14px;
    font-weight: 500;
    color: #1a1a2e;
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
  }
  .item-name.done { text-decoration: line-through; text-decoration-color: #e24b4a; text-decoration-thickness: 2px; color: #999; font-weight: 400; }
  .item-sub { font-size: 11px; color: #aaa; margin-top: 2px; }

  .qty-ctrl {
    display: flex;
    align-items: center;
    gap: 8px;
    flex-shrink: 0;
  }
  .qty-btn {
    width: 24px;
    height: 24px;
    border-radius: 50%;
    border: 0.5px solid #e0deda;
    background: #f5f4f0;
    display: flex;
    align-items: center;
    justify-content: center;
    font-size: 15px;
    cursor: pointer;
    color: #555;
    line-height: 1;
    transition: all 0.15s;
    flex-shrink: 0;
  }
  .qty-btn:hover { border-color: #7c6ff7; color: #7c6ff7; }
  .qty-val {
    font-size: 14px;
    font-weight: 600;
    color: #1a1a2e;
    min-width: 18px;
    text-align: center;
  }

  .footer-bar {
    position: sticky;
    bottom: 56px;
    background: #fff;
    border-top: 0.5px solid #e8e5e0;
    padding: 12px 20px;
    display: flex;
    justify-content: space-between;
    align-items: center;
  }
  .footer-stat { font-size: 13px; color: #888; }
  .footer-stat strong { color: #1a1a2e; font-weight: 600; }
  .reset-btn {
    font-size: 12px;
    font-weight: 500;
    color: #7c6ff7;
    border: 0.5px solid #c5bff7;
    border-radius: 20px;
    padding: 6px 14px;
    background: transparent;
    cursor: pointer;
    transition: all 0.15s;
  }
  .reset-btn:hover { background: #f0eeff; }

  .empty-state {
    text-align: center;
    padding: 48px 20px;
    color: #bbb;
    font-size: 14px;
  }
  .empty-icon { font-size: 36px; margin-bottom: 10px; }

  .select-prompt {
    text-align: center;
    padding: 60px 20px;
  }
  .select-prompt-icon { font-size: 40px; margin-bottom: 12px; }
  .select-prompt-text { font-size: 15px; color: #888; }

  .loading-wrap {
    display: flex;
    justify-content: center;
    padding: 60px 20px;
  }
  .spinner {
    width: 28px;
    height: 28px;
    border: 2.5px solid #e0deda;
    border-top-color: #7c6ff7;
    border-radius: 50%;
    animation: spin 0.7s linear infinite;
  }
  @keyframes spin { to { transform: rotate(360deg); } }

  .tool-btn.shopping-active { background: #2d9e6b; border-color: #2d9e6b; color: #fff; }
  .tool-btn.shopping-active:hover { background: #258a5c; }

  .shopping-banner {
    margin: 0 16px 8px;
    background: #2d9e6b;
    color: #fff;
    border-radius: 10px;
    padding: 8px 14px;
    font-size: 12px;
    font-weight: 500;
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 8px;
  }
  .shop-sort-toggle {
    display: flex;
    gap: 4px;
    flex-shrink: 0;
  }
  .shop-sort-toggle button {
    background: rgba(255,255,255,0.2);
    border: none;
    color: #fff;
    border-radius: 6px;
    padding: 3px 9px;
    font-size: 11px;
    font-weight: 500;
    cursor: pointer;
  }
  .shop-sort-toggle button.sort-active {
    background: rgba(255,255,255,0.45);
    color: #1a1a2e;
    font-weight: 600;
  }

  .version {
    text-align: center;
    font-size: 10px;
    color: #ccc;
    padding: 16px 0 24px;
  }

  .toast {
    position: fixed;
    bottom: 64px;
    left: 50%;
    transform: translateX(-50%);
    max-width: 440px;
    width: calc(100% - 32px);
    padding: 10px 14px;
    border-radius: 10px;
    font-size: 13px;
    font-weight: 500;
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 10px;
    z-index: 200;
    box-shadow: 0 4px 16px rgba(0,0,0,0.15);
  }
  .toast.error { background: #e24b4a; color: #fff; }
  .toast.info { background: #444; color: #fff; }
  .toast.undo { background: #1a1a2e; color: #fff; }
  .toast-undo {
    background: rgba(255,255,255,0.2);
    border: none;
    color: #fff;
    border-radius: 6px;
    padding: 4px 10px;
    font-size: 12px;
    font-weight: 600;
    cursor: pointer;
    white-space: nowrap;
    flex-shrink: 0;
  }
  .toast-undo:hover { background: rgba(255,255,255,0.3); }

  :global(.confirm-overlay) {
    position: fixed; inset: 0;
    background: rgba(0,0,0,0.45);
    display: flex; align-items: center; justify-content: center;
    z-index: 9999; padding: 24px;
  }
  :global(.confirm-box) {
    background: #fff; border-radius: 16px;
    padding: 24px 20px 20px;
    width: 100%; max-width: 320px;
    box-shadow: 0 8px 32px rgba(0,0,0,0.25);
  }
  :global(.confirm-msg) {
    font-size: 15px; font-weight: 600; color: #1a1a2e;
    text-align: center; margin-bottom: 20px; line-height: 1.4;
  }
  :global(.confirm-btns) { display: flex; gap: 10px; }
  :global(.confirm-cancel) {
    flex: 1; background: #f0ede8; border: none; border-radius: 10px;
    padding: 10px; font-size: 14px; color: #555; cursor: pointer;
  }
  :global(.confirm-ok) {
    flex: 1; background: #e24b4a; border: none; border-radius: 10px;
    padding: 10px; font-size: 14px; font-weight: 600; color: #fff; cursor: pointer;
  }
</style>

<link href="https://fonts.googleapis.com/css2?family=DM+Sans:wght@400;500;600&display=swap" rel="stylesheet">

<div class="app">

  <div class="topbar">
    <div class="topbar-left">
      <div class="topbar-title">🛒 Grocery list</div>
      <div class="topbar-sub">{data.user.email}</div>
    </div>
    <div class="topbar-actions">
      <div class="topbar-actions-row">
        <button class="add-store-btn" on:click={() => showNewStoreInput = !showNewStoreInput}>+ Store</button>
        <a href="/print" class="print-btn" title="Print list">🖨️</a>
      </div>
      <button class="logout-btn" on:click={logout}>Log out</button>
    </div>
  </div>

  <div class="store-bar">
    {#each stores as store}
      <button
        class="store-tab {selectedStore === store.name ? 'active' : ''}"
        on:click={() => { selectedStore = store.name; loadItems(); }}
      >
        {#if storeLogos[store.name]}
          <img src={storeLogos[store.name]} alt={store.name} style="object-fit: contain; {storeLogoSizes[store.name] ?? 'height: 48px; max-width: 140px;'}" />
        {:else}
          {store.name}
        {/if}
        <span
          class="delete-dot {store.itemCount === 0 ? 'can-delete' : ''}"
          title={store.itemCount === 0 ? 'Delete store' : 'Remove all items first'}
          on:click|stopPropagation={() => store.itemCount === 0 && askConfirm(`Delete "${store.name}"?`, () => deleteStore(store))}
        >✕</span>
      </button>
    {/each}
  </div>

  {#if showNewStoreInput}
    <div class="new-store-bar">
      <input
        class="new-store-input"
        type="text"
        bind:value={newStoreName}
        placeholder="Store name"
        on:keypress={(e) => e.key === 'Enter' && addStore()}
        autofocus
      />
      <button class="new-store-save" on:click={addStore}>Add</button>
    </div>
  {/if}

  {#if !selectedStore}
    <div class="select-prompt">
      <div class="select-prompt-icon">🏪</div>
      <div class="select-prompt-text">Select a store to start shopping</div>
    </div>
  {:else if loading}
    <div class="loading-wrap"><div class="spinner"></div></div>
  {:else}

    <div class="toolbar">
      <div class="search-wrap">
        <input
          class="search-input"
          type="text"
          bind:value={searchTerm}
          placeholder="Search items..."
          on:input={applyFilters}
        />
      </div>
      <button class="tool-btn primary" on:click={() => { showAddForm = !showAddForm; newItem = { id: null, name: '', type: 'Produce', quantity: 1, aisle: 'Produce', note: '', location: '' }; }}>+</button>
      <button class="tool-btn" title="Reset all" on:click={() => askConfirm('Reset all quantities and collected items?', resetQuantitiesAndCollected)}>↺</button>
      <button class="tool-btn {shoppingMode ? 'shopping-active' : ''}" title="Shopping mode" on:click={() => shoppingMode = !shoppingMode}>🛒</button>
    </div>

    {#if shoppingMode}
      <div class="shopping-banner">
        <span>🛒 Shopping Mode</span>
        <div class="shop-sort-toggle">
          <button class:sort-active={shopSort === 'alpha'} on:click={() => shopSort = 'alpha'}>A-Z</button>
          <button class:sort-active={shopSort === 'aisle'} on:click={() => shopSort = 'aisle'}>By Aisle</button>
        </div>
      </div>
    {/if}

    {#if showAddForm}
      <div class="add-form">
        <div class="add-form-title">{newItem.id ? 'Edit item' : 'Add item'}</div>
        <div class="form-grid">
          <input class="form-input form-full" type="text" bind:value={newItem.name} bind:this={nameInput} placeholder="Item name*" />
          <select class="form-select" bind:value={newItem.type}>
            {#each itemTypes as type}<option>{type}</option>{/each}
          </select>
          <select class="form-select" bind:value={newItem.aisle}>
            {#each aisleOptions as aisle}<option>{aisle}</option>{/each}
          </select>
          <input class="form-input" type="number" bind:value={newItem.quantity} min="1" placeholder="Qty" />
          <input class="form-input form-full" type="text" bind:value={newItem.note} placeholder="Note (optional)" />
          {#if newItem.id}
            <select class="form-select form-full" bind:value={newItem.location}>
              {#each stores as store}<option value={store.name}>{store.name}</option>{/each}
            </select>
          {/if}
        </div>
        <div class="form-actions">
          <button class="form-save" on:click={addOrFindItem}>Save</button>
          <button class="form-cancel" on:click={() => showAddForm = false}>Cancel</button>
        </div>
      </div>
    {/if}

    {#if todoItems.length > 0}
      {#if shoppingMode && shopSort === 'aisle'}
        {#each aisleGroups as group}
          <div class="section-label">Aisle: {group.aisle} · {group.items.length}</div>
          <div class="item-list">
            {#each group.items as item (item.id)}
              <div class="item-wrap" on:click={() => toggleSwipe(item.id)}>
                <div class="item-actions-bg">
                  <button class="action-btn edit" on:click|stopPropagation={() => editItem(item)}>
                    <span class="action-icon">✎</span>Edit
                  </button>
                  <button class="action-btn delete" on:click|stopPropagation={() => askConfirm(`Delete "${item.name}"?`, () => deleteItem(item.id))}>
                    <span class="action-icon">✕</span>Delete
                  </button>
                </div>
                <div class="item-card {swipedItemId === item.id ? 'swiped' : ''}">
                  <div class="check-box" on:click|stopPropagation={() => toggleCollected(item)}></div>
                  <div class="item-info">
                    <div class="item-name">{item.name}</div>
                    <div class="item-sub">{item.type}{item.note ? ' · ' + item.note : ''}</div>
                  </div>
                  <div class="qty-ctrl">
                    <button class="qty-btn" on:click|stopPropagation={() => updateQuantity(item, item.quantity - 1)}>−</button>
                    <span class="qty-val">{item.quantity}</span>
                    <button class="qty-btn" on:click|stopPropagation={() => updateQuantity(item, item.quantity + 1)}>+</button>
                  </div>
                </div>
              </div>
            {/each}
          </div>
        {/each}
      {:else}
      <div class="section-label">To get · {todoItems.length}</div>
      <div class="item-list">
        {#each todoItems as item (item.id)}
          <div class="item-wrap" on:click={() => toggleSwipe(item.id)}>
            <div class="item-actions-bg">
              <button class="action-btn edit" on:click|stopPropagation={() => editItem(item)}>
                <span class="action-icon">✎</span>
                Edit
              </button>
              <button class="action-btn delete" on:click|stopPropagation={() => askConfirm(`Delete "${item.name}"?`, () => deleteItem(item.id))}>
                <span class="action-icon">✕</span>
                Delete
              </button>
            </div>
            <div class="item-card {swipedItemId === item.id ? 'swiped' : ''}" >
              <div class="check-box" on:click|stopPropagation={() => toggleCollected(item)}></div>
              <div class="item-info">
                <div class="item-name">{item.name}</div>
                <div class="item-sub">{item.type}{item.aisle ? ' · ' + item.aisle : ''}{item.note ? ' · ' + item.note : ''}</div>
              </div>
              <div class="qty-ctrl">
                <button class="qty-btn" on:click|stopPropagation={() => updateQuantity(item, item.quantity - 1)}>−</button>
                <span class="qty-val">{item.quantity}</span>
                <button class="qty-btn" on:click|stopPropagation={() => updateQuantity(item, item.quantity + 1)}>+</button>
              </div>
            </div>
          </div>
        {/each}
      </div>
      {/if}
    {/if}

    {#if doneItems.length > 0}
      <div class="section-label">Collected · {doneItems.length}</div>
      <div class="item-list">
        {#each doneItems as item (item.id)}
          <div class="item-wrap" on:click={() => toggleSwipe(item.id)}>
            <div class="item-actions-bg">
              <button class="action-btn edit" on:click|stopPropagation={() => editItem(item)}>
                <span class="action-icon">✎</span>
                Edit
              </button>
              <button class="action-btn delete" on:click|stopPropagation={() => askConfirm(`Delete "${item.name}"?`, () => deleteItem(item.id))}>
                <span class="action-icon">✕</span>
                Delete
              </button>
            </div>
            <div class="item-card done-card {swipedItemId === item.id ? 'swiped' : ''}">
              <div class="check-box checked" on:click|stopPropagation={() => toggleCollected(item)}>
                <div class="check-mark"></div>
              </div>
              <div class="item-info">
                <div class="item-name done">{item.name}</div>
                <div class="item-sub">{item.type}{item.aisle ? ' · ' + item.aisle : ''}</div>
              </div>
              <div class="qty-ctrl">
                <button class="qty-btn" on:click|stopPropagation={() => updateQuantity(item, item.quantity - 1)}>−</button>
                <span class="qty-val">{item.quantity}</span>
                <button class="qty-btn" on:click|stopPropagation={() => updateQuantity(item, item.quantity + 1)}>+</button>
              </div>
            </div>
          </div>
        {/each}
      </div>
    {/if}

    {#if todoItems.length === 0 && doneItems.length === 0}
      <div class="empty-state">
        <div class="empty-icon">🛒</div>
        <div>No items yet — tap + to add your first item</div>
      </div>
    {/if}

    <div class="footer-bar">
      <div class="footer-stat">
        <strong>{todoItems.length}</strong> remaining · <strong>{doneItems.length}</strong> collected
      </div>
      <button class="reset-btn" on:click={() => askConfirm('Reset all quantities and collected items?', resetQuantitiesAndCollected)}>Reset all</button>
    </div>

  {/if}

  <div class="version">{version}</div>

  {#if toastMsg}
    <div class="toast {toastType}">
      <span>{toastMsg}</span>
      {#if toastType === 'undo'}
        <button class="toast-undo" on:click={undoDelete}>Undo</button>
      {/if}
    </div>
  {/if}
</div>

{#if confirmShow}
  <div class="confirm-overlay" on:click={dismissConfirm}>
    <div class="confirm-box" on:click|stopPropagation>
      <div class="confirm-msg">{confirmMessage}</div>
      <div class="confirm-btns">
        <button class="confirm-cancel" on:click={dismissConfirm}>Cancel</button>
        <button class="confirm-ok" on:click={doConfirm}>Yes, do it</button>
      </div>
    </div>
  </div>
{/if}

{#if warnShow}
  <div class="confirm-overlay" on:click={() => warnShow = false}>
    <div class="confirm-box" on:click|stopPropagation>
      <div class="confirm-msg">{warnMsg}</div>
      <div class="confirm-btns">
        <button class="confirm-ok" style="flex:1" on:click={() => warnShow = false}>Got it</button>
      </div>
    </div>
  </div>
{/if}