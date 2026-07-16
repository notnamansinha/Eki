import React from 'react';
import { Clock, AlertTriangle, AlertCircle } from 'lucide-react';

export type StatusType = 'on-time' | 'delayed' | 'maintenance' | 'offline';

interface StatusChipProps {
  status: StatusType;
  delayMinutes?: number;
  className?: string;
}

export default function StatusChip({ status, delayMinutes = 0, className = '' }: StatusChipProps) {
  const config = {
    'on-time': {
      bg: 'var(--status-live-bg)',
      border: 'rgba(52, 211, 153, 0.15)',
      text: 'var(--status-live)',
      icon: <Clock className="w-3 h-3 mr-1" />,
      label: 'On Time',
    },
    'delayed': {
      bg: 'var(--status-warning-bg)',
      border: 'rgba(251, 191, 36, 0.15)',
      text: 'var(--status-warning)',
      icon: <AlertTriangle className="w-3 h-3 mr-1" />,
      label: `${delayMinutes} min delay`,
    },
    'maintenance': {
      bg: 'rgba(250, 93, 41, 0.10)',
      border: 'rgba(250, 93, 41, 0.15)',
      text: 'var(--accent)',
      icon: <AlertCircle className="w-3 h-3 mr-1" />,
      label: 'Maintenance',
    },
    'offline': {
      bg: 'var(--surface-3)',
      border: 'var(--border-subtle)',
      text: 'var(--text-ghost)',
      icon: <AlertCircle className="w-3 h-3 mr-1" />,
      label: 'Offline',
    },
  };

  const current = config[status] || config['offline'];

  return (
    <div
      className={`inline-flex items-center px-2 py-0.5 rounded border ${className}`}
      style={{ background: current.bg, borderColor: current.border }}
    >
      {React.cloneElement(current.icon, { style: { color: current.text } })}
      <span className="text-[10px] font-semibold" style={{ color: current.text, letterSpacing: "0.04em" }}>
        {current.label}
      </span>
    </div>
  );
}
