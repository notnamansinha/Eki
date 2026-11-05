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
  // Collapsed content is already inert; also stop painting it, because the
  // desktop dock floats and leaves the translated body visible around it.
  const bodyVisibility = `transition-opacity duration-200 ${isOpen ? "opacity-100" : "opacity-0"}`;
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
          className="pp-sheet-backdrop fixed inset-0 z-40 transition-opacity animate-fade-in"
          onClick={onToggle}
        />
      )}

      {/* Sheet */}
      <div
        data-map-sheet
        data-open={isOpen || undefined}
        className={`pp-sheet fixed inset-x-0 z-50 transition-transform duration-500 ease-[cubic-bezier(0.32,0.72,0,1)] ${
          isOpen ? "translate-y-0" : "translate-y-[calc(100%_-_56px)]"
        }`}
        style={{
          bottom: passengerNavClearance,
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
          <div className="pp-grabber absolute top-2 left-1/2 -translate-x-1/2 w-9 h-[5px] rounded-full" aria-hidden="true" />
          
          <div className="flex items-center w-full justify-between mt-1">
            <div className="flex items-center gap-2.5">
              {headerIcon && <div aria-hidden="true" style={{ color: "var(--accent)" }}>{headerIcon}</div>}
              <span className="pp-sheet-title">
                {headerTitle}
              </span>
            </div>
            <div aria-hidden="true" style={{ color: "var(--text-secondary)" }}>
              {isOpen ? <ChevronDown className="w-4 h-4" /> : <ChevronUp className="w-4 h-4" />}
            </div>
          </div>
        </button>

        {/* Content */}
        <div id={contentId} inert={!isOpen} aria-hidden={!isOpen} className={`px-5 pb-5 pt-1 overflow-y-auto ${maxHeightClass} ${bodyVisibility}`}>
          {children}
        </div>

        {/* Bottom Controls */}
        {bottomControls && (
          <div inert={!isOpen} aria-hidden={!isOpen} className={`pp-sheet-footer p-4 ${bodyVisibility}`}>
            {bottomControls}
          </div>
        )}
      </div>
    </>
  );
}
