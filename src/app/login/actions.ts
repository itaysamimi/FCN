"use server";

import { redirect } from "next/navigation";
import { GENERIC_ERROR, isRateLimitError } from "@/lib/auth-errors";
import { readField } from "@/lib/forms";
import { createClient } from "@/lib/supabase/server";
import type { FormState } from "@/types/forms";

export async function signIn(_prev: FormState, formData: FormData): Promise<FormState> {
  const email = readField(formData, "email").toLowerCase();
  const password = formData.get("password");

  if (!email || typeof password !== "string" || !password) {
    return { status: "error", message: "יש למלא מייל וסיסמה", fields: { email } };
  }

  const supabase = await createClient();
  const { error } = await supabase.auth.signInWithPassword({ email, password });

  if (error) {
    if (isRateLimitError(error)) {
      return {
        status: "error",
        message: "יותר מדי ניסיונות התחברות. נסה שוב בעוד כמה דקות.",
        fields: { email },
      };
    }
    if (error.code === "invalid_credentials" || error.status === 400) {
      return { status: "error", message: "מייל או סיסמה שגויים", fields: { email } };
    }
    console.error("signIn failed:", error.code ?? error.status, error.message);
    return { status: "error", message: GENERIC_ERROR, fields: { email } };
  }

  redirect("/");
}
