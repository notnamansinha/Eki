// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { renderToString } from "react-dom/server";
import { afterEach, describe, expect, it, vi } from "vitest";
import { detectInstallPlatform } from "@/lib/installPlatform";
import InstallClient from "./InstallClient";

const IPHONE_SAFARI = "Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Mobile/15E148 Safari/604.1";
const IPHONE_CHROME = "Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) CriOS/120.0 Mobile/15E148 Safari/604.1";
const IPHONE_WEBVIEW = "Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Mobile/15E148";
const ANDROID = "Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 Chrome/120.0 Mobile Safari/537.36";
const WINDOWS_CHROME = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Safari/537.36";

/** jsdom has no Clipboard API; install one whose writeText the test controls. */
function stubClipboard(writeText: ReturnType<typeof vi.fn>) {
  Object.defineProperty(navigator, "clipboard", { configurable: true, value: { writeText } });
}

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
  Reflect.deleteProperty(navigator, "clipboard");
});

describe("detectInstallPlatform", () => {
  it("classifies devices", () => {
    expect(detectInstallPlatform({ userAgent: IPHONE_SAFARI }, false)).toBe("ios-safari");
    expect(detectInstallPlatform({ userAgent: IPHONE_CHROME }, false)).toBe("ios-other");
    expect(detectInstallPlatform({ userAgent: IPHONE_WEBVIEW }, false)).toBe("ios-other");
    expect(detectInstallPlatform({ userAgent: ANDROID }, false)).toBe("android");
    expect(detectInstallPlatform({ userAgent: "Mozilla/5.0 (X11; Linux x86_64)" }, false)).toBe("desktop");
    expect(detectInstallPlatform({ userAgent: ANDROID }, true)).toBe("installed");
  });
  it("treats a touch Mac as an iPad", () => {
    expect(detectInstallPlatform({ userAgent: "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Safari/605.1.15", platform: "MacIntel", maxTouchPoints: 5 }, false)).toBe("ios-safari");
  });
});

