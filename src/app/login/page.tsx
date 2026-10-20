import type { Metadata } from "next";
import { Suspense } from "react";
import { AuthCard } from "@/components/ui/auth-card";
import { LinkErrorNotice, LoginForm } from "./login-form";

export const metadata: Metadata = {
  title: "התחברות | FCN",
};

export default function LoginPage() {
  return (
    <AuthCard title="התחברות" subtitle="ברוכים הבאים לענן המשפחתי">
      {/* Reads ?error=link, so it renders at request time; the form stays static. */}
      <Suspense>
        <LinkErrorNotice />
      </Suspense>
      <LoginForm />
    </AuthCard>
  );
}
