import type { Metadata } from "next";
import { AuthCard } from "@/components/ui/auth-card";
import { ForgotPasswordForm } from "./forgot-password-form";

export const metadata: Metadata = {
  title: "שכחתי סיסמה | FCN",
};

export default function ForgotPasswordPage() {
  return (
    <AuthCard title="שכחתי סיסמה" subtitle="נשלח לך קישור לבחירת סיסמה חדשה">
      <ForgotPasswordForm />
    </AuthCard>
  );
}
