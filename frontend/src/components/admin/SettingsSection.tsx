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
      <label htmlFor={controlId} className="text-sm font-semibold text-ui-ink">{label}</label>
      {children}
      {hint && <p className="text-xs text-ui-quiet">{hint}</p>}
    </div>
  );
}

export function SectionHeader({ icon: Icon, title, subtitle }: { icon: ComponentType<{ className?: string }>; title: string; subtitle: string }) {
  return (
    <div className="flex items-start gap-3 pb-4 border-b border-ui-line">
      <div className="w-9 h-9 rounded-xl bg-ui-soft flex items-center justify-center shrink-0">
        <Icon className="w-4 h-4 text-ui-muted" />
      </div>
      <div>
        <h3 className="font-bold text-ui-ink">{title}</h3>
        <p className="text-xs text-ui-quiet mt-0.5">{subtitle}</p>
      </div>
    </div>
  );
}
