"use client";

import React, { useState, useRef, useEffect } from "react";
import { ChevronDown, Check } from "lucide-react";

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
  const [isOpen, setIsOpen] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);

  const selectedOption = options.find((opt) => opt.value === value);

  useEffect(() => {
    const handleClickOutside = (event: MouseEvent) => {
      if (containerRef.current && !containerRef.current.contains(event.target as Node)) {
        setIsOpen(false);
      }
    };

    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        setIsOpen(false);
      }
    };

    if (isOpen) {
      document.addEventListener("mousedown", handleClickOutside);
      document.addEventListener("keydown", handleKeyDown);
    }

    return () => {
      document.removeEventListener("mousedown", handleClickOutside);
      document.removeEventListener("keydown", handleKeyDown);
    };
  }, [isOpen]);

  return (
    <div ref={containerRef} className={`relative w-full ${className}`} style={style}>
      <button
        type="button"
        disabled={disabled}
        aria-label={ariaLabel}
        aria-expanded={isOpen}
        onClick={() => setIsOpen((prev) => !prev)}
        className={`w-full flex items-center justify-between gap-2 px-3.5 py-2.5 rounded-xl text-xs font-semibold transition-all outline-none ${
          disabled ? "opacity-50 cursor-not-allowed" : "cursor-pointer hover:border-white/30"
        } ${isOpen ? "ring-2 ring-blue-500/40 border-blue-500/60" : ""}`}
        style={{
          background: style?.background ?? "var(--surface-3, #09090b)",
          color: selectedOption ? "var(--text-primary, #ffffff)" : "var(--text-ghost, rgba(255, 255, 255, 0.4))",
          border: style?.border ?? "1px solid var(--border-default, rgba(255, 255, 255, 0.1))",
        }}
      >
        <span className="truncate">{selectedOption ? selectedOption.label : placeholder}</span>
        <ChevronDown
          className={`w-4 h-4 shrink-0 transition-transform duration-200 ${isOpen ? "rotate-180 text-blue-400" : "text-white/40"}`}
        />
      </button>

      {isOpen && !disabled && (
        <div
          className="absolute left-0 right-0 top-[calc(100%+4px)] z-[150] max-h-56 overflow-y-auto rounded-xl p-1.5 shadow-2xl backdrop-blur-md transition-all"
          style={{
            background: "rgba(18, 20, 29, 0.96)",
            border: "1px solid rgba(255, 255, 255, 0.12)",
            boxShadow: "0 12px 36px rgba(0, 0, 0, 0.6)",
          }}
        >
          {options.length === 0 ? (
            <div className="px-3 py-2 text-xs text-white/40 text-center font-medium">No options available</div>
          ) : (
            options.map((opt) => {
              const isSelected = opt.value === value;
              return (
                <button
                  key={opt.value}
                  type="button"
                  onClick={() => {
                    onChange(opt.value);
                    setIsOpen(false);
                  }}
                  className={`w-full flex items-center justify-between px-3 py-2 rounded-lg text-xs font-medium transition-colors text-left ${
                    isSelected
                      ? "bg-blue-600/20 text-blue-400 font-semibold"
                      : "text-white/80 hover:bg-white/10 hover:text-white"
                  }`}
                >
                  <span className="truncate">{opt.label}</span>
                  {isSelected && <Check className="w-3.5 h-3.5 shrink-0 text-blue-400 ml-2" />}
                </button>
              );
            })
          )}
        </div>
      )}
    </div>
  );
}
