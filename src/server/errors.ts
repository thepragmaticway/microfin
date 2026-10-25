export class AppError extends Error {
  constructor(
    message: string,
    public status = 400,
  ) {
    super(message);
  }
}
export function databaseError(error: {
  code?: string;
  message: string;
}): never {
  // Database errors may include internal SQL or values. Expose only intentional
  // domain failures and a neutral message for constraints/infrastructure failures.
  if (error.code === "42501")
    throw new AppError("Workspace or record not found", 403);
  if (error.code === "P0001")
    throw new AppError(error.message.slice(0, 300), 409);
  if (
    ["23514", "23503", "23502", "22P02", "22003", "22007", "22008"].includes(
      error.code ?? "",
    )
  )
    throw new AppError("Check the account, currency, dates and amounts", 400);
  if (error.code === "23505")
    throw new AppError(
      "This identifier is already in use. Refresh and try again",
      409,
    );
  throw new AppError(
    "We could not complete that request. Please try again",
    503,
  );
}
