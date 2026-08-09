"use client";

import React, { useId } from "react";
import { AlertTriangle, ShieldAlert, Info, Loader2 } from "lucide-react";
import { useDialogFocus } from "@/hooks/useDialogFocus";

interface ConfirmModalProps {
  isOpen: boolean;
  title: string;
  description: string;
  confirmText?: string;
  cancelText?: string;
  variant?: "danger" | "warning" | "info";
  onConfirm: () => void | Promise<void>;
  onCancel: () => void;
  loading?: boolean;
}

export default function ConfirmModal({
  isOpen,
  title,
  description,
  confirmText = "Confirm",
  cancelText = "Cancel",
  variant = "danger",
  onConfirm,
  onCancel,
  loading = false,
}: ConfirmModalProps) {
  const titleId = useId();
  const descriptionId = useId();
  const dialogRef = useDialogFocus<HTMLDivElement>(isOpen, () => {
    if (!loading) onCancel();
  });

  if (!isOpen) return null;

  const getVariantStyles = () => {
    switch (variant) {
      case "danger":
        return {
          iconBg: "bg-red-500/10 border-red-500/20",
          iconColor: "text-red-400",
          buttonBg: "bg-red-500 hover:bg-red-600 text-white",
          Icon: ShieldAlert,
        };
      case "warning":
        return {
          iconBg: "bg-amber-500/10 border-amber-500/20",
          iconColor: "text-amber-400",
          buttonBg: "bg-amber-500 hover:bg-amber-600 text-slate-950 font-bold",
          Icon: AlertTriangle,
        };
      case "info":
      default:
        return {
          iconBg: "bg-blue-500/10 border-blue-500/20",
          iconColor: "text-blue-400",
          buttonBg: "bg-blue-500 hover:bg-blue-600 text-white",
          Icon: Info,
        };
    }
  };

  const { iconBg, iconColor, buttonBg, Icon } = getVariantStyles();

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-labelledby={titleId}
      aria-describedby={descriptionId}
      className="fixed inset-0 z-[250] flex items-center justify-center p-4 bg-black/70 backdrop-blur-sm animate-in fade-in duration-150"
      onClick={() => !loading && onCancel()}
    >
      <div
        ref={dialogRef}
        tabIndex={-1}
        className="w-full max-w-sm rounded-2xl p-5 shadow-2xl flex flex-col gap-4 border border-white/10"
        style={{ background: "rgba(18, 20, 29, 0.98)" }}
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-start gap-3.5">
          <div className={`w-10 h-10 rounded-xl flex items-center justify-center border shrink-0 ${iconBg}`}>
            <Icon className={`w-5 h-5 ${iconColor}`} />
          </div>
          <div className="flex flex-col gap-1 min-w-0">
            <h3 id={titleId} className="font-bold text-sm text-white tracking-tight leading-snug">{title}</h3>
            <p id={descriptionId} className="text-xs text-white/60 leading-relaxed">{description}</p>
          </div>
        </div>

        <div className="flex items-center justify-end gap-2.5 pt-2 border-t border-white/5">
          <button
            type="button"
            data-autofocus
            disabled={loading}
            onClick={onCancel}
            className="px-4 py-2.5 rounded-xl text-xs font-semibold text-white/70 hover:text-white bg-white/5 hover:bg-white/10 transition-colors disabled:opacity-50"
          >
            {cancelText}
          </button>
          <button
            type="button"
            disabled={loading}
            onClick={onConfirm}
            className={`px-4 py-2.5 rounded-xl text-xs font-semibold shadow-lg transition-all flex items-center gap-2 disabled:opacity-50 ${buttonBg}`}
          >
            {loading && <Loader2 className="w-3.5 h-3.5 animate-spin" />}
            {confirmText}
          </button>
        </div>
      </div>
    </div>
  );
}
