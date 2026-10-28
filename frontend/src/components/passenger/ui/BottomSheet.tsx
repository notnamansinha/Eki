import React, { ReactNode, useEffect, useId, useRef } from 'react';
import { ChevronUp, ChevronDown } from 'lucide-react';
import { passengerNavClearance } from '../passengerFrame';

interface BottomSheetProps {
  isOpen: boolean;
  onToggle: () => void;
  headerIcon?: ReactNode;
  headerTitle: string;
  children: ReactNode;
  bottomControls?: ReactNode;
  maxHeightClass?: string;
}

export default function BottomSheet({
  isOpen,
  onToggle,
  headerIcon,
  headerTitle,
  children,
  bottomControls,
  maxHeightClass = "max-h-[50vh]",
}: BottomSheetProps) {
  const contentId = useId();
  const toggleRef = useRef<HTMLButtonElement>(null);
  useEffect(() => {
    if (!isOpen) return;
    const close = (event: KeyboardEvent) => {
      if (event.key !== "Escape") return;
      event.preventDefault();
      onToggle();
      toggleRef.current?.focus();
    };
    window.addEventListener("keydown", close);
    return () => window.removeEventListener("keydown", close);
  }, [isOpen, onToggle]);
  return (
    <>
      {/* Backdrop */}
      {isOpen && (
        <button
          type="button"
          aria-label={`Close ${headerTitle}`}
          className="fixed inset-0 z-40 transition-opacity animate-fade-in"
          style={{ background: "rgba(0, 0, 0, 0.5)" }}
          onClick={onToggle}
        />
      )}

      {/* Sheet */}
      <div
        data-map-sheet
        className={`fixed inset-x-0 z-50 rounded-t-2xl transition-transform duration-500 ease-[cubic-bezier(0.32,0.72,0,1)] ${
          isOpen ? "translate-y-0" : "translate-y-[calc(100%_-_56px)]"
        }`}
        style={{
          bottom: passengerNavClearance,
          background: "var(--surface-1)",
          borderTop: "1px solid var(--border-default)",
          boxShadow: "0 -8px 32px rgba(0, 0, 0, 0.4)",
          paddingBottom: "env(safe-area-inset-bottom)",
        }}
      >
        {/* Handle + Header */}
        <button
          type="button"
          ref={toggleRef}
          aria-expanded={isOpen}
          aria-controls={contentId}
          className="w-full h-[56px] flex items-center justify-between px-5 cursor-pointer relative"
          onClick={onToggle}
        >
          {/* Drag handle */}
          <div className="absolute top-2 left-1/2 -translate-x-1/2 w-10 h-1 rounded-full" 
            style={{ background: "var(--surface-4)" }} />
          
          <div className="flex items-center w-full justify-between mt-1">
            <div className="flex items-center gap-2.5">
              {headerIcon && <div style={{ color: "var(--text-ghost)" }}>{headerIcon}</div>}
              <span className="text-[12px] font-semibold tracking-wide" style={{ color: "var(--text-secondary)" }}>
                {headerTitle}
              </span>
            </div>
            <div style={{ color: "var(--text-ghost)" }}>
              {isOpen ? <ChevronDown className="w-4 h-4" /> : <ChevronUp className="w-4 h-4" />}
            </div>
          </div>
        </button>

        {/* Content */}
        <div id={contentId} inert={!isOpen} aria-hidden={!isOpen} className={`px-5 pb-5 pt-1 overflow-y-auto ${maxHeightClass}`}>
          {children}
        </div>

        {/* Bottom Controls */}
        {bottomControls && (
          <div inert={!isOpen} aria-hidden={!isOpen} className="p-4" style={{ borderTop: "1px solid var(--border-subtle)", background: "var(--surface-0)" }}>
            {bottomControls}
          </div>
        )}
      </div>
    </>
  );
}
