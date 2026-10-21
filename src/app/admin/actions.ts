"use server";

import { refresh } from "next/cache";
import { GENERIC_ERROR, isEmailTakenError, isRateLimitError } from "@/lib/auth-errors";
import { getCurrentUser } from "@/lib/auth";
import { isValidEmail, readField } from "@/lib/forms";
import { gbToBytes } from "@/lib/format";
import { createAdminClient } from "@/lib/supabase/admin";
import { createClient } from "@/lib/supabase/server";
import type { FormState } from "@/types/forms";
import type { AuthError } from "@supabase/supabase-js";

const MAX_NAME_LENGTH = 50;
const NOT_ALLOWED: FormState = { status: "error", message: "אין לך הרשאה לבצע פעולה זו" };

function inviteErrorState(error: AuthError, fields?: Record<string, string>): FormState {
  if (isRateLimitError(error)) {
    return { status: "error", message: "נשלחו יותר מדי מיילים, נסה שוב מאוחר יותר", fields };
  }
  if (isEmailTakenError(error)) {
    return { status: "error", message: "המייל הזה כבר רשום", fields };
  }
  console.error("inviteUserByEmail failed:", error.code ?? error.status, error.message);
  return { status: "error", message: GENERIC_ERROR, fields };
}

export async function inviteMember(_prev: FormState, formData: FormData): Promise<FormState> {
  // Server Actions are public endpoints: always re-check the caller.
  const user = await getCurrentUser();
  if (!user?.isAdmin) {
    return NOT_ALLOWED;
  }

  const displayName = readField(formData, "display_name");
  const email = readField(formData, "email").toLowerCase();
  const fields = { display_name: displayName, email };

  if (!displayName || displayName.length > MAX_NAME_LENGTH) {
    return { status: "error", message: `יש להזין שם (עד ${MAX_NAME_LENGTH} תווים)`, fields };
  }
  if (!isValidEmail(email)) {
    return { status: "error", message: "כתובת המייל לא תקינה", fields };
  }

  const { error } = await createAdminClient().auth.admin.inviteUserByEmail(email, {
    data: { display_name: displayName },
  });
  if (error) {
    return inviteErrorState(error, fields);
  }

  refresh();
  return { status: "success", message: "ההזמנה נשלחה" };
}

export async function resendInvite(_prev: FormState, formData: FormData): Promise<FormState> {
  const user = await getCurrentUser();
  if (!user?.isAdmin) {
    return NOT_ALLOWED;
  }

  // Look the email up by id rather than trusting an email sent from the browser.
  const admin = createAdminClient();
  const { data, error } = await admin.auth.admin.getUserById(readField(formData, "user_id"));
  const member = data?.user;
  if (error || !member?.email) {
    return { status: "error", message: "המשתמש לא נמצא" };
  }
  if (member.email_confirmed_at) {
    return { status: "error", message: "המשתמש כבר הצטרף" };
  }

  const { error: inviteError } = await admin.auth.admin.inviteUserByEmail(member.email, {
    data: { display_name: member.user_metadata?.display_name },
  });
  if (inviteError) {
    return inviteErrorState(inviteError);
  }

  return { status: "success", message: "ההזמנה נשלחה שוב" };
}

// Limits the admin can change from the storage card. The UI asks for
// confirmation above the free tier; RLS also restricts the update to admins.
const LIMIT_FIELDS = {
  storage_limit_gb: { column: "storage_limit_bytes", min: 1, max: 100_000, toValue: gbToBytes },
  class_a_limit: { column: "class_a_limit", min: 0, max: 1_000_000_000, toValue: (n: number) => n },
  class_b_limit: { column: "class_b_limit", min: 0, max: 10_000_000_000, toValue: (n: number) => n },
} as const;

export async function updateStorageLimit(_prev: FormState, formData: FormData): Promise<FormState> {
  const user = await getCurrentUser();
  if (!user?.isAdmin) {
    return NOT_ALLOWED;
  }

  const fieldName = readField(formData, "field");
  if (!(fieldName in LIMIT_FIELDS)) {
    return { status: "error", message: GENERIC_ERROR };
  }
  const field = LIMIT_FIELDS[fieldName as keyof typeof LIMIT_FIELDS];
  const value = Number(readField(formData, "value"));
  if (!Number.isInteger(value) || value < field.min || value > field.max) {
    return { status: "error", message: "הערך לא תקין" };
  }

  const supabase = await createClient();
  const { data, error } = await supabase
    .from("app_settings")
    .update({ [field.column]: field.toValue(value) })
    .eq("id", 1)
    .select("id");
  if (error || !data?.length) {
    console.error("app_settings update failed:", error);
    return { status: "error", message: GENERIC_ERROR };
  }

  refresh();
  return { status: "success", message: "נשמר" };
}
