"use client";

import { useEffect, useRef, type RefObject } from "react";

const FOCUSABLE = [
  "button:not([disabled])",
  "[href]",
  "input:not([disabled])",
  "select:not([disabled])",
  "textarea:not([disabled])",
  "[tabindex]:not([tabindex='-1'])",
].join(",");

const dialogStack: symbol[] = [];
let openDialogCount = 0;
let originalBodyOverflow = "";

/** Provides focus containment, Escape handling, scroll lock, and restoration. */
export function useDialogFocus<T extends HTMLElement>(
  isOpen: boolean,
  onRequestClose: () => void,
): RefObject<T | null> {
  const dialogRef = useRef<T>(null);
  const closeRef = useRef(onRequestClose);

  useEffect(() => {
    closeRef.current = onRequestClose;
  }, [onRequestClose]);

  useEffect(() => {
    if (!isOpen) return;
    const dialogId = Symbol("dialog");
    const previouslyFocused = document.activeElement as HTMLElement | null;
    dialogStack.push(dialogId);
    if (openDialogCount === 0) {
      originalBodyOverflow = document.body.style.overflow;
      document.body.style.overflow = "hidden";
    }
    openDialogCount += 1;

    const focusFirst = () => {
      const dialog = dialogRef.current;
      if (!dialog) return;
      const preferred = dialog.querySelector<HTMLElement>("[data-autofocus]");
      const first = preferred ?? dialog.querySelector<HTMLElement>(FOCUSABLE);
      (first ?? dialog).focus();
    };
    const frame = requestAnimationFrame(focusFirst);

    const handleKeyDown = (event: KeyboardEvent) => {
      if (dialogStack.at(-1) !== dialogId) return;
      if (event.key === "Escape") {
        event.preventDefault();
        closeRef.current();
        return;
      }
      if (event.key !== "Tab") return;
      const dialog = dialogRef.current;
      if (!dialog) return;
      const focusable = Array.from(dialog.querySelectorAll<HTMLElement>(FOCUSABLE));
      if (focusable.length === 0) {
        event.preventDefault();
        dialog.focus();
        return;
      }
      const first = focusable[0];
      const last = focusable[focusable.length - 1];
      if (event.shiftKey && document.activeElement === first) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault();
        first.focus();
      }
    };
    document.addEventListener("keydown", handleKeyDown);

    return () => {
      cancelAnimationFrame(frame);
      document.removeEventListener("keydown", handleKeyDown);
      const stackIndex = dialogStack.lastIndexOf(dialogId);
      if (stackIndex >= 0) dialogStack.splice(stackIndex, 1);
      openDialogCount = Math.max(0, openDialogCount - 1);
      if (openDialogCount === 0) {
        document.body.style.overflow = originalBodyOverflow;
        previouslyFocused?.focus();
      }
    };
  }, [isOpen]);

  return dialogRef;
}
