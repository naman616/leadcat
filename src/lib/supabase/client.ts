import { createBrowserClient } from "@supabase/ssr";

/** Browser-side Supabase client. Only ever import this from client code. */
export function createSupabaseBrowserClient() {
  return createBrowserClient(
    import.meta.env["VITE_SUPABASE_URL"],
    import.meta.env["VITE_SUPABASE_ANON_KEY"],
  );
}
