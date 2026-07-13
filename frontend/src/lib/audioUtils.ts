"use client";

class AudioController {
  public unlock() {
    // navigator.vibrate doesn't require explicit unlocking like WebAudio
  }

  public playBuzz(pattern: number[] = [200, 100, 200]) {
    if (typeof window !== "undefined" && navigator.vibrate) {
      navigator.vibrate(pattern);
    }
  }
}

export const buzzController = new AudioController();
