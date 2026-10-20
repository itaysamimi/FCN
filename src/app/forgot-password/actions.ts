"use server";

import { isValidEmail, readField } from "@/lib/forms";
import { createClient } from "@/lib/supabase/server";
import type { FormState } from "@/types/forms";

// Always answers the same way, so the form never reveals which emails exist.
const SENT_MESSAGE = "אם המייל רשום אצלנו, נשלח אליו קישור לאיפוס";

export async function requestPasswordReset(
  _prev: FormState,
  formData: FormData,
): Promise<FormState> {
  const email = readField(formData, "email").toLowerCase();
  if (!isValidEmail(email)) {
    return { status: "error", message: "כתובת המייל לא תקינה", fields: { email } };
  }

  const supabase = await createClient();
  const { error } = await supabase.auth.resetPasswordForEmail(email);
  if (error) {
    console.error("resetPasswordForEmail failed:", error.code ?? error.status, error.message);
  }

  return { status: "success", message: SENT_MESSAGE };
}
