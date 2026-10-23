"use client";
import { useEffect, useRef, type ReactNode } from "react";
import { Action } from "./ui";
export function Dialog({
  title,
  close,
  children,
}: {
  title: string;
  close: () => void;
  children: ReactNode;
}) {
  const ref = useRef<HTMLDialogElement>(null);
  const opener = useRef<HTMLElement | null>(
    typeof document !== "undefined"
      ? (document.activeElement as HTMLElement)
      : null,
  );
  useEffect(() => {
    const dialog = ref.current!;
    const returnFocus = opener.current;
    dialog.showModal();
    return () => {
      dialog.close();
      if (returnFocus?.isConnected) returnFocus.focus();
    };
  }, []);
  return (
    <dialog
      ref={ref}
      className="dialog"
      onCancel={(e) => {
        e.preventDefault();
        close();
      }}
      aria-label={title}
    >
      <div className="dialog-head">
        <h2>{title}</h2>
        <Action
          isIconOnly
          variant="tertiary"
          aria-label="Close dialog"
          onPress={close}
        >
          ×
        </Action>
      </div>
      <div className="dialog-body">{children}</div>
    </dialog>
  );
}
