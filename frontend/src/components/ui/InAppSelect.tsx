"use client";

import { useEffect, useId, useRef, useState, type CSSProperties, type KeyboardEvent } from "react";
import { Check, ChevronDown } from "lucide-react";
import type { CustomSelectOption } from "./CustomSelect";

interface Props {
  name: string;
  value: string;
  onChange: (value: string) => void;
  options: (CustomSelectOption & { detail?: string; completed?: boolean })[];
  placeholder?: string;
  disabled?: boolean;
  ariaLabel: string;
  style?: CSSProperties;
}

type Popup = { activeValue: string; above: boolean; maxHeight: number };

/** Passenger map picker: the options stay in the page instead of an OS dialog. */
export default function InAppSelect({ name, value, onChange, options, placeholder = "Choose an option…", disabled = false, ariaLabel, style }: Props) {
  const id = useId();
  const rootRef = useRef<HTMLDivElement>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const listRef = useRef<HTMLUListElement>(null);
  const searchRef = useRef({ text: "", at: 0 });
  const [popup, setPopup] = useState<Popup | null>(null);
  const unavailable = disabled || options.length === 0;
  const [wasUnavailable, setWasUnavailable] = useState(unavailable);
  // Do not restore an old popup when a join finishes or the live roster returns.
  if (wasUnavailable !== unavailable) {
    setWasUnavailable(unavailable);
    if (unavailable) setPopup(null);
  }
  const open = popup !== null && !unavailable;
  const selected = options.find(option => option.value === value);
  const activeIndex = Math.max(0, options.findIndex(option => option.value === (popup?.activeValue ?? value)));

  function openAt(index = Math.max(0, options.findIndex(option => option.value === value))) {
    if (disabled || !options.length) return;
    const rect = triggerRef.current?.getBoundingClientRect();
    const viewport = window.visualViewport;
    const top = viewport?.offsetTop ?? 0;
    const bottom = top + (viewport?.height ?? window.innerHeight);
    const below = Math.max(44, bottom - (rect?.bottom ?? 0) - 12);
    const aboveSpace = Math.max(44, (rect?.top ?? 0) - top - 12);
    const above = below < Math.min(132, options.length * 44) && aboveSpace > below;
    searchRef.current = { text: "", at: 0 };
    setPopup({ activeValue: options[index].value, above, maxHeight: Math.min(256, above ? aboveSpace : below) });
  }

  function choose(nextValue: string) {
    setPopup(null);
    onChange(nextValue);
  }

  useEffect(() => {
    if (!open) return;
    const outside = (event: PointerEvent) => {
      if (event.target instanceof Node && !rootRef.current?.contains(event.target)) setPopup(null);
    };
    const resized = () => setPopup(null);
    document.addEventListener("pointerdown", outside);
    window.addEventListener("resize", resized);
    window.visualViewport?.addEventListener("resize", resized);
    return () => {
      document.removeEventListener("pointerdown", outside);
      window.removeEventListener("resize", resized);
      window.visualViewport?.removeEventListener("resize", resized);
    };
  }, [open]);

  useEffect(() => {
    if (open) listRef.current?.children[activeIndex]?.scrollIntoView?.({ block: "nearest" });
  }, [open, activeIndex]);

  function handleKeyDown(event: KeyboardEvent<HTMLButtonElement>) {
    if (disabled || !options.length) return;
    if (event.key === "Escape") {
      if (open) { event.preventDefault(); event.stopPropagation(); setPopup(null); }
      return;
    }
    if (event.key === "Tab") {
      if (open) choose(options[activeIndex].value);
      return;
    }
    if (event.key === "Enter" || event.key === " ") {
      event.preventDefault();
      if (open) choose(options[activeIndex].value); else openAt();
      return;
    }
    const offsets: Record<string, number> = { ArrowDown: 1, ArrowUp: -1, PageDown: 10, PageUp: -10 };
    if (event.key in offsets || event.key === "Home" || event.key === "End") {
      event.preventDefault();
      const next = event.key === "Home" ? 0 : event.key === "End" ? options.length - 1
        : open ? Math.max(0, Math.min(options.length - 1, activeIndex + offsets[event.key]))
        : Math.max(0, options.findIndex(option => option.value === value));
      if (open) setPopup(current => current && { ...current, activeValue: options[next].value });
      else openAt(next);
      return;
    }
    if (event.key.length === 1 && !event.altKey && !event.ctrlKey && !event.metaKey) {
      event.preventDefault();
      const now = Date.now();
      const previous = now - searchRef.current.at < 700 ? searchRef.current.text : "";
      const text = previous + event.key.toLocaleLowerCase();
      const repeated = Array.from(text).every(character => character === text[0]);
      const prefix = repeated ? text[0] : text;
      const start = repeated ? activeIndex + 1 : activeIndex;
      const match = options.findIndex((_, offset) => options[(start + offset) % options.length].label.toLocaleLowerCase().startsWith(prefix));
      if (match >= 0) {
        const index = (start + match) % options.length;
        if (open) setPopup(current => current && { ...current, activeValue: options[index].value });
        else openAt(index);
      }
      searchRef.current = { text, at: now };
    }
  }

  return (
    <div ref={rootRef} className={`relative w-full min-w-0 ${open ? "z-50" : ""}`} onBlur={event => {
      if (!event.currentTarget.contains(event.relatedTarget)) setPopup(null);
    }}>
      <input type="hidden" name={name} value={value} disabled={disabled} />
      <button
        ref={triggerRef}
        type="button"
        role="combobox"
        aria-label={ariaLabel}
        aria-describedby={selected?.detail ? `${id}-selected-detail` : undefined}
        aria-haspopup="listbox"
        aria-expanded={open}
        aria-controls={open ? `${id}-list` : undefined}
        aria-activedescendant={open ? `${id}-option-${activeIndex}` : undefined}
        disabled={disabled || options.length === 0}
        onClick={() => open ? setPopup(null) : openAt()}
        onKeyDown={handleKeyDown}
        className="flex min-h-11 w-full items-center gap-2 rounded-xl px-3.5 py-2.5 text-left text-sm font-medium cursor-pointer disabled:cursor-not-allowed disabled:opacity-50 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--accent)]"
        style={{ background: "var(--surface-1, #09090b)", color: "var(--text-primary, #fff)", border: "1px solid var(--border-default, #3f3f46)", ...style }}
      >
        <span className="min-w-0 flex-1 truncate">{selected?.label ?? placeholder}</span>
        {selected?.detail && <span id={`${id}-selected-detail`} className="shrink-0 tabular-nums" style={{ color: "var(--text-secondary)" }}>{selected.detail}</span>}
        <ChevronDown aria-hidden="true" className={`h-4 w-4 shrink-0 ${open ? "rotate-180" : ""}`} />
      </button>
      {open && popup && (
        <ul
          ref={listRef}
          id={`${id}-list`}
          role="listbox"
          aria-label={ariaLabel}
          onMouseDown={event => event.preventDefault()}
          className={`absolute left-0 right-0 overflow-y-auto overscroll-contain rounded-xl p-1 shadow-xl ${popup.above ? "bottom-full mb-1" : "top-full mt-1"}`}
          style={{ maxHeight: popup.maxHeight, background: "var(--surface-1, #09090b)", color: "var(--text-primary, #fff)", border: "1px solid var(--border-default, #3f3f46)" }}
        >
          {options.map((option, index) => (
            <li
              key={option.value}
              id={`${id}-option-${index}`}
              role="option"
              aria-label={option.label}
              aria-describedby={option.detail ? `${id}-detail-${index}` : undefined}
              aria-selected={option.value === value}
              onClick={() => { choose(option.value); triggerRef.current?.focus({ preventScroll: true }); }}
              className="flex min-h-11 cursor-pointer items-center gap-2 rounded-lg px-3 py-2 text-sm font-medium hover:bg-[var(--surface-3)]"
              style={{ background: index === activeIndex ? "var(--surface-4, #27272a)" : undefined, overflowWrap: "anywhere", color: option.completed ? "var(--text-secondary, #a1a1aa)" : undefined }}
            >
              <span className="min-w-0 flex-1">{option.label}</span>
              {option.detail && <span id={`${id}-detail-${index}`} className="shrink-0 tabular-nums" style={{ color: "var(--text-secondary, #a1a1aa)" }}>{option.detail}</span>}
              {option.value === value && <Check aria-hidden="true" className="h-4 w-4 shrink-0" />}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
