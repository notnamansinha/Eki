"use client";

import React, { useEffect } from "react";
import { AlertCircle, AlertTriangle, CheckCircle2, Info } from "lucide-react";

interface AlertModalProps {
  isOpen: boolean;
  title?: string;
  message: string;
  buttonText?: string;
  variant?: "error" | "warning" | "info";
  onClose: () => void;
}

export default function AlertModal({
  isOpen,
  title,
  message,
  buttonText = "OK",
  variant = "error",
  onClose,
}: AlertModalProps) {
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape" && isOpen) {
        onClose();
      }
    };
    if (isOpen) {
      document.addEventListener("keydown", handleKeyDown);
    }
    return () => document.removeEventListener("keydown", handleKeyDown);
  }, [isOpen, onClose]);

  if (!isOpen) return null;

  const getVariantStyles = () => {
    switch (variant) {
      case "error":
        return {
          iconBg: "bg-red-500/10 border-red-500/20",
          iconColor: "text-red-400",
          defaultTitle: "Error",
          Icon: AlertCircle,
        };
      case "warning":
        return {
          iconBg: "bg-amber-500/10 border-amber-500/20",
          iconColor: "text-amber-400",
          defaultTitle: "Warning",
          Icon: AlertTriangle,
        };
      case "info":
      default:
        return {
          iconBg: "bg-blue-500/10 border-blue-500/20",
          iconColor: "text-blue-400",
          defaultTitle: "Notice",
          Icon: Info,
        };
    }
  };

  const { iconBg, iconColor, defaultTitle, Icon } = getVariantStyles();

  return (
    <div
      role="dialog"
      aria-modal="true"
      className="fixed inset-0 z-[250] flex items-center justify-center p-4 bg-black/70 backdrop-blur-sm animate-in fade-in duration-150"
      onClick={onClose}
    >
      <div
        className="w-full max-w-sm rounded-2xl p-5 shadow-2xl flex flex-col gap-4 border border-white/10"
        style={{ background: "rgba(18, 20, 29, 0.98)" }}
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-start gap-3.5">
          <div className={`w-10 h-10 rounded-xl flex items-center justify-center border shrink-0 ${iconBg}`}>
            <Icon className={`w-5 h-5 ${iconColor}`} />
          </div>
          <div className="flex flex-col gap-1 min-w-0">
            <h3 className="font-bold text-sm text-white tracking-tight leading-snug">{title || defaultTitle}</h3>
            <p className="text-xs text-white/70 leading-relaxed">{message}</p>
          </div>
        </div>

        <div className="flex items-center justify-end pt-2 border-t border-white/5">
          <button
            type="button"
            onClick={onClose}
            className="px-5 py-2.5 rounded-xl text-xs font-semibold bg-blue-600 hover:bg-blue-500 text-white transition-colors shadow-lg"
          >
            {buttonText}
          </button>
        </div>
      </div>
    </div>
  );
}
