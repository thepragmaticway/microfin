import "server-only";
import { createServerClient } from "@supabase/ssr";
import { cookies } from "next/headers";
import { AppError } from "./errors";
export function authConfig() {
  const url = process.env.SUPABASE_PROJ_URL;
  const key = process.env.SUPABASE_PUB_KEY;
  if (!url || !key)
    throw new AppError("Server authentication is not configured", 503);
  return { url, key };
}
export async function authClient() {
  const { url, key } = authConfig(),
    jar = await cookies();
  return createServerClient(url, key, {
    cookies: {
      getAll: () => jar.getAll(),
      setAll: (values) => {
        for (const { name, value, options } of values)
          jar.set(name, value, {
            ...options,
            httpOnly: true,
            sameSite: "lax",
            secure: process.env.NODE_ENV === "production",
          });
      },
    },
  });
}
export async function verifiedClient() {
  const client = await authClient();
  const { data, error } = await client.auth.getUser();
  if (error || !data.user)
    throw new AppError("Please sign in to continue", 401);
  return { client, user: data.user };
}
