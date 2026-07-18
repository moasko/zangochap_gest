"use client";

export function playRiderMessageSound() {
  if (typeof window === "undefined") return;

  try {
    const AudioContextCtor = window.AudioContext || (
      window as typeof window & { webkitAudioContext?: typeof AudioContext }
    ).webkitAudioContext;
    if (!AudioContextCtor) return;

    const context = new AudioContextCtor();
    const gain = context.createGain();
    gain.gain.setValueAtTime(0.0001, context.currentTime);
    gain.gain.exponentialRampToValueAtTime(0.24, context.currentTime + 0.02);
    gain.gain.exponentialRampToValueAtTime(0.0001, context.currentTime + 0.9);
    gain.connect(context.destination);

    [0, 0.22, 0.44].forEach((offset) => {
      const oscillator = context.createOscillator();
      oscillator.type = "sine";
      oscillator.frequency.setValueAtTime(880, context.currentTime + offset);
      oscillator.connect(gain);
      oscillator.start(context.currentTime + offset);
      oscillator.stop(context.currentTime + offset + 0.13);
    });

    window.setTimeout(() => {
      context.close().catch(() => undefined);
    }, 1200);
  } catch {
    // Browsers can block audio before the first user interaction.
  }
}

export function playReminderAlarmSound() {
  if (typeof window === "undefined") return;

  try {
    const AudioContextCtor = window.AudioContext || (
      window as typeof window & { webkitAudioContext?: typeof AudioContext }
    ).webkitAudioContext;
    if (!AudioContextCtor) return;

    const context = new AudioContextCtor();
    const gain = context.createGain();
    gain.gain.setValueAtTime(0.0001, context.currentTime);
    gain.gain.exponentialRampToValueAtTime(0.65, context.currentTime + 0.03);
    gain.connect(context.destination);

    // Sonnerie type alarme : deux tonalités alternées, deux salves percutantes
    const pattern = [0, 0.18, 0.36, 0.54, 1.05, 1.23, 1.41, 1.59];
    pattern.forEach((offset, index) => {
      const oscillator = context.createOscillator();
      oscillator.type = "square";
      oscillator.frequency.setValueAtTime(index % 2 === 0 ? 1040 : 780, context.currentTime + offset);
      oscillator.connect(gain);
      oscillator.start(context.currentTime + offset);
      oscillator.stop(context.currentTime + offset + 0.15);
    });

    gain.gain.setValueAtTime(0.65, context.currentTime + 1.75);
    gain.gain.exponentialRampToValueAtTime(0.0001, context.currentTime + 1.95);

    window.setTimeout(() => {
      context.close().catch(() => undefined);
    }, 2200);
  } catch {
    // Browsers can block audio before the first user interaction.
  }
}

export function showBrowserNotification(title: string, body: string) {
  if (typeof window === "undefined" || !("Notification" in window)) return;
  if (Notification.permission !== "granted") return;

  try {
    new Notification(title, {
      body,
      icon: "/logo.png",
      tag: "zangochap-rider-message",
    });
  } catch {
    // The in-app toast remains the reliable on-screen notification.
  }
}

export function hasSeenRiderAlert(id: string) {
  if (typeof window === "undefined") return false;
  return window.sessionStorage.getItem(`zangochap:rider-alert:${id}`) === "1";
}

export function markRiderAlertSeen(id: string) {
  if (typeof window === "undefined") return;
  window.sessionStorage.setItem(`zangochap:rider-alert:${id}`, "1");
}
