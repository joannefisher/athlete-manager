// lib/supabaseAdmin.ts
// Server-only Supabase client using the project's service-role key. This
// key must NEVER reach the browser, so it's read from SUPABASE_SERVICE_ROLE_KEY
// (no NEXT_PUBLIC_ prefix — Next.js only inlines NEXT_PUBLIC_* vars into the
// client bundle) and this file must only ever be imported from server code:
// app/api/**/route.ts handlers. If it were ever imported from a 'use client'
// component, the env var would simply be undefined in the browser and
// getSupabaseAdmin() below would throw rather than leak the key.
//
// The client is created lazily (inside the function, not at module scope)
// so that importing this file never itself throws — e.g. during
// `next build`'s route-collection step, which imports route modules without
// invoking them. It only throws once a request handler actually calls
// getSupabaseAdmin() without the env var set.
import { createClient, SupabaseClient } from '@supabase/supabase-js';

let cached: SupabaseClient | null = null;

export function getSupabaseAdmin(): SupabaseClient {
  if (cached) return cached;
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !serviceKey) {
    throw new Error(
      'Missing NEXT_PUBLIC_SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY — add SUPABASE_SERVICE_ROLE_KEY ' +
      '(from Supabase project settings → API → service_role) as a server-side Vercel env var.'
    );
  }
  cached = createClient(url, serviceKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
  return cached;
}
