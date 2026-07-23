"use client";

import { useState, type ComponentType } from "react";
import { useSettings, GlobalSettings } from "@/hooks/useSettings";
import { Save, Loader2, Eye, EyeOff, Megaphone, Clock, MessageSquare, Info } from "lucide-react";
import { errorMessage } from "@/lib/errors";

function Field({
  label,
  hint,
  controlId,
  children,
}: {
  label: string;
  hint?: string;
  controlId: string;
  children: React.ReactNode;
}) {
  return (
    <div className="flex flex-col gap-1.5">
      <label htmlFor={controlId} className="text-sm font-semibold text-white/80">{label}</label>
      {children}
      {hint && <p className="text-xs text-white/30">{hint}</p>}
    </div>
  );
}

function SectionHeader({ icon: Icon, title, subtitle }: { icon: ComponentType<{ className?: string }>; title: string; subtitle: string }) {
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

export default function SettingsPanel() {
  const { settings, loading, saveSettings } = useSettings();
  const [overrides, setOverrides] = useState<Partial<GlobalSettings>>({});
  const draft = { ...settings, ...overrides };
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);

  const set = <K extends keyof GlobalSettings>(k: K, v: GlobalSettings[K]) =>
    setOverrides(current => ({ ...current, [k]: v }));

  const handleSave = async () => {
    setSaving(true);
    try {
      await saveSettings(draft);
      setOverrides({});
      setSaved(true);
      setTimeout(() => setSaved(false), 3000);
    } catch (error: unknown) {
      alert("Failed to save: " + errorMessage(error));
    } finally {
      setSaving(false);
    }
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center h-64 gap-3 text-white/30">
        <Loader2 className="w-5 h-5 animate-spin" />
        <span className="text-sm font-medium">Loading settings…</span>
      </div>
    );
  }

  return (
    <div className="w-full max-w-2xl mx-auto p-4 md:p-6 flex flex-col gap-6 animate-slide-up">
      <div className="flex items-center justify-between">
        <div>
          <h2 className="font-bold text-xl text-white">Settings</h2>
          <p className="text-xs text-white/30 mt-0.5">Changes apply live to the Passenger app</p>
        </div>
        <button
          onClick={handleSave}
          disabled={saving}
          className="flex items-center gap-2 px-4 py-2.5 rounded-xl bg-white text-[#09090b] font-bold text-sm hover:bg-white/90 transition-colors shadow-lg disabled:opacity-50"
        >
          {saving
            ? <><Loader2 className="w-4 h-4 animate-spin" /> Saving…</>
            : saved
            ? <><span className="text-emerald-600">✓</span> Saved!</>
            : <><Save className="w-4 h-4" /> Save All</>
          }
        </button>
      </div>

      {/* â”€â”€ Service Hours â”€â”€ */}
      <div className="bg-white/3 border border-white/8 rounded-2xl p-5 flex flex-col gap-5">
        <SectionHeader icon={Clock} title="Service Hours" subtitle="Controls the 'service starts at' message shown when no buses are active" />

        <Field controlId="setting-service-start-time" label="Service Start Time" hint='Shown to passengers in the "no buses" empty state. e.g. "6:30 am"'>
          <input
            id="setting-service-start-time"
            type="text"
            value={draft.serviceStartTime}
            onChange={e => set("serviceStartTime", e.target.value)}
            placeholder="e.g. 6:30 am"
            className="input-rc h-10"
          />
        </Field>
      </div>

      {/* â”€â”€ Passenger-facing copy â”€â”€ */}
      <div className="bg-white/3 border border-white/8 rounded-2xl p-5 flex flex-col gap-5">
        <SectionHeader icon={MessageSquare} title="Passenger App Copy" subtitle="Text shown in the passenger app when no buses are running" />

        <Field controlId="setting-no-buses-headline" label="No Buses — Headline" hint='The bold text shown in the empty state. e.g. "No buses running"'>
          <input
            id="setting-no-buses-headline"
            value={draft.noBusesMessage}
            onChange={e => set("noBusesMessage", e.target.value)}
            placeholder="No buses running"
            className="input-rc h-10"
          />
        </Field>

        <Field
          controlId="setting-no-buses-subtext"
          label="No Buses — Subtext"
          hint='Use {time} to insert the service start time automatically. e.g. "Service starts at {time}"'
        >
          <input
            id="setting-no-buses-subtext"
            value={draft.noBusesSubMessage}
            onChange={e => set("noBusesSubMessage", e.target.value)}
            placeholder="Service starts at {time}"
            className="input-rc h-10"
          />
          <div className="flex items-center gap-1.5 bg-blue-500/10 border border-blue-500/20 rounded-lg px-3 py-2 text-xs text-blue-400">
            <Info className="w-3.5 h-3.5 shrink-0" />
            <span>
              Preview:{" "}
              <strong>
                {draft.noBusesSubMessage.replace("{time}", draft.serviceStartTime)}
              </strong>
            </span>
          </div>
        </Field>
      </div>

      {/* â”€â”€ Live Announcement Banner â”€â”€ */}
      <div className="bg-white/3 border border-white/8 rounded-2xl p-5 flex flex-col gap-5">
        <SectionHeader icon={Megaphone} title="Live Announcement Banner" subtitle="When active, a banner appears at the top of the Passenger app home screen" />

        <Field controlId="setting-announcement-text" label="Announcement Text" hint="Keep it brief — shown in a slim banner strip">
          <textarea
            id="setting-announcement-text"
            value={draft.announcementText}
            onChange={e => set("announcementText", e.target.value)}
            placeholder="e.g. Heavy traffic near Central Park — expect delays on Route 1A"
            rows={3}
            className="input-rc py-2 resize-none"
          />
        </Field>

        <div className="flex items-center gap-3">
          <button
            onClick={() => set("announcementActive", !draft.announcementActive)}
            className={`relative w-11 h-6 rounded-full transition-all ${draft.announcementActive ? "bg-emerald-500" : "bg-white/10"}`}
            role="switch"
            aria-checked={draft.announcementActive}
            aria-label="Toggle announcement"
          >
            <span className={`absolute top-0.5 left-0.5 w-5 h-5 rounded-full bg-white shadow transition-transform ${draft.announcementActive ? "translate-x-5" : "translate-x-0"}`} />
          </button>
          <div className="flex items-center gap-1.5">
            {draft.announcementActive
              ? <Eye className="w-4 h-4 text-emerald-400" />
              : <EyeOff className="w-4 h-4 text-white/30" />
            }
            <span className={`text-sm font-semibold ${draft.announcementActive ? "text-emerald-400" : "text-white/50"}`}>
              {draft.announcementActive ? "Visible to passengers" : "Hidden"}
            </span>
          </div>
        </div>

        {draft.announcementActive && draft.announcementText && (
          <div className="bg-brand-accent/10 border border-brand-accent/20 rounded-xl px-4 py-3 flex items-start gap-2">
            <Megaphone className="w-4 h-4 text-brand-accent shrink-0 mt-0.5" />
            <p className="text-sm text-white/80 font-medium leading-snug">{draft.announcementText}</p>
          </div>
        )}
      </div>

      {/* Bottom save button */}
      <button
        onClick={handleSave}
        disabled={saving}
        className="w-full flex items-center justify-center gap-2 h-12 rounded-xl bg-white text-[#09090b] font-bold text-sm hover:bg-white/90 transition-colors shadow-lg disabled:opacity-50"
      >
        {saving
          ? <><Loader2 className="w-4 h-4 animate-spin" /> Saving…</>
          : saved
          ? <><span className="text-emerald-600">✓</span> All changes saved!</>
          : <><Save className="w-4 h-4" /> Save All Settings</>
        }
      </button>
    </div>
  );
}
