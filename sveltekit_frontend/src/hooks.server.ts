import { dev } from '$app/environment';
import type { Handle } from '@sveltejs/kit';
import { createServerClient } from '@supabase/ssr';

export const handle: Handle = async ({ event, resolve }) => {
  const supabase = createServerClient(
    import.meta.env.VITE_SUPABASE_URL,
    import.meta.env.VITE_SUPABASE_ANON_KEY,
    {
      cookies: {
        get: (key) => event.cookies.get(key),
        set: (key, value, options) => event.cookies.set(key, value, options),
        remove: (key, options) => event.cookies.delete(key, options),
      },
    }
  );

  const { data: { session } } = await supabase.auth.getSession();
  
  console.log('=== HOOKS.SERVER.TS ===');
  console.log('Session exists?', !!session);
  console.log('User email?', session?.user?.email);
  
  event.locals.supabase = supabase;
  event.locals.session = session;
  event.locals.user = session?.user ?? null;

  return resolve(event);
};
