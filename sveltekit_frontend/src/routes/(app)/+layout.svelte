<script lang="ts">
  import { page } from '$app/stores';
</script>

<slot />

<nav class="bottom-nav">
  <a href="/dashboard" class="nav-item" class:active={$page.url.pathname === '/dashboard'}>
    <span class="nav-icon">🛒</span>
    <span class="nav-label">Grocery</span>
  </a>
  <a href="/meals" class="nav-item" class:active={$page.url.pathname === '/meals'}>
    <span class="nav-icon">🍽️</span>
    <span class="nav-label">Meals</span>
  </a>
</nav>

<style>
  .bottom-nav {
    position: fixed;
    bottom: 0;
    left: 50%;
    transform: translateX(-50%);
    width: 100%;
    max-width: 480px;
    height: 56px;
    background: #1a1a2e;
    display: flex;
    border-top: 0.5px solid rgba(255, 255, 255, 0.15);
    z-index: 100;
  }
  .nav-item {
    flex: 1;
    display: flex;
    flex-direction: column;
    align-items: center;
    justify-content: center;
    gap: 3px;
    text-decoration: none;
    color: rgba(255, 255, 255, 0.4);
    transition: color 0.15s;
  }
  .nav-item.active { color: #7c6ff7; }
  .nav-icon { font-size: 22px; line-height: 1; }
  .nav-label { font-size: 10px; font-weight: 500; letter-spacing: 0.03em; }
</style>
