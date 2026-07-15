import React, { ReactNode } from 'react';
import { ChevronUp, ChevronDown } from 'lucide-react';

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
  return (
    <>
      {/* Backdrop */}
      {isOpen && (
        <div
          className="fixed inset-0 z-40 transition-opacity animate-fade-in"
          style={{ background: "rgba(0, 0, 0, 0.5)" }}
          onClick={onToggle}
        />
      )}

      {/* Sheet */}
      <div
        className={`fixed inset-x-0 bottom-[64px] z-50 rounded-t-2xl transition-transform duration-500 ease-[cubic-bezier(0.32,0.72,0,1)] ${
          isOpen ? "translate-y-0" : "translate-y-[calc(100%-56px)]"
        }`}
        style={{
          background: "var(--surface-1)",
          borderTop: "1px solid var(--border-default)",
          boxShadow: "0 -8px 32px rgba(0, 0, 0, 0.4)",
          paddingBottom: "env(safe-area-inset-bottom)",
        }}
      >
        {/* Handle + Header */}
        <div
          className="w-full h-[56px] flex items-center justify-between px-5 cursor-pointer relative"
          onClick={onToggle}
        >
          {/* Drag handle */}
          <div className="absolute top-2 left-1/2 -translate-x-1/2 w-10 h-1 rounded-full" 
            style={{ background: "var(--surface-4)" }} />
          
          <div className="flex items-center w-full justify-between mt-1">
            <div className="flex items-center gap-2.5">
              {headerIcon && <div style={{ color: "var(--text-ghost)" }}>{headerIcon}</div>}
              <span className="text-[12px] font-bold tracking-wide" style={{ color: "var(--text-secondary)" }}>
                {headerTitle}
              </span>
            </div>
            <div style={{ color: "var(--text-ghost)" }}>
              {isOpen ? <ChevronDown className="w-4 h-4" /> : <ChevronUp className="w-4 h-4" />}
            </div>
          </div>
        </div>

        {/* Content */}
        <div className={`px-5 pb-5 pt-1 overflow-y-auto ${maxHeightClass}`}>
          {children}
        </div>

        {/* Bottom Controls */}
        {bottomControls && (
          <div className="p-4" style={{ borderTop: "1px solid var(--border-subtle)", background: "var(--surface-0)" }}>
            {bottomControls}
          </div>
        )}
      </div>
    </>
  );
}
