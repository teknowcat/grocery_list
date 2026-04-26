<script lang="ts">
  import { supabase } from '$lib/supabaseClient';

  let email = '';
  let password = '';
  let isLogin = true;

  async function handleSubmit() {
    if (isLogin) {
      const { data, error } = await supabase.auth.signInWithPassword({
        email,
        password
      });

      console.log('SIGN IN RESPONSE:', data, error);

      if (error) {
        alert(error.message);
      } else {
        window.location.href = '/';
      }
    } else {
      const { error } = await supabase.auth.signUp({
        email,
        password
      });
      if (error) {
        alert(error.message);
      } else {
        alert('Check your email for a confirmation link!');
      }
    }
  }
</script>

<h1>{isLogin ? 'Login' : 'Sign Up'}</h1>

<input
  type="email"
  bind:value={email}
  placeholder="Email"
  class="input input-bordered mb-2 block"
/>

<input
  type="password"
  bind:value={password}
  placeholder="Password"
  class="input input-bordered mb-2 block"
/>

<button on:click={handleSubmit} style="background: red; color: white; padding: 1rem;">
  {isLogin ? 'Login' : 'Sign Up'}
</button>

<button
  class="btn btn-link"
  on:click={() => (isLogin = !isLogin)}
>
  {isLogin ? 'Need an account? Sign up' : 'Already have an account? Login'}
</button>
