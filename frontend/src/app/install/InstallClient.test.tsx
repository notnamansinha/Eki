// @vitest-environment jsdom
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { detectInstallPlatform } from "@/lib/installPlatform";
import InstallClient from "./InstallClient";

const IPHONE_SAFARI = "Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Mobile/15E148 Safari/604.1";
const IPHONE_CHROME = "Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) CriOS/120.0 Mobile/15E148 Safari/604.1";
const ANDROID = "Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 Chrome/120.0 Mobile Safari/537.36";

afterEach(() => { cleanup(); vi.restoreAllMocks(); });

describe("detectInstallPlatform", () => {
  it("classifies devices", () => {
    expect(detectInstallPlatform({ userAgent: IPHONE_SAFARI }, false)).toBe("ios-safari");
    expect(detectInstallPlatform({ userAgent: IPHONE_CHROME }, false)).toBe("ios-other");
    expect(detectInstallPlatform({ userAgent: ANDROID }, false)).toBe("android");
    expect(detectInstallPlatform({ userAgent: "Mozilla/5.0 (X11; Linux x86_64)" }, false)).toBe("desktop");
    expect(detectInstallPlatform({ userAgent: ANDROID }, true)).toBe("installed");
  });
  it("treats a touch Mac as an iPad", () => {
    expect(detectInstallPlatform({ userAgent: "Mozilla/5.0 (Macintosh)", platform: "MacIntel", maxTouchPoints: 5 }, false)).toBe("ios-safari");
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
});
