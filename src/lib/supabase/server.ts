import { createServerClient } from "@supabase/ssr";
import { getCookies, setCookie } from "@tanstack/react-start/server";

/**
 * A fresh Supabase server client for the current request. Per Supabase's
 * own guidance, never share one of these across requests — always create a
 * new one, which is why this is a function, not a module-level singleton.
 */
export function createSupabaseServerClient() {
  const supabaseUrl = process.env["VITE_SUPABASE_URL"];
  const supabaseAnonKey = process.env["VITE_SUPABASE_ANON_KEY"];

  if (!supabaseUrl || !supabaseAnonKey) {
    throw new Error("VITE_SUPABASE_URL / VITE_SUPABASE_ANON_KEY are not set");
  }

  return createServerClient(supabaseUrl, supabaseAnonKey, {
    cookies: {
      getAll() {
        const cookies = getCookies();
        return Object.entries(cookies).map(([name, value]) => ({ name, value }));
      },
      setAll(cookiesToSet) {
        for (const { name, value, options } of cookiesToSet) {
          setCookie(name, value, options);
        }
      },
    },
  });
}
