"use client";

import Link from "next/link";
import { useActionState } from "react";
import { Field } from "@/components/ui/field";
import { FormMessage } from "@/components/ui/form-message";
import { SubmitButton } from "@/components/ui/submit-button";
import { initialFormState } from "@/lib/forms";
import { requestPasswordReset } from "./actions";

export function ForgotPasswordForm() {
  const [state, formAction] = useActionState(requestPasswordReset, initialFormState);

  return (
    <form action={formAction} className="flex flex-col gap-4">
      <FormMessage status={state.status} message={state.message} />

      <Field
        label="מייל"
        name="email"
        type="email"
        dir="ltr"
        autoComplete="email"
        required
        defaultValue={state.fields?.email}
      />

      <SubmitButton pendingText="שולח…" className="mt-2 w-full">
        שליחת קישור לאיפוס
      </SubmitButton>

      <Link href="/login" className="self-center py-2 text-sm text-accent hover:text-text">
        חזרה להתחברות
      </Link>
    </form>
  );
}
