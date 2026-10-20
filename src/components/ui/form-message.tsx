type FormMessageProps = {
  status: "idle" | "success" | "error";
  message?: string;
};

export function FormMessage({ status, message }: FormMessageProps) {
  if (status === "idle" || !message) {
    return null;
  }
  const isError = status === "error";
  return (
    <p
      role={isError ? "alert" : "status"}
      className={`rounded-xl border px-3 py-2 text-sm ${
        isError
          ? "border-danger/40 bg-danger/10 text-danger"
          : "border-primary/40 bg-primary/10 text-accent"
      }`}
    >
      {message}
    </p>
  );
}
