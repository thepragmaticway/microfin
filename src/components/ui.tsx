"use client";
import { Button } from "@heroui/react";
import {
  cloneElement,
  isValidElement,
  useId,
  type ComponentProps,
  type ReactNode,
  type ReactElement,
} from "react";
export function Action({ children, ...props }: ComponentProps<typeof Button>) {
  return <Button {...props}>{children}</Button>;
}
export function Field({
  label,
  children,
  hint,
}: {
  label: string;
  children: ReactNode;
  hint?: string;
}) {
  const id = useId();
  return (
    <div className="field">
      <label htmlFor={id}>{label}</label>
      {isValidElement(children)
        ? cloneElement(
            children as ReactElement<{
              id: string;
              "aria-describedby"?: string;
            }>,
            { id, "aria-describedby": hint ? `${id}-hint` : undefined },
          )
        : children}
      {hint && <small id={`${id}-hint`}>{hint}</small>}
    </div>
  );
}
export function Notice({
  message,
  error = false,
}: {
  message: string;
  error?: boolean;
}) {
  return message ? (
    <div
      role={error ? "alert" : "status"}
      className={`notice ${error ? "error" : "success"}`}
    >
      {message}
    </div>
  ) : null;
}
export function ThemeToggle() {
  return (
    <Action
      variant="tertiary"
      aria-label="Switch color theme"
      onPress={() => {
        const dark = !document.documentElement.classList.contains("dark");
        document.documentElement.classList.toggle("dark", dark);
        localStorage.setItem("microfin-theme", dark ? "dark" : "light");
      }}
    >
      ◐ <span className="theme-text">Theme</span>
    </Action>
  );
}
export function Empty({
  title,
  children,
}: {
  title: string;
  children: ReactNode;
}) {
  return (
    <div className="empty">
      <span className="empty-icon">✦</span>
      <h3>{title}</h3>
      <p>{children}</p>
    </div>
  );
}
