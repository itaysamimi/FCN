import "server-only";
import { cache } from "react";
import { createClient } from "@/lib/supabase/server";
import type { CurrentUser } from "@/types/auth";

// The signed-in user with their profile, or null. Verified against Supabase
// Auth with getUser() (never getSession()). Deduplicated per request.
export const getCurrentUser = cache(async (): Promise<CurrentUser | null> => {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    return null;
  }

  const { data: profile } = await supabase
    .from("profiles")
    .select("display_name, is_admin")
    .eq("id", user.id)
    .maybeSingle<{ display_name: string; is_admin: boolean }>();

  return {
    id: user.id,
    email: user.email ?? "",
    displayName: profile?.display_name ?? user.email?.split("@")[0] ?? "",
    isAdmin: profile?.is_admin ?? false,
  };
});
