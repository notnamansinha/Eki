"use client";

class AudioController {
  private audioContext: AudioContext | null = null;
  private isUnlocked = false;

  private init() {
    if (typeof window === "undefined") return;
    if (!this.audioContext) {
      this.audioContext = new (window.AudioContext || (window as any).webkitAudioContext)();
    }
  }

  public unlock() {
    this.init();
    if (!this.audioContext || this.isUnlocked) return;
    
    // Create silent buffer to unlock audio context on iOS / Chrome
    const buffer = this.audioContext.createBuffer(1, 1, 22050);
    const source = this.audioContext.createBufferSource();
    source.buffer = buffer;
    source.connect(this.audioContext.destination);
    source.start(0);
    
    if (this.audioContext.state === "suspended") {
      this.audioContext.resume();
    }
    
    this.isUnlocked = true;
  }

  public playBuzz(pattern = [200, 100, 200]) {
    this.init();
    if (!this.audioContext) return;
    
    if (this.audioContext.state === "suspended") {
      this.audioContext.resume();
    }

    let startTime = this.audioContext.currentTime;

    pattern.forEach((duration, index) => {
      const isBuzz = index % 2 === 0;
      if (isBuzz) {
        const osc = this.audioContext!.createOscillator();
        const gainNode = this.audioContext!.createGain();

        // A pleasant but noticeable notification buzz
        osc.type = "sawtooth";
        // Slight detune for a richer, more phone-like buzz
        osc.frequency.setValueAtTime(150, startTime);
        osc.frequency.linearRampToValueAtTime(120, startTime + duration / 1000);

        gainNode.gain.setValueAtTime(0, startTime);
        gainNode.gain.linearRampToValueAtTime(0.3, startTime + 0.05);
        gainNode.gain.setValueAtTime(0.3, startTime + (duration / 1000) - 0.05);
        gainNode.gain.linearRampToValueAtTime(0, startTime + (duration / 1000));

        osc.connect(gainNode);
        gainNode.connect(this.audioContext!.destination);

        osc.start(startTime);
        osc.stop(startTime + (duration / 1000));
      }
      startTime += duration / 1000;
    });
  }
}

export const buzzController = new AudioController();
