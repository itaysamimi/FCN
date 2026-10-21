import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import { NextResponse } from "next/server";
import { OPS_LIMIT_MESSAGE } from "@/lib/storage-messages";
import { createClient } from "@/lib/supabase/server";
import type { ApiErrorBody } from "@/types/files";

// An error with an HTTP status, a stable code for the client, and a Hebrew message.
export class ApiError extends Error {
  constructor(
    public status: number,
    public code: string,
    message: string,
  ) {
    super(message);
  }
}

export function errorResponse(error: unknown) {
  if (error instanceof ApiError) {
    return NextResponse.json<ApiErrorBody>(
      { error: { code: error.code, message: error.message } },
      { status: error.status },
    );
  }
  console.error("API error:", error);
  return NextResponse.json<ApiErrorBody>(
    { error: { code: "server_error", message: "משהו השתבש. נסה שוב בעוד כמה רגעים." } },
    { status: 500 },
  );
}

// The signed-in user (verified with getUser) and a Supabase client that acts
// as them, so every query below goes through RLS.
export async function requireUser() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    throw new ApiError(401, "unauthenticated", "צריך להתחבר מחדש");
  }
  return { supabase, user };
}

export async function readJson(request: Request): Promise<Record<string, unknown>> {
  try {
    const body: unknown = await request.json();
    if (body && typeof body === "object" && !Array.isArray(body)) {
      return body as Record<string, unknown>;
    }
  } catch {
    // Fall through to the error below.
  }
  throw new ApiError(400, "bad_request", "בקשה לא תקינה");
}

// Counts R2 operations against the monthly limit before they happen.
// Class 'a' = writes, class 'b' = reads. Throws 429 ops_limit when full.
export async function consumeOps(supabase: SupabaseClient, opClass: "a" | "b", count = 1) {
  const { error } = await supabase.rpc("consume_r2_ops", { p_class: opClass, p_count: count });
  if (error) {
    if (error.message === "ops_limit") {
      throw new ApiError(429, "ops_limit", OPS_LIMIT_MESSAGE);
    }
    throw error;
  }
}

// For deletes and aborts: counted when possible, but never blocked by the
// limit. They are free in R2, and blocking them would only leave orphaned
// objects behind or stop people from freeing space.
export async function countCleanupOps(supabase: SupabaseClient, count = 1) {
  try {
    await consumeOps(supabase, "a", count);
  } catch (error) {
    if (!(error instanceof ApiError)) {
      throw error;
    }
  }
}
