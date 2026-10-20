"use client";

import { useActionState } from "react";
import { Field } from "@/components/ui/field";
import { FormMessage } from "@/components/ui/form-message";
import { SubmitButton } from "@/components/ui/submit-button";
import { initialFormState } from "@/lib/forms";
import { setPassword } from "./actions";

export function SetPasswordForm() {
  const [state, formAction] = useActionState(setPassword, initialFormState);

  return (
    <form action={formAction} className="flex flex-col gap-4">
      <FormMessage status={state.status} message={state.message} />

      <Field
        label="סיסמה חדשה"
        name="password"
        type="password"
        dir="ltr"
        autoComplete="new-password"
        minLength={8}
        required
      />
      <Field
        label="אימות סיסמה"
        name="confirm"
        type="password"
        dir="ltr"
        autoComplete="new-password"
        minLength={8}
        required
      />
      <p className="text-xs text-text-muted">8 תווים לפחות</p>

      <SubmitButton pendingText="שומר…" className="mt-2 w-full">
        שמירת סיסמה
      </SubmitButton>
    </form>
  );
}
