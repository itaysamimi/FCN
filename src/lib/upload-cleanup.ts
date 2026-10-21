import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import { countCleanupOps } from "@/lib/api";
import { abortMultipartUpload, deleteObject } from "@/lib/r2/storage";

// Removes everything an unfinished upload may have left in R2 and releases
// its reservation. Only call for keys that no item points to.
export async function discardUpload(
  supabase: SupabaseClient,
  key: string,
  uploadId?: string | null,
) {
  if (uploadId) {
    await countCleanupOps(supabase);
    await abortMultipartUpload(key, uploadId);
  }
  await countCleanupOps(supabase);
  await deleteObject(key);
  await supabase.rpc("release_upload", { p_storage_key: key });
}

export async function itemExistsForKey(supabase: SupabaseClient, key: string) {
  const { data, error } = await supabase
    .from("items")
    .select("id")
    .eq("storage_key", key)
    .maybeSingle();
  if (error) {
    throw error;
  }
  return data !== null;
}
