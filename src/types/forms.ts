// Result returned by Server Actions to forms (via useActionState).
export type FormState = {
  status: "idle" | "success" | "error";
  message?: string;
  // Submitted values to refill the form after an error (never passwords).
  fields?: Record<string, string>;
};
