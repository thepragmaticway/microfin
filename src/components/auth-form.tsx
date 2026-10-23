"use client";
import { useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { Action, Field, Notice, ThemeToggle } from "./ui";
import { api } from "@/lib/api";
export function AuthForm({
  recovery = false,
  confirmationError = false,
}: {
  recovery?: boolean;
  confirmationError?: boolean;
}) {
  const router = useRouter();
  const [mode, setMode] = useState<
      "login" | "register" | "recover" | "password"
    >(recovery ? "password" : "login"),
    [busy, setBusy] = useState(false),
    [message, setMessage] = useState(""),
    [error, setError] = useState(
      confirmationError
        ? "Confirmation link expired. Request a fresh link."
        : "",
    );
  return (
    <main id="main" className="auth-wrap">
      <div className="auth-top">
        <Link href="/" className="brand">
          <span className="brand-icon">m</span> microfin
        </Link>
        <ThemeToggle />
      </div>
      <section className="auth-card panel">
        <div className="eyebrow">A LITTLE CLARITY FOR YOUR MONEY</div>
        <h1>
          {mode === "register"
            ? "Make room for what matters."
            : mode === "recover"
              ? "Find your way back."
              : mode === "password"
                ? "A fresh start."
                : "Good to see you."}
        </h1>
        <p className="muted">
          {mode === "register"
            ? "Personal life. Small business. Separate spaces, one clear picture."
            : mode === "recover"
              ? "We’ll email you a link to reset your password."
              : mode === "password"
                ? "Choose a new password for your account."
                : "Your money, across currencies. All in one calm place."}
        </p>
        <form
          onSubmit={async (e) => {
            e.preventDefault();
            setBusy(true);
            setError("");
            setMessage("");
            const form = new FormData(e.currentTarget);
            try {
              const result = await api<{ message: string }>("/api/auth", {
                action: mode,
                ...(mode !== "password" ? { email: form.get("email") } : {}),
                ...(!["recover"].includes(mode)
                  ? { password: form.get("password") }
                  : {}),
                ...(mode === "register"
                  ? { display_name: form.get("display_name") }
                  : {}),
              });
              setMessage(result.message);
              if (mode === "login") {
                router.push("/");
                router.refresh();
              }
            } catch (error) {
              setError((error as Error).message);
            } finally {
              setBusy(false);
            }
          }}
        >
          {mode === "register" && (
            <Field label="Your name">
              <input
                name="display_name"
                autoComplete="name"
                maxLength={100}
                required
              />
            </Field>
          )}
          {mode !== "password" && (
            <Field label="Email address">
              <input
                name="email"
                type="email"
                autoComplete="email"
                required
                maxLength={254}
              />
            </Field>
          )}
          {mode !== "recover" && (
            <Field
              label={mode === "password" ? "New password" : "Password"}
              hint="At least 10 characters"
            >
              <input
                name="password"
                type="password"
                minLength={10}
                maxLength={128}
                autoComplete={
                  mode === "login" ? "current-password" : "new-password"
                }
                required
              />
            </Field>
          )}
          <Notice message={error} error />
          <Notice message={message} />
          <Action type="submit" isDisabled={busy} className="wide">
            {busy
              ? "One moment…"
              : mode === "login"
                ? "Sign in →"
                : mode === "register"
                  ? "Create account →"
                  : mode === "recover"
                    ? "Send recovery link"
                    : "Update password"}
          </Action>
        </form>
        <div className="auth-links">
          {mode !== "login" ? (
            <button
              onClick={() => {
                setMode("login");
                setError("");
                setMessage("");
              }}
            >
              Back to sign in
            </button>
          ) : (
            <>
              <button onClick={() => setMode("register")}>
                Create an account
              </button>
              <button onClick={() => setMode("recover")}>
                Forgot password?
              </button>
            </>
          )}
        </div>
      </section>
      <p className="auth-note">A clear view. A lighter day.</p>
    </main>
  );
}
