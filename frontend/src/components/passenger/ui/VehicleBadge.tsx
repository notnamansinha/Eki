import React from 'react';
import { Bus } from 'lucide-react';
import StatusChip, { StatusType } from './StatusChip';

interface VehicleBadgeProps {
  busId: string;
  status?: StatusType;
  delayMinutes?: number;
  className?: string;
}

export default function VehicleBadge({ busId, status = 'on-time', delayMinutes, className = '' }: VehicleBadgeProps) {
  return (
    <div
      className={`flex items-center gap-3 p-2 pr-4 rounded-xl ${className}`}
      style={{ background: "var(--surface-2)", border: "1px solid var(--border-subtle)" }}
    >
      <div className="w-9 h-9 rounded-lg flex items-center justify-center"
        style={{ background: "var(--surface-3)" }}>
        <Bus className="w-4 h-4" style={{ color: "var(--text-tertiary)" }} />
      </div>
      <div className="flex flex-col gap-1">
        <span className="text-[12px] font-semibold uppercase tracking-wide" style={{ color: "var(--text-secondary)" }}>
          {busId}
        </span>
        <StatusChip status={status} delayMinutes={delayMinutes} />
      </div>
    </div>
  );
}
