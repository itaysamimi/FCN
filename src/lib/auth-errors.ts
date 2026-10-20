import type { AuthError } from "@supabase/supabase-js";

export const GENERIC_ERROR = "משהו השתבש. נסה שוב בעוד כמה רגעים.";

export function isRateLimitError(error: AuthError) {
  return (
    error.status === 429 ||
    error.code === "over_email_send_rate_limit" ||
    error.code === "over_request_rate_limit"
  );
}

export function isEmailTakenError(error: AuthError) {
  return (
    error.code === "email_exists" ||
    error.code === "user_already_exists" ||
    /already (been )?registered/i.test(error.message)
  );
}
