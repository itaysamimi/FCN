import type { FormState } from "@/types/forms";

export const initialFormState: FormState = { status: "idle" };

const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export function readField(formData: FormData, name: string) {
  const value = formData.get(name);
  return typeof value === "string" ? value.trim() : "";
}

export function isValidEmail(email: string) {
  return email.length <= 254 && EMAIL_PATTERN.test(email);
}
