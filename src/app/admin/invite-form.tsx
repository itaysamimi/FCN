"use client";

import { useActionState } from "react";
import { Field } from "@/components/ui/field";
import { FormMessage } from "@/components/ui/form-message";
import { SubmitButton } from "@/components/ui/submit-button";
import { initialFormState } from "@/lib/forms";
import { inviteMember } from "./actions";

export function InviteForm() {
  const [state, formAction] = useActionState(inviteMember, initialFormState);

  return (
    <form action={formAction} className="flex flex-col gap-4">
      <FormMessage status={state.status} message={state.message} />
      <div className="grid gap-4 sm:grid-cols-2">
        <Field
          label="שם"
          name="display_name"
          autoComplete="off"
          maxLength={50}
          required
          defaultValue={state.fields?.display_name}
        />
        <Field
          label="מייל"
          name="email"
          type="email"
          dir="ltr"
          autoComplete="off"
          required
          defaultValue={state.fields?.email}
        />
      </div>
      <SubmitButton pendingText="שולח הזמנה…" className="sm:self-start">
        שליחת הזמנה
      </SubmitButton>
    </form>
  );
}
