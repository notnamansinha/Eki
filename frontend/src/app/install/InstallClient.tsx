"use client";

import { useEffect, useState, useSyncExternalStore } from "react";
import { detectInstallPlatform, type InstallPlatform } from "@/lib/installPlatform";

type InstallPromptEvent = Event & {
  prompt: () => Promise<void>;
  userChoice: Promise<{ outcome: "accepted" | "dismissed" }>;
};

function currentPlatform(): InstallPlatform {
  const standalone =
    window.matchMedia("(display-mode: standalone)").matches ||
    (navigator as Navigator & { standalone?: boolean }).standalone === true;
  return detectInstallPlatform(navigator, standalone);
}

export default function InstallClient() {
  // Device facts never change during a visit; null on the server and first render.
  const platform = useSyncExternalStore<InstallPlatform | null>(
    () => () => {},
    currentPlatform,
    () => null,
  );
  const [prompt, setPrompt] = useState<InstallPromptEvent | null>(null);
  const [done, setDone] = useState(false);
  const [installing, setInstalling] = useState(false);
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    const onPrompt = (e: Event) => {
      e.preventDefault();
      setPrompt(e as InstallPromptEvent);
    };
    const onInstalled = () => { setDone(true); setPrompt(null); };
    window.addEventListener("beforeinstallprompt", onPrompt);
    window.addEventListener("appinstalled", onInstalled);
    return () => {
      window.removeEventListener("beforeinstallprompt", onPrompt);
      window.removeEventListener("appinstalled", onInstalled);
    };
  }, []);

  async function install() {
    // prompt() may only be called once per event, so ignore repeat taps.
    if (!prompt || installing) return;
    setInstalling(true);
    try {
      await prompt.prompt();
      await prompt.userChoice;
      // "Installed" is only shown on the browser's appinstalled event.
    } catch {
      // A rejected prompt just leaves the manual steps visible.
    } finally {
      setPrompt(null);
      setInstalling(false);
    }
  }

  async function copyLink() {
    try {
      await navigator.clipboard.writeText(window.location.href);
      setCopied(true);
    } catch {
      setCopied(false);
    }
  }

  const button =
    "w-full rounded-xl bg-[#b3262a] px-4 py-3 text-base font-semibold text-white disabled:opacity-60";

  return (
    <main className="mx-auto flex min-h-screen max-w-md flex-col justify-center gap-6 px-4 py-10">
      <h1 className="text-3xl font-bold">Install Eki</h1>
      <p className="text-[var(--text-secondary)]">
        Add Eki to your home screen to open it like an app.
      </p>

      {platform === null && <p aria-live="polite">Checking your device…</p>}

      {(platform === "installed" || done) && (
        <p role="status" className="rounded-xl border p-4">
          Eki is installed. Open it from your home screen.
        </p>
      )}

      {platform === "android" && !done && (
        prompt ? (
          <button type="button" className={button} onClick={install} disabled={installing}>
            {installing ? "Installing…" : "Install Eki"}
          </button>
        ) : (
          <ol className="list-decimal space-y-2 pl-5">
            <li>Open this page in Chrome.</li>
            <li>Tap the ⋮ menu.</li>
            <li>Tap <strong>Install app</strong> or <strong>Add to Home screen</strong>.</li>
          </ol>
        )
      )}

      {platform === "ios-safari" && (
        <ol className="list-decimal space-y-2 pl-5">
          <li>Tap the <strong>Share</strong> button at the bottom of Safari.</li>
          <li>Scroll down and tap <strong>Add to Home Screen</strong>.</li>
          <li>Tap <strong>Add</strong>.</li>
        </ol>
      )}

      {platform === "ios-other" && (
        <div className="space-y-3">
          <p>
            For the most reliable install on iPhone, open this page in Safari. Copy the link, open it in
            Safari, then tap Share and Add to Home Screen.
          </p>
          <button type="button" className={button} onClick={copyLink}>
            {copied ? "Link copied" : "Copy link"}
          </button>
        </div>
      )}

      {platform === "desktop" && (
        <p>Open this link on your phone to install Eki.</p>
      )}
    </main>
  );
}
