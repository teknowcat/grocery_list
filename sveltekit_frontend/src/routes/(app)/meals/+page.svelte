<script lang="ts">
  import { onMount } from 'svelte';
  import { supabase } from '$lib/supabaseClient';
  import { version } from '$lib/version';

  export let data;

  const raters = ['Cortez', 'Bartile', 'Dean'];
  const typeOptions = ['Casserole', 'Chili', 'Curry', 'Pasta', 'Quiche', 'Salad', 'Seafood', 'Soup', 'Stew', 'Veggies', 'Other'];
  const platformOptions = ['Stove Top', 'Instant Pot', 'Slow Cooker', 'Hybrid', 'Both'];

  let meals = [];
  let loading = true;
  let filterType = 'All';
  let showAddForm = false;
  let expandedMealId = null;
  let newMeal = { name: '', type: 'Stew', platform: 'Stove Top' };
  let ratingForm = { rater: 'Cortez', rating: '' };
  let toastMsg = '';
  let toastType = 'error';
  let toastTimer = null;
  let pendingDeleteMeal = null;
  let surpriseMeal = null;
  let sortBy = 'avg';
  let showPastMonth = false;
  let monthHistory = [];
  let countEdit = { id: null, value: '' };
  let confirmShow = false;
  let confirmMessage = '';
  let confirmAction = null;
  function askConfirm(message, action) { confirmMessage = message; confirmAction = action; confirmShow = true; }
  function doConfirm() { const fn = confirmAction; confirmShow = false; confirmAction = null; fn?.(); }
  function dismissConfirm() { confirmShow = false; confirmAction = null; }

  function showToast(msg, type = 'error') {
    toastMsg = msg;
    toastType = type;
    clearTimeout(toastTimer);
    if (type !== 'undo') toastTimer = setTimeout(() => toastMsg = '', 3000);
  }

  async function undoDeleteMeal() {
    if (!pendingDeleteMeal) return;
    clearTimeout(pendingDeleteMeal.timer);
    meals = [...meals, pendingDeleteMeal.meal].sort((a, b) => (avg(b) ?? -1) - (avg(a) ?? -1));
    pendingDeleteMeal = null;
    toastMsg = '';
  }

  async function loadHistory() {
    const thirtyDaysAgo = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString();
    const { data: h } = await supabase
      .from('meal_week_history')
      .select('meal_id')
      .gte('picked_at', thirtyDaysAgo);
    if (!h) return;
    const counts = {};
    h.forEach(r => counts[r.meal_id] = (counts[r.meal_id] || 0) + 1);
    monthHistory = Object.entries(counts).map(([meal_id, count]) => ({ meal_id, count }));
  }

  function pickSurprise() {
    const eligible = meals.filter(m => (avg(m) ?? 0) >= 7);
    const pool = eligible.length ? eligible : meals;
    if (!pool.length) return;
    surpriseMeal = pool[Math.floor(Math.random() * pool.length)];
  }

  $: allTypes = ['All', ...[...new Set(meals.map(m => m.type).filter(Boolean))].sort()];
  $: filteredMeals = filterType === 'All' ? meals : meals.filter(m => m.type === filterType);
  let sortedMeals = [];
  $: {
    const by = sortBy;
    sortedMeals = [...filteredMeals].sort((a, b) => {
      if (by === 'avg') return (avg(b) ?? -1) - (avg(a) ?? -1);
      const ra = getRating(a, by);
      const rb = getRating(b, by);
      if (ra === null && rb === null) return (avg(b) ?? -1) - (avg(a) ?? -1);
      if (ra === null) return 1;
      if (rb === null) return -1;
      const diff = rb - ra;
      if (diff !== 0) return diff;
      return (avg(b) ?? -1) - (avg(a) ?? -1);
    });
  }
  $: weekMeals = meals.filter(m => m.week_pick);
  $: monthCountMap = Object.fromEntries(monthHistory.map(h => [h.meal_id, h.count]));
  $: pastMonthMeals = meals
    .filter(m => monthCountMap[m.id])
    .sort((a, b) => (monthCountMap[b.id] || 0) - (monthCountMap[a.id] || 0));
  $: pastMonthTotal = monthHistory.reduce((s, h) => s + h.count, 0);

  function avg(meal) {
    const ratings = (meal.meal_ratings || []).map(r => Number(r.rating)).filter(r => !isNaN(r));
    if (!ratings.length) return null;
    return ratings.reduce((s, r) => s + r, 0) / ratings.length;
  }

  function getRating(meal, rater) {
    const r = (meal.meal_ratings || []).find(r => r.rater === rater);
    return r ? Number(r.rating) : null;
  }

  function avgColor(a) {
    if (a === null) return '#bbb';
    if (a >= 9) return '#2d9e6b';
    if (a >= 8) return '#7c6ff7';
    if (a >= 7) return '#f0a500';
    return '#e24b4a';
  }

  function fmt(n) {
    if (n === null) return '—';
    return Number(n).toFixed(2).replace(/\.?0+$/, '');
  }

  onMount(async () => {
    await loadMeals();
    await loadHistory();
    loading = false;
  });

  async function loadMeals() {
    const { data: d, error } = await supabase
      .from('meals')
      .select('*, meal_ratings(*)');
    if (error) { showToast('Failed to load meals'); return; }
    meals = (d || []).sort((a, b) => (avg(b) ?? -1) - (avg(a) ?? -1));
  }

  async function addMeal() {
    if (!newMeal.name.trim()) return;
    const { error } = await supabase.from('meals').insert([{
      user_id: data.user.id, name: newMeal.name.trim(),
      type: newMeal.type, platform: newMeal.platform, week_pick: false
    }]);
    if (error) { showToast('Failed to add meal'); return; }
    newMeal = { name: '', type: 'Stew', platform: 'Stove Top' };
    showAddForm = false;
    await loadMeals();
  }

  async function deleteMeal(id) {
    const meal = meals.find(m => m.id === id);
    if (!meal) return;
    meals = meals.filter(m => m.id !== id);
    expandedMealId = null;
    if (pendingDeleteMeal) {
      clearTimeout(pendingDeleteMeal.timer);
      await supabase.from('meal_ratings').delete().eq('meal_id', pendingDeleteMeal.id);
      await supabase.from('meals').delete().eq('id', pendingDeleteMeal.id);
    }
    const timer = setTimeout(async () => {
      await supabase.from('meal_ratings').delete().eq('meal_id', id);
      const { error } = await supabase.from('meals').delete().eq('id', id);
      if (error) showToast('Delete failed');
      pendingDeleteMeal = null;
      toastMsg = '';
    }, 4000);
    pendingDeleteMeal = { id, meal, timer };
    showToast(`Deleted "${meal.name}"`, 'undo');
  }

  async function saveRating(meal) {
    const r = parseFloat(ratingForm.rating);
    if (isNaN(r) || r < 0 || r > 10) return;
    const { error } = await supabase.from('meal_ratings').upsert(
      { meal_id: meal.id, rater: ratingForm.rater, rating: r },
      { onConflict: 'meal_id,rater' }
    );
    if (error) { showToast('Failed to save rating'); return; }
    ratingForm = { rater: 'Cortez', rating: '' };
    expandedMealId = null;
    await loadMeals();
  }

  async function saveCount(meal) {
    const val = parseInt(countEdit.value);
    if (isNaN(val) || val < 0) return;
    const { error } = await supabase.from('meals').update({ week_count: val }).eq('id', meal.id);
    if (error) { showToast('Failed to update count'); return; }
    await loadMeals();
  }

  async function clearHistory(meal) {
    const { error } = await supabase.from('meal_week_history').delete().eq('meal_id', meal.id);
    if (error) { showToast('Failed to clear history'); return; }
    await loadHistory();
    showToast('30-day history cleared', 'info');
  }

  async function toggleWeekPick(meal) {
    const adding = !meal.week_pick;
    const updates: any = { week_pick: adding };
    if (adding && 'week_count' in meal) {
      updates.week_count = (meal.week_count || 0) + 1;
    }
    const { error } = await supabase.from('meals').update(updates).eq('id', meal.id);
    if (error) { showToast('Failed to update'); return; }
    if (adding) {
      await supabase.from('meal_week_history').insert({ meal_id: meal.id, user_id: data.user.id });
    }
    await loadMeals();
    await loadHistory();
  }

  async function logout() {
    await supabase.auth.signOut();
    window.location.href = '/login';
  }