describe("InstallClient", () => {
  function setup(userAgent: string) {
    vi.spyOn(navigator, "userAgent", "get").mockReturnValue(userAgent);
    window.matchMedia = vi.fn().mockReturnValue({ matches: false }) as unknown as typeof window.matchMedia;
  }
  it("shows Add to Home Screen steps on iPhone Safari", () => {
    setup(IPHONE_SAFARI);
    render(<InstallClient />);
    expect(screen.getByText("Add to Home Screen")).toBeTruthy();
  });
  it("tells iPhone Chrome users to switch to Safari", () => {
    setup(IPHONE_CHROME);
    render(<InstallClient />);
    expect(screen.getByRole("button", { name: "Copy link" })).toBeTruthy();
  });
  it("offers a one-tap install on Android once Chrome fires the prompt", async () => {
    setup(ANDROID);
    render(<InstallClient />);
    expect(screen.queryByRole("button", { name: "Install Eki" })).toBeNull();
    window.dispatchEvent(Object.assign(new Event("beforeinstallprompt"), {
      prompt: vi.fn(), userChoice: Promise.resolve({ outcome: "accepted" }),
    }));
    expect(await screen.findByRole("button", { name: "Install Eki" })).toBeTruthy();
  });
  it("prompts once, survives a rejected prompt, and only reports installed on appinstalled", async () => {
    setup(ANDROID);
    render(<InstallClient />);
    const promptFn = vi.fn().mockRejectedValue(new Error("InvalidStateError"));
    window.dispatchEvent(Object.assign(new Event("beforeinstallprompt"), {
      prompt: promptFn, userChoice: Promise.resolve({ outcome: "accepted" }),
    }));
    const btn = await screen.findByRole("button", { name: "Install Eki" });
    fireEvent.click(btn);
    fireEvent.click(btn);
    await waitFor(() => expect(screen.queryByRole("button", { name: /Install/ })).toBeNull());
    expect(promptFn).toHaveBeenCalledTimes(1);
    expect(screen.queryByText(/Eki is installed/)).toBeNull();
    window.dispatchEvent(new Event("appinstalled"));
    expect(await screen.findByText(/Eki is installed/)).toBeTruthy();
  });

  // Issue #516: the desktop branch used to hold one sentence and nothing focusable.
  describe("on a computer", () => {
    it("offers Copy link and a link back to the landing page", () => {
      setup(WINDOWS_CHROME);
      render(<InstallClient />);
      expect(screen.getByText("Open this link on your phone to install Eki.")).toBeTruthy();
      expect(screen.getByRole("button", { name: "Copy link" })).toBeTruthy();
      expect(screen.getByRole("link", { name: "Back to Eki" }).getAttribute("href")).toBe("/");
    });

    it("copies the page address and confirms it", async () => {
      setup(WINDOWS_CHROME);
      const writeText = vi.fn().mockResolvedValue(undefined);
      stubClipboard(writeText);
      render(<InstallClient />);
      fireEvent.click(screen.getByRole("button", { name: "Copy link" }));
      expect(await screen.findByRole("button", { name: "Link copied" })).toBeTruthy();
      expect(writeText).toHaveBeenCalledWith(window.location.href);
    });

    it("never claims success when the clipboard write is refused", async () => {
      setup(WINDOWS_CHROME);
      const writeText = vi.fn().mockRejectedValue(new DOMException("Write permission denied.", "NotAllowedError"));
      stubClipboard(writeText);
      render(<InstallClient />);
      // act() settles the rejected write and any state update it causes.
      await act(async () => { fireEvent.click(screen.getByRole("button", { name: "Copy link" })); });
      expect(writeText).toHaveBeenCalledTimes(1);
      expect(screen.getByRole("button", { name: "Copy link" })).toBeTruthy();
      expect(screen.queryByText("Link copied")).toBeNull();
    });

    it("keeps working when the browser has no Clipboard API", async () => {
      setup(WINDOWS_CHROME);
      render(<InstallClient />);
      await act(async () => { fireEvent.click(screen.getByRole("button", { name: "Copy link" })); });
      expect(screen.getByRole("button", { name: "Copy link" })).toBeTruthy();
      expect(screen.queryByText("Link copied")).toBeNull();
    });

    it("drops an earlier confirmation when a later copy fails", async () => {
      setup(WINDOWS_CHROME);
      const writeText = vi.fn().mockResolvedValueOnce(undefined).mockRejectedValueOnce(new Error("blocked"));
      stubClipboard(writeText);
      render(<InstallClient />);
      fireEvent.click(screen.getByRole("button", { name: "Copy link" }));
      fireEvent.click(await screen.findByRole("button", { name: "Link copied" }));
      expect(await screen.findByRole("button", { name: "Copy link" })).toBeTruthy();
      expect(writeText).toHaveBeenCalledTimes(2);
    });
  });

  it("links back to the landing page on every branch, and offers Copy link only where it helps", () => {
    for (const [userAgent, copy] of [[IPHONE_SAFARI, false], [IPHONE_CHROME, true], [ANDROID, false], [WINDOWS_CHROME, true]] as const) {
      setup(userAgent);
      render(<InstallClient />);
      expect(screen.getByRole("link", { name: "Back to Eki" }).getAttribute("href")).toBe("/");
      expect(screen.queryAllByRole("button", { name: "Copy link" })).toHaveLength(copy ? 1 : 0);
      cleanup();
      vi.restoreAllMocks();
    }
    // Installed (standalone display mode).
    setup(ANDROID);
    window.matchMedia = vi.fn().mockReturnValue({ matches: true }) as unknown as typeof window.matchMedia;
    render(<InstallClient />);
    expect(screen.getByText(/Eki is installed/)).toBeTruthy();
    expect(screen.getByRole("link", { name: "Back to Eki" }).getAttribute("href")).toBe("/");
  });

  it("server-renders the link back, so it works before hydration and without JavaScript", () => {
    const html = renderToString(<InstallClient />);
    expect(html).toContain("Checking your device…");
    expect(html).toMatch(/<a [^>]*href="\/"[^>]*>Back to Eki<\/a>/);
    expect(html).not.toContain("Copy link");
  });
});
