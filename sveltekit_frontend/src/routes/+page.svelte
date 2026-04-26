<script lang="ts">
  import { goto } from "$app/navigation";
  import { onMount } from "svelte";
  import { supabase } from "$lib/supabaseClient";

  onMount(async () => {
    const { data: { session } } = await supabase.auth.getSession();
    if (session) {
      goto("/dashboard");
    } else {
      goto("/login");
    }
  });
</script>

<div class="flex justify-center items-center min-h-screen">
  <span class="loading loading-spinner loading-lg"></span>
</div>
