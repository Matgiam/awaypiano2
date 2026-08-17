import { hzToCents } from "./midi";

/**
 * Master tuning.
 *
 * The whole instrument is retuned by shifting the reference pitch of A4 away
 * from the modern 440 Hz standard. Everything downstream is expressed in cents,
 * because that is the unit the synthesizer's tuning layer speaks.
 */

/** The modern concert-pitch standard. */
export const TUNING_DEFAULT_HZ = 440;

/**
 * Slider bounds. Wide enough for historical pitch (Baroque A=415) and sharp
 * orchestral tunings (A=444) without straying so far that sample playback
 * becomes an obvious transposition.
 */
export const TUNING_MIN_HZ = 400;
export const TUNING_MAX_HZ = 480;

export interface TuningPreset {
  hz: number;
  label: string;
  description: string;
}

/** Common reference pitches, offered as one-click targets beside the slider. */
export const TUNING_PRESETS: readonly TuningPreset[] = [
  { hz: 415, label: "415", description: "Baroque" },
  { hz: 432, label: "432", description: "Verdi / low" },
  { hz: 440, label: "440", description: "Standard" },
  { hz: 444, label: "444", description: "Bright" },
] as const;

/** Clamp a requested reference pitch into the supported range. */
export function clampTuningHz(hz: number): number {
  if (!Number.isFinite(hz)) return TUNING_DEFAULT_HZ;
  return Math.min(TUNING_MAX_HZ, Math.max(TUNING_MIN_HZ, hz));
}

/**
 * Cents offset the synthesizer needs to realise a given reference pitch.
 * A=432 works out to roughly -31.77 cents.
 */
export function tuningCentsFor(hz: number): number {
  return hzToCents(clampTuningHz(hz));
}

/** Formats a cents offset with an explicit sign, e.g. "-31.77". */
export function formatCents(cents: number): string {
  const rounded = cents.toFixed(2);
  return cents > 0 ? `+${rounded}` : rounded;
}
