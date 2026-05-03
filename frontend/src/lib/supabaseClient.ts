import { createClient, SupabaseClient } from '@supabase/supabase-js';

let browserClient: SupabaseClient | null = null;

/**
 * Browser Supabase client (anon key). Used for Realtime + read RLS only.
 * Returns null when env is missing — UI should treat chat as disabled.
 */
export function getSupabaseBrowserClient(): SupabaseClient | null {
  const url = process.env.REACT_APP_SUPABASE_URL;
  const anon = process.env.REACT_APP_SUPABASE_ANON_KEY;
  if (!url || !anon) return null;
  if (!browserClient) {
    browserClient = createClient(url, anon, {
      auth: { persistSession: false, autoRefreshToken: false },
      realtime: { params: { eventsPerSecond: 12 } }
    });
  }
  return browserClient;
}

export function isSupabaseChatConfigured(): boolean {
  return Boolean(process.env.REACT_APP_SUPABASE_URL && process.env.REACT_APP_SUPABASE_ANON_KEY);
}
