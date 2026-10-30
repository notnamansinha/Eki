import type { ComponentType, ReactNode } from "react";

/** Labelled control used by every admin Settings section. */
export function Field({
  label,
  hint,
  controlId,
  children,
}: {
  label: string;
  hint?: string;
  controlId: string;
  children: ReactNode;
}) {
  return (
    <div className="flex flex-col gap-1.5">
      <label htmlFor={controlId} className="text-sm font-semibold text-white/80">{label}</label>
      {children}
      {hint && <p className="text-xs text-white/30">{hint}</p>}
    </div>
  );
}

export function SectionHeader({ icon: Icon, title, subtitle }: { icon: ComponentType<{ className?: string }>; title: string; subtitle: string }) {
  return (
    <div className="flex items-start gap-3 pb-4 border-b border-white/5">
      <div className="w-9 h-9 rounded-xl bg-white/5 flex items-center justify-center shrink-0">
        <Icon className="w-4 h-4 text-white/50" />
      </div>
      <div>
        <p className="font-bold text-white">{title}</p>
        <p className="text-xs text-white/30 mt-0.5">{subtitle}</p>
      </div>
    </div>
  );
}
