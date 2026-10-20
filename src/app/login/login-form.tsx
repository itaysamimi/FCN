"use client";

import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { useActionState } from "react";
import { Field } from "@/components/ui/field";
import { FormMessage } from "@/components/ui/form-message";
import { SubmitButton } from "@/components/ui/submit-button";
import { initialFormState } from "@/lib/forms";
import { signIn } from "./actions";

// Shown after /auth/confirm rejects an invite or reset link.
export function LinkErrorNotice() {
  const linkError = useSearchParams().get("error") === "link";
  if (!linkError) {
    return null;
  }
  return (
    <div className="mb-4">
      <FormMessage
        status="error"
        message={'הקישור לא תקין או שפג תוקפו. אפשר לבקש קישור חדש דרך "שכחתי סיסמה".'}
      />
    </div>
  );
}

export function LoginForm() {
  const [state, formAction] = useActionState(signIn, initialFormState);

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
      <Field
        label="סיסמה"
        name="password"
        type="password"
        dir="ltr"
        autoComplete="current-password"
        required
      />

      <SubmitButton pendingText="מתחבר…" className="mt-2 w-full">
        התחברות
      </SubmitButton>

      <Link
        href="/forgot-password"
        className="self-center py-2 text-sm text-accent hover:text-text"
      >
        שכחתי סיסמה
      </Link>
    </form>
  );
}
