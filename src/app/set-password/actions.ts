"use server";

import { redirect } from "next/navigation";
import { GENERIC_ERROR } from "@/lib/auth-errors";
import { createClient } from "@/lib/supabase/server";
import type { FormState } from "@/types/forms";

const MIN_PASSWORD_LENGTH = 8;

export async function setPassword(_prev: FormState, formData: FormData): Promise<FormState> {
  const password = formData.get("password");
  const confirm = formData.get("confirm");

  if (typeof password !== "string" || password.length < MIN_PASSWORD_LENGTH) {
    return { status: "error", message: `הסיסמה צריכה להכיל ${MIN_PASSWORD_LENGTH} תווים לפחות` };
  }
  if (password !== confirm) {
    return { status: "error", message: "הסיסמאות לא תואמות" };
  }

  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    redirect("/login");
  }

  const { error } = await supabase.auth.updateUser({ password });
  if (error) {
    if (error.code === "same_password") {
      return { status: "error", message: "הסיסמה החדשה זהה לסיסמה הקודמת" };
    }
    if (error.code === "weak_password") {
      return { status: "error", message: "הסיסמה חלשה מדי. נסה סיסמה ארוכה או מגוונת יותר." };
    }
    console.error("updateUser(password) failed:", error.code ?? error.status, error.message);
    return { status: "error", message: GENERIC_ERROR };
  }

  redirect("/");
}