</script>

<link href="https://fonts.googleapis.com/css2?family=DM+Sans:wght@400;500;600&display=swap" rel="stylesheet">

<div class="app">

  <div class="topbar">
    <div>
      <div class="topbar-title">🍽️ Meal Ideas</div>
      <div class="topbar-sub">{data.user.email}</div>
    </div>
    <button class="logout-btn" on:click={logout}>Log out</button>
  </div>

  <div class="type-bar">
    {#each allTypes as type}
      <button class="type-tab {filterType === type ? 'active' : ''}" on:click={() => filterType = type}>
        {type}
      </button>
    {/each}
  </div>

  {#if weekMeals.length > 0}
    <div class="section-label">This week · {weekMeals.length}</div>
    <div class="meal-list">
      {#each weekMeals as meal (meal.id)}
        <div class="meal-card week-card">
          <div class="meal-main">
            <div class="meal-info">
              <div class="meal-name">{meal.name}</div>
              <div class="meal-meta">{meal.type} · {meal.platform}</div>
            </div>
            <div class="avg-badge" style="background: {avgColor(avg(meal))}">
              {fmt(avg(meal))}
            </div>
          </div>
          <button class="week-remove" on:click={() => toggleWeekPick(meal)}>✕ Remove</button>
        </div>
      {/each}
    </div>
  {/if}

  <div class="toolbar">
    <div class="toolbar-label">{filteredMeals.length} meals</div>
    <div class="toolbar-actions">
      <button class="surprise-btn" on:click={pickSurprise} title="Surprise me">🎲</button>
      <button class="month-btn {showPastMonth ? 'active' : ''}" on:click={() => showPastMonth = !showPastMonth} title="Past 30 days">📅</button>
<button class="add-btn" on:click={() => { showAddForm = !showAddForm; newMeal = { name: '', type: 'Stew', platform: 'Stove Top' }; }}>+ Add</button>
    </div>
  </div>

  {#if showPastMonth}
    <div class="month-view">
      {#if pastMonthMeals.length === 0}
        <div class="month-empty">
          <div class="month-empty-icon">📅</div>
          <div>No meals picked in the past 30 days yet.</div>
          <div class="month-empty-sub">Start adding meals to This Week to build your history.</div>
        </div>
      {:else}
        <div class="section-label">Past 30 days · {pastMonthTotal} {pastMonthTotal === 1 ? 'pick' : 'picks'}</div>
        <div class="meal-list">
          {#each pastMonthMeals as meal (meal.id)}
            <div class="meal-card {expandedMealId === meal.id ? 'expanded' : ''}">
              <div class="meal-main" on:click={() => { const opening = expandedMealId !== meal.id; expandedMealId = opening ? meal.id : null; if (opening) countEdit = { id: meal.id, value: String(meal.week_count || 0) }; }}>
                <div class="meal-info">
                  <div class="meal-name">{meal.name}</div>
                  <div class="meal-meta">{meal.type} · {meal.platform}</div>
                </div>
                <div class="month-count-pill">×{monthCountMap[meal.id]}</div>
                <div class="avg-badge" style="background: {avgColor(avg(meal))}">{fmt(avg(meal))}</div>
              </div>
              {#if expandedMealId === meal.id}
                <div class="meal-actions">
                  <div class="count-edit-row" style="border-top: none; padding-top: 0; margin-top: 0;">
                    <span class="count-edit-label">All-time count</span>
                    <input class="count-input" type="number" min="0" bind:value={countEdit.value} />
                    <button class="count-save" on:click={() => saveCount(meal)}>✓</button>
                    <button class="count-clear" on:click={() => clearHistory(meal)} title="Clear 30-day history">30d ✕</button>
                  </div>
                </div>
              {/if}
            </div>
          {/each}
        </div>
      {/if}
    </div>
  {:else}
    <div class="sort-bar">
      <span class="sort-label">Sort:</span>
      <button class="sort-chip {sortBy === 'avg' ? 'active' : ''}" on:click={() => sortBy = 'avg'}>Avg</button>
      {#each raters as rater}
        <button class="sort-chip {sortBy === rater ? 'active' : ''}" on:click={() => sortBy = rater}>{rater}</button>
      {/each}
    </div>

    {#if surpriseMeal}
      <div class="surprise-banner">
        <div class="surprise-content">
          <div class="surprise-label">Try this tonight</div>
          <div class="surprise-name">{surpriseMeal.name}</div>
          <div class="surprise-meta">{surpriseMeal.type} · {surpriseMeal.platform}</div>
          <button class="surprise-week-btn" on:click={async () => { await toggleWeekPick(surpriseMeal); surpriseMeal = null; }}>
            📅 Add to This Week
          </button>
        </div>
        <div class="avg-badge" style="background: {avgColor(avg(surpriseMeal))}">{fmt(avg(surpriseMeal))}</div>
        <button class="surprise-close" on:click={() => surpriseMeal = null}>✕</button>
      </div>
    {/if}

    {#if showAddForm}
      <div class="add-form">
        <div class="form-title">New meal</div>
        <input class="form-input" type="text" bind:value={newMeal.name} placeholder="Meal name*" />
        <div class="form-row">
          <select class="form-select" bind:value={newMeal.type}>
            {#each typeOptions as t}<option>{t}</option>{/each}
          </select>
          <select class="form-select" bind:value={newMeal.platform}>
            {#each platformOptions as p}<option>{p}</option>{/each}
          </select>
        </div>
        <div class="form-actions">
          <button class="form-save" on:click={addMeal}>Save</button>
          <button class="form-cancel" on:click={() => showAddForm = false}>Cancel</button>
        </div>
      </div>
    {/if}

    {#if loading}
      <div class="loading-wrap"><div class="spinner"></div></div>
    {:else}
      <div class="meal-list">
        {#each sortedMeals as meal (meal.id)}
          <div class="meal-card {expandedMealId === meal.id ? 'expanded' : ''}">
            <div class="meal-main" on:click={() => { const opening = expandedMealId !== meal.id; expandedMealId = opening ? meal.id : null; if (opening) countEdit = { id: meal.id, value: String(meal.week_count || 0) }; }}>
              <div class="meal-info">
                <div class="meal-name">{meal.name}</div>
                <div class="meal-meta">{meal.type} · {meal.platform}</div>
                <div class="ratings-row">
                  {#each raters as rater}
                    {@const val = getRating(meal, rater)}
                    <span class="rater-pill" style="color: {val !== null ? avgColor(val) : '#bbb'}">
                      {rater[0]}: {fmt(val)}
                    </span>
                  {/each}
                </div>
              </div>
              <div class="avg-badge" style="background: {avgColor(sortBy === 'avg' ? avg(meal) : getRating(meal, sortBy))}">
                {fmt(sortBy === 'avg' ? avg(meal) : getRating(meal, sortBy))}
              </div>
            </div>

            {#if expandedMealId === meal.id}
              <div class="meal-actions">
                <div class="rate-form">
                  <select class="rate-select" bind:value={ratingForm.rater}>
                    {#each raters as r}<option>{r}</option>{/each}
                  </select>
                  <input class="rate-input" type="number" min="0" max="10" step="0.25"
                    bind:value={ratingForm.rating} placeholder="0–10" />
                  <button class="rate-save" on:click={() => saveRating(meal)}>Rate</button>
                </div>
                <div class="action-btns">
                  <button class="action-btn week {meal.week_pick ? 'week-on' : ''}" on:click={() => toggleWeekPick(meal)}>
                    {meal.week_pick ? '📅 This week ✓' : '📅 This week'}{meal.week_count > 0 ? ` ×${meal.week_count}` : ''}
                  </button>
                  <button class="action-btn del" on:click={() => askConfirm(`Delete "${meal.name}"?`, () => deleteMeal(meal.id))}>Delete</button>
                </div>
                <div class="count-edit-row">
                  <span class="count-edit-label">All-time count</span>
                  <input class="count-input" type="number" min="0" bind:value={countEdit.value} />
                  <button class="count-save" on:click={() => saveCount(meal)}>✓</button>
                  <button class="count-clear" on:click={() => clearHistory(meal)} title="Clear 30-day history">30d ✕</button>
                </div>
              </div>
            {/if}
          </div>
        {/each}
      </div>
    {/if}
  {/if}

  <div class="version">{version}</div>

  {#if toastMsg}
    <div class="toast {toastType}">
      <span>{toastMsg}</span>
      {#if toastType === 'undo'}
        <button class="toast-undo" on:click={undoDeleteMeal}>Undo</button>
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

<style>
  :global(body) {
    background: #f5f4f0;
    font-family: 'DM Sans', system-ui, sans-serif;
  }
  .app {
    max-width: 480px;
    margin: 0 auto;
    min-height: 100vh;
    background: #f5f4f0;
    padding-bottom: 72px;
  }

  .topbar {
    background: #1a1a2e;
    padding: 16px 20px 14px;
    display: flex;
    justify-content: space-between;
    align-items: center;
  }
  .topbar-title { font-size: 18px; font-weight: 600; color: #fff; letter-spacing: -0.3px; }
  .topbar-sub { font-size: 11px; color: rgba(255,255,255,0.45); margin-top: 1px; }
  .logout-btn {
    font-size: 12px; color: rgba(255,255,255,0.55);
    border: 0.5px solid rgba(255,255,255,0.2); border-radius: 20px;
    padding: 5px 12px; background: transparent; cursor: pointer; transition: all 0.15s;
  }
  .logout-btn:hover { color: #fff; border-color: rgba(255,255,255,0.5); }

  .type-bar {
    background: #1a1a2e;
    padding: 0 20px 14px;
    display: flex;
    flex-wrap: wrap;
    gap: 6px;
  }
  .type-tab {
    flex-shrink: 0;
    font-size: 12px; font-weight: 500;
    padding: 6px 14px; border-radius: 20px;
    border: 0.5px solid rgba(255,255,255,0.2);
    color: rgba(255,255,255,0.55); background: transparent;
    cursor: pointer; transition: all 0.15s; white-space: nowrap;
  }
  .type-tab:hover { color: #fff; border-color: rgba(255,255,255,0.45); }
  .type-tab.active { background: #7c6ff7; border-color: #7c6ff7; color: #fff; }

  .toolbar {
    padding: 12px 16px;
    display: flex;
    justify-content: space-between;
    align-items: center;
  }
  .toolbar-label { font-size: 12px; color: #aaa; font-weight: 500; }
  .add-btn {
    font-size: 12px; font-weight: 500; color: #7c6ff7;
    border: 0.5px solid #c5bff7; border-radius: 20px;
    padding: 6px 14px; background: transparent; cursor: pointer; transition: all 0.15s;
  }
  .add-btn:hover { background: #f0eeff; }

  .add-form {
    margin: 0 16px 12px;
    background: #fff; border-radius: 16px;
    border: 0.5px solid #e0deda; padding: 16px;
  }
  .form-title { font-size: 14px; font-weight: 600; color: #1a1a2e; margin-bottom: 12px; }
  .form-input, .form-select {
    width: 100%; border: 0.5px solid #e0deda; border-radius: 10px;
    padding: 8px 10px; font-size: 13px; color: #1a1a2e;
    background: #faf9f7; outline: none; box-sizing: border-box;
    transition: border-color 0.15s; margin-bottom: 8px;
  }
  .form-input:focus, .form-select:focus { border-color: #7c6ff7; }
  .form-row { display: grid; grid-template-columns: 1fr 1fr; gap: 8px; margin-bottom: 8px; }
  .form-row .form-select { margin-bottom: 0; }
  .form-actions { display: flex; gap: 8px; margin-top: 4px; }
  .form-save {
    flex: 1; background: #7c6ff7; border: none; border-radius: 10px;
    padding: 9px; font-size: 13px; font-weight: 500; color: #fff; cursor: pointer;
  }
  .form-cancel {
    flex: 1; background: #f0ede8; border: none; border-radius: 10px;
    padding: 9px; font-size: 13px; color: #666; cursor: pointer;
  }

  .section-label {
    font-size: 10px; font-weight: 600; letter-spacing: 0.08em;
    text-transform: uppercase; color: #aaa; padding: 8px 20px 4px;
  }

  .meal-list {
    padding: 0 16px;
    display: flex; flex-direction: column; gap: 8px; margin-bottom: 8px;
  }

  .meal-card {
    background: #fff; border-radius: 14px;
    border: 0.5px solid #e8e5e0; overflow: hidden;
    transition: box-shadow 0.15s;
  }
  .meal-card.expanded { box-shadow: 0 2px 12px rgba(0,0,0,0.08); }
  .meal-card.week-card { border-color: #2d9e6b; border-width: 1px; }

  .meal-main {
    display: flex; align-items: center; gap: 12px;
    padding: 12px 14px; cursor: pointer;
  }
  .meal-info { flex: 1; min-width: 0; }
  .meal-name {
    font-size: 14px; font-weight: 500; color: #1a1a2e;
    white-space: nowrap; overflow: hidden; text-overflow: ellipsis;
  }
  .meal-meta { font-size: 11px; color: #aaa; margin-top: 2px; }
  .ratings-row { display: flex; gap: 8px; margin-top: 4px; }
  .rater-pill { font-size: 11px; font-weight: 500; }

  .avg-badge {
    flex-shrink: 0;
    width: 44px; height: 44px; border-radius: 50%;
    display: flex; align-items: center; justify-content: center;
    font-size: 13px; font-weight: 600; color: #fff;
  }

  .meal-actions {
    padding: 0 14px 14px;
    border-top: 0.5px solid #f0ede8;
    padding-top: 12px;
  }
  .rate-form { display: flex; gap: 8px; margin-bottom: 10px; }
  .rate-select {
    flex: 1; border: 0.5px solid #e0deda; border-radius: 10px;
    padding: 7px 10px; font-size: 13px; background: #faf9f7;
    color: #1a1a2e; outline: none;
  }
  .rate-input {
    width: 72px; border: 0.5px solid #e0deda; border-radius: 10px;
    padding: 7px 10px; font-size: 13px; background: #faf9f7;
    color: #1a1a2e; outline: none; text-align: center;
  }
  .rate-save {
    background: #7c6ff7; border: none; border-radius: 10px;
    padding: 7px 14px; font-size: 13px; font-weight: 500;
    color: #fff; cursor: pointer; white-space: nowrap;
  }
  .action-btns { display: flex; gap: 8px; }
  .action-btn {
    flex: 1; border: none; border-radius: 10px;
    padding: 8px; font-size: 12px; font-weight: 500;
    cursor: pointer; transition: all 0.15s;
  }
  .action-btn.week { background: #f0ede8; color: #555; }
  .action-btn.week.week-on { background: #e8f5ee; color: #2d9e6b; }
  .action-btn.del { background: #fef0f0; color: #e24b4a; }

  .count-edit-row {
    display: flex; align-items: center; gap: 6px;
    margin-top: 10px; padding-top: 10px;
    border-top: 0.5px solid #f0ede8;
  }
  .count-edit-label { font-size: 11px; color: #aaa; flex: 1; }
  .count-input {
    width: 56px; border: 0.5px solid #e0deda; border-radius: 8px;
    padding: 5px 8px; font-size: 13px; text-align: center;
    background: #faf9f7; color: #1a1a2e; outline: none;
  }
  .count-input:focus { border-color: #7c6ff7; }
  .count-save {
    background: #7c6ff7; border: none; border-radius: 8px;
    padding: 5px 10px; font-size: 13px; color: #fff; cursor: pointer;
  }
  .count-clear {
    background: #fef0f0; border: none; border-radius: 8px;
    padding: 5px 10px; font-size: 11px; font-weight: 500;
    color: #e24b4a; cursor: pointer; white-space: nowrap;
  }

  .week-remove {
    display: block; width: 100%;
    background: none; border: none; border-top: 0.5px solid #d4f0e2;
    padding: 8px; font-size: 11px; font-weight: 500;
    color: #2d9e6b; cursor: pointer; text-align: center;
  }

  .loading-wrap { display: flex; justify-content: center; padding: 60px 20px; }
  .spinner {
    width: 28px; height: 28px;
    border: 2.5px solid #e0deda; border-top-color: #7c6ff7;
    border-radius: 50%; animation: spin 0.7s linear infinite;
  }
  @keyframes spin { to { transform: rotate(360deg); } }

  .version { text-align: center; font-size: 10px; color: #ccc; padding: 16px 0 24px; }

  .toolbar-actions { display: flex; gap: 8px; align-items: center; }
  .surprise-btn {
    font-size: 20px; background: none; border: none;
    cursor: pointer; padding: 2px 6px; border-radius: 8px; transition: background 0.15s;
  }
  .surprise-btn:hover { background: rgba(0,0,0,0.06); }

  .month-btn {
    font-size: 20px; background: none; border: none;
    cursor: pointer; padding: 2px 6px; border-radius: 8px; transition: background 0.15s;
  }
  .month-btn:hover { background: rgba(0,0,0,0.06); }
  .month-btn.active { background: #e8f5ee; }

  .month-view { padding-bottom: 8px; }
  .month-empty {
    display: flex; flex-direction: column; align-items: center;
    padding: 52px 20px; text-align: center;
    font-size: 13px; color: #aaa;
  }
  .month-empty-icon { font-size: 36px; margin-bottom: 12px; }
  .month-empty-sub { font-size: 12px; color: #bbb; margin-top: 6px; }

  .month-count-pill {
    flex-shrink: 0;
    background: #e8f5ee; color: #2d9e6b;
    font-size: 12px; font-weight: 600;
    padding: 4px 9px; border-radius: 20px;
    margin-right: 4px;
  }

  .sort-bar {
    display: flex; align-items: center; gap: 6px;
    padding: 0 16px 10px; flex-wrap: wrap;
  }
  .sort-label { font-size: 11px; color: #aaa; font-weight: 500; }
  .sort-chip {
    font-size: 11px; font-weight: 500;
    padding: 4px 10px; border-radius: 20px;
    border: 0.5px solid #d8d5d0; background: #fff;
    color: #555; cursor: pointer; transition: all 0.15s;
  }
  .sort-chip.active { background: #7c6ff7; border-color: #7c6ff7; color: #fff; }

  .surprise-banner {
    margin: 0 16px 12px;
    background: #1a1a2e; color: #fff;
    border-radius: 14px; padding: 14px;
    display: flex; align-items: center; gap: 12px;
  }
  .surprise-content { flex: 1; min-width: 0; }
  .surprise-label {
    font-size: 10px; font-weight: 600; letter-spacing: 0.06em;
    color: rgba(255,255,255,0.5); text-transform: uppercase; margin-bottom: 3px;
  }
  .surprise-name { font-size: 15px; font-weight: 600; }
  .surprise-meta { font-size: 11px; color: rgba(255,255,255,0.55); margin-top: 2px; }
  .surprise-week-btn {
    margin-top: 8px;
    background: rgba(255,255,255,0.15);
    border: none; color: #fff;
    border-radius: 8px; padding: 5px 10px;
    font-size: 11px; font-weight: 600;
    cursor: pointer; transition: background 0.15s;
  }
  .surprise-week-btn:hover { background: rgba(255,255,255,0.25); }

  .surprise-close {
    background: rgba(255,255,255,0.12); border: none;
    color: rgba(255,255,255,0.7); border-radius: 50%;
    width: 24px; height: 24px; font-size: 11px; cursor: pointer;
    display: flex; align-items: center; justify-content: center; flex-shrink: 0;
  }

  .toast {
    position: fixed; bottom: 64px; left: 50%; transform: translateX(-50%);
    max-width: 440px; width: calc(100% - 32px);
    padding: 10px 14px; border-radius: 10px;
    font-size: 13px; font-weight: 500;
    display: flex; align-items: center; justify-content: space-between;
    gap: 10px; z-index: 200; box-shadow: 0 4px 16px rgba(0,0,0,0.15);
  }
  .toast.error { background: #e24b4a; color: #fff; }
  .toast.info { background: #444; color: #fff; }
  .toast.undo { background: #1a1a2e; color: #fff; }
  .toast-undo {
    background: rgba(255,255,255,0.2); border: none; color: #fff;
    border-radius: 6px; padding: 4px 10px;
    font-size: 12px; font-weight: 600; cursor: pointer;
    white-space: nowrap; flex-shrink: 0;
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
