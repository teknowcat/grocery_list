<script lang="ts">
  import { onMount, tick } from 'svelte';
  import { supabase } from '$lib/supabaseClient';

  export let data;

  let stores = [];
  let itemsByStore = {};
  let loading = true;
  let docEl;
  let printMode: 'all' | 'shopping' = 'all';
  let printDate = new Date().toLocaleDateString('en-US', { weekday: 'long', year: 'numeric', month: 'long', day: 'numeric' });

  function filteredItems(storeItems: any[]) {
    if (printMode === 'shopping') return storeItems.filter(i => i.quantity > 0);
    return storeItems;
  }

  onMount(async () => {
    const { data: storeData } = await supabase.from('stores').select('*').order('name');
    stores = storeData || [];

    const { data: items } = await supabase.from('grocery_items').select('*').order('name');
    itemsByStore = {};
    for (const store of stores) {
      itemsByStore[store.name] = (items || []).filter(i => i.location === store.name);
    }
    loading = false;

    await tick();
    applyZoom();
  });

  function applyZoom() {
    if (!docEl) return;
    docEl.style.zoom = '1';
    // Letter paper minus 0.5in margins top+bottom = 10in = 960px at 96dpi
    // Use 900 to be safe across browser rendering differences
    const targetH = 900;
    const actualH = docEl.scrollHeight;
    if (actualH > targetH) {
      docEl.style.zoom = String(targetH / actualH);
    }
  }

  function doPrint() {
    applyZoom();
    setTimeout(() => window.print(), 80);
  }
</script>

<div class="print-page">
  <div class="print-header no-print">
    <a href="/dashboard" class="back-btn">← Back</a>
    <h1 class="page-title">Shopping List</h1>
    <div class="mode-toggle">
      <button class="mode-btn {printMode === 'all' ? 'active' : ''}" on:click={() => printMode = 'all'}>All Items</button>
      <button class="mode-btn {printMode === 'shopping' ? 'active' : ''}" on:click={() => printMode = 'shopping'}>Shopping List</button>
    </div>
    <button class="print-trigger" on:click={doPrint}>🖨️ Print</button>
  </div>

  <div class="print-doc" bind:this={docEl}>
    <div class="doc-header">
      <div class="doc-title">Shopping List</div>
      <div class="doc-date">{printDate}</div>
    </div>

    {#if loading}
      <div class="loading">Loading...</div>
    {:else}
      <div class="store-grid" style="grid-template-columns: repeat({stores.length}, 1fr);">
        {#each stores as store}
          <div class="store-col">
            <div class="store-heading">{store.name}</div>
            <div class="col-rule"></div>
            <div class="col-labels">
              <span class="label-item">Item</span>
              <span class="label-qty">Qty</span>
            </div>
            <div class="col-rule"></div>
            {#each filteredItems(itemsByStore[store.name] || []) as item}
              <div class="print-row">
                <span class="checkbox">□</span>
                <span class="item-name">{item.name}</span>
                <span class="qty-blank">{printMode === 'shopping' ? item.quantity : '____'}</span>
              </div>
            {/each}
            {#if filteredItems(itemsByStore[store.name] || []).length === 0}
              <div class="empty-col">No items</div>
            {/if}
          </div>
        {/each}
      </div>
    {/if}
  </div>
</div>

<style>
  :global(body) { background: #fff; font-family: Arial, sans-serif; margin: 0; }

  .print-page { max-width: 900px; margin: 0 auto; padding: 16px; }

  .print-header {
    display: flex; align-items: center; justify-content: space-between;
    padding: 12px 0 20px; border-bottom: 1px solid #ddd; margin-bottom: 24px;
  }
  .back-btn {
    font-size: 14px; color: #555; text-decoration: none;
    padding: 6px 12px; border: 1px solid #ddd; border-radius: 8px;
  }
  .page-title { font-size: 16px; font-weight: 600; color: #1a1a2e; margin: 0; }
  .print-trigger {
    font-size: 14px; font-weight: 600;
    background: #1a1a2e; color: #fff; border: none;
    padding: 8px 16px; border-radius: 8px; cursor: pointer;
  }

  .mode-toggle { display: flex; gap: 4px; }
  .mode-btn {
    font-size: 12px; font-weight: 500;
    padding: 6px 12px; border-radius: 20px;
    border: 0.5px solid #d8d5d0; background: #fff;
    color: #555; cursor: pointer; transition: all 0.15s;
  }
  .mode-btn.active { background: #1a1a2e; border-color: #1a1a2e; color: #fff; }

  .doc-header {
    display: flex; justify-content: space-between; align-items: baseline;
    margin-bottom: 16px;
  }
  .doc-title { font-size: 20px; font-weight: 700; color: #1a1a2e; }
  .doc-date { font-size: 11px; color: #888; }

  .store-grid { display: grid; gap: 0; }

  .store-col { padding: 0 12px; border-right: 1px solid #ccc; }
  .store-col:first-child { padding-left: 0; }
  .store-col:last-child { border-right: none; padding-right: 0; }

  .store-heading {
    font-size: 14px; font-weight: 700; text-transform: uppercase;
    letter-spacing: 0.06em; color: #1a1a2e; padding-bottom: 6px;
  }
  .col-rule { border-top: 2px solid #1a1a2e; margin-bottom: 4px; }
  .col-labels {
    display: flex; justify-content: space-between;
    font-size: 9px; font-weight: 600; text-transform: uppercase;
    letter-spacing: 0.05em; color: #888; padding: 2px 0;
  }

  .print-row {
    display: flex; align-items: baseline; gap: 6px;
    padding: 3px 0; border-bottom: 0.5px solid #eee;
  }
  .checkbox { font-size: 12px; flex-shrink: 0; color: #333; }
  .item-name { flex: 1; font-size: 11px; color: #1a1a2e; }
  .qty-blank { font-size: 11px; color: #bbb; flex-shrink: 0; letter-spacing: 2px; }

  .empty-col { font-size: 11px; color: #ccc; font-style: italic; padding: 8px 0; }
  .loading { text-align: center; padding: 40px; color: #888; }

  @media print {
    @page { size: letter portrait; margin: 0.5in; }
    .no-print { display: none !important; }
    .print-page { padding: 0; max-width: 100%; }
    :global(.bottom-nav) { display: none !important; }
  }
</style>
