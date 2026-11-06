import { BusFront } from "lucide-react";

/** Keep the vehicle upright while its separate pointer shows travel heading. */
export default function BusPositionGlyph({ label, heading, color, uncertain }: {
  label: string;
  heading: number;
  color: string;
  uncertain: boolean;
}) {
  return (
    <div role="img" aria-label={label} title={label} className="relative flex size-11 items-center justify-center">
      {!uncertain && (
        <div aria-hidden="true" className="absolute inset-0" style={{ transform: `rotate(${heading}deg)` }}>
          <svg viewBox="0 0 44 44" className="size-11" fill="none">
            <path d="M22 1 16 11h12L22 1Z" fill={color} stroke="white" strokeWidth="2" strokeLinejoin="round" />
          </svg>
        </div>
      )}
      <div aria-hidden="true" className="relative flex size-8 items-center justify-center rounded-lg border border-zinc-300 bg-white shadow-md"
        style={{ borderBottomColor: uncertain ? "#626666" : color, borderBottomWidth: 3 }}>
        <BusFront className="size-5 text-zinc-900" strokeWidth={2} />
      </div>
    </div>
  );
}
