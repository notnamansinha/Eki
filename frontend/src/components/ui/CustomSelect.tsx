"use client";

import React from "react";
import { ChevronDown } from "lucide-react";

export interface CustomSelectOption {
  value: string;
  label: string;
}

interface CustomSelectProps {
  value: string;
  onChange: (value: string) => void;
  options: CustomSelectOption[];
  placeholder?: string;
  disabled?: boolean;
  className?: string;
  ariaLabel?: string;
  style?: React.CSSProperties;
}

export default function CustomSelect({
  value,
  onChange,
  options,
  placeholder = "Select an option…",
  disabled = false,
  className = "",
  ariaLabel,
  style,
}: CustomSelectProps) {
  return (
    <div className={`relative w-full ${className}`} style={style}>
      <select
        value={value}
        disabled={disabled}
        aria-label={ariaLabel ?? placeholder}
        onChange={(event) => onChange(event.target.value)}
        className={`w-full appearance-none px-3.5 py-2.5 pr-10 rounded-xl text-xs font-semibold transition-all outline-none ${
          disabled ? "opacity-50 cursor-not-allowed" : "cursor-pointer hover:border-white/30"
        } focus-visible:ring-2 focus-visible:ring-blue-500/40 focus-visible:border-blue-500/60`}
        style={{
          background: style?.background ?? "var(--surface-3, #09090b)",
          color: value ? "var(--text-primary, #ffffff)" : "var(--text-ghost, rgba(255, 255, 255, 0.4))",
          border: style?.border ?? "1px solid var(--border-default, rgba(255, 255, 255, 0.1))",
        }}
      >
        {!value && !options.some((option) => option.value === "") && (
          <option value="" disabled>{placeholder}</option>
        )}
        {options.map((option) => (
          <option key={option.value} value={option.value}>{option.label}</option>
        ))}
      </select>
      <ChevronDown aria-hidden="true" className="pointer-events-none absolute right-3.5 top-1/2 h-4 w-4 -translate-y-1/2 text-white/40" />
    </div>
  );
}
