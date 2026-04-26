// src/routes/+layout.server.ts
import type { LayoutServerLoad } from './$types';

export const load: LayoutServerLoad = async ({ locals }) => {
  const {
    data: { session },
    error
  } = await locals.supabase.auth.getSession();

  if (error) {
    console.error('Supabase session error:', error.message);
  }

  return {
    user: session?.user ?? null
  };
};