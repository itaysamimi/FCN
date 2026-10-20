"use client";

import { useActionState } from "react";
import { SubmitButton } from "@/components/ui/submit-button";
import { initialFormState } from "@/lib/forms";
import { resendInvite } from "./actions";

export function ResendInviteButton({ userId }: { userId: string }) {
  const [state, formAction] = useActionState(resendInvite, initialFormState);

  return (
    <form action={formAction} className="flex flex-col items-start gap-1">
      <input type="hidden" name="user_id" value={userId} />
      <SubmitButton pendingText="שולח…" variant="secondary" className="h-11 text-sm">
        שלח הזמנה שוב
      </SubmitButton>
      {state.message && (
        <p
          role={state.status === "error" ? "alert" : "status"}
          className={`text-xs ${state.status === "error" ? "text-danger" : "text-accent"}`}
        >
          {state.message}
        </p>
      )}
    </form>
  );
}
