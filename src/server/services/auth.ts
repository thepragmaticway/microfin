import "server-only";
import { z } from "zod";
import { authClient, verifiedClient } from "../auth";
import { AppError } from "../errors";
const schema = z
  .object({
    action: z.enum(["login", "register", "logout", "recover", "password"]),
    email: z.email().max(254).optional(),
    password: z
      .string()
      .min(10, "Use at least 10 characters")
      .max(128)
      .optional(),
    display_name: z.string().trim().min(1).max(100).optional(),
  })
  .strict();
export async function authAction(input: unknown, origin: string) {
  const p = schema.parse(input),
    client = await authClient();
  if (p.action === "logout") {
    const { error } = await client.auth.signOut();
    if (error) throw new AppError("Could not sign out. Try again", 503);
    return { message: "Signed out" };
  }
  if (p.action === "password") {
    if (!p.password) throw new AppError("Enter a new password");
    await verifiedClient();
    const { error } = await client.auth.updateUser({ password: p.password });
    if (error)
      throw new AppError(
        "Could not update your password. Request a fresh recovery link",
        400,
      );
    return { message: "Password updated. You can return to your workspaces" };
  }
  if (!p.email) throw new AppError("Enter your email");
  if (p.action === "recover") {
    const { error } = await client.auth.resetPasswordForEmail(p.email, {
      redirectTo: `${origin}/auth/confirm?next=/reset-password`,
    });
    if (error)
      throw new AppError(
        "Could not send recovery email. Please try again later",
        429,
      );
    return {
      message: "If an account exists, a recovery link will arrive by email",
    };
  }
  if (!p.password) throw new AppError("Enter your password");
  if (p.action === "register") {
    const { error } = await client.auth.signUp({
      email: p.email,
      password: p.password,
      options: {
        data: { display_name: p.display_name ?? "Microfin user" },
        emailRedirectTo: `${origin}/auth/confirm`,
      },
    });
    if (error)
      throw new AppError(
        "Registration could not finish. Check your details or try again later",
        400,
      );
    return {
      message: "Check your email to confirm your account, then sign in",
    };
  }
  const { error } = await client.auth.signInWithPassword({
    email: p.email,
    password: p.password,
  });
  if (error) throw new AppError("Email or password was not accepted", 401);
  return { message: "Welcome back" };
}
export async function confirmAuth(url: URL) {
  const client = await authClient(),
    code = url.searchParams.get("code"),
    hash = url.searchParams.get("token_hash"),
    type = url.searchParams.get("type");
  if (code) {
    const { error } = await client.auth.exchangeCodeForSession(code);
    if (error)
      throw new AppError(
        "Confirmation link expired. Request a fresh link",
        400,
      );
  } else if (
    hash &&
    (type === "email" || type === "recovery" || type === "signup")
  ) {
    const { error } = await client.auth.verifyOtp({ token_hash: hash, type });
    if (error)
      throw new AppError(
        "Confirmation link expired. Request a fresh link",
        400,
      );
  } else throw new AppError("Invalid confirmation link", 400);
  return url.searchParams.get("next") === "/reset-password" ||
    type === "recovery"
    ? "/reset-password"
    : "/";
}
