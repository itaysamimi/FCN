import type { Metadata } from "next";
import { AuthCard } from "@/components/ui/auth-card";
import { SetPasswordForm } from "./set-password-form";

export const metadata: Metadata = {
  title: "בחירת סיסמה | FCN",
};

// Reached from an invite or reset link (via /auth/confirm). The proxy ensures
// the visitor is signed in; the action checks again before saving.
export default function SetPasswordPage() {
  return (
    <AuthCard title="בחירת סיסמה" subtitle="בחר סיסמה שתשמש אותך להתחברות">
      <SetPasswordForm />
    </AuthCard>
  );
}
