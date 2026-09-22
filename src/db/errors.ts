export function sqlState(error: unknown): string | undefined {
  if (typeof error !== "object" || error === null || !("code" in error)) {
    return undefined;
  }

  return typeof error.code === "string" ? error.code : undefined;
}

export class AmbiguousResultError extends Error {
  constructor(cause: unknown) {
    super(
      "CockroachDB could not confirm whether the transaction committed. Reconcile by operation ID before retrying.",
      { cause },
    );
    this.name = "AmbiguousResultError";
  }
}

export function abortError(): DOMException {
  return new DOMException("The operation was aborted", "AbortError");
}
