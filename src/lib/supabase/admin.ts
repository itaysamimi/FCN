import "server-only";
import { createClient } from "@supabase/supabase-js";

// Service-role client: bypasses RLS. Only for the admin page (invites, user list),
// and only after the caller has been verified as an admin.
export function createAdminClient() {
  return createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
    {
      auth: {
        autoRefreshToken: false,
        persistSession: false,
      },
    },
  );
}
