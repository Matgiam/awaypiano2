"use client";

import { useEffect, useRef, useState } from "react";
import type { PianoEngine } from "@/lib/audio/piano-engine";
import { MIDI_NOTE_MAX, MIDI_NOTE_MIN } from "@/lib/audio/midi";

/**
 * Plays the piano from the computer keyboard, so the app is usable without
 * hardware plugged in.
 *
 * Uses the two-row layout common to trackers and DAWs: the bottom row is one
 * octave and the top row the octave above, with the black keys on the row above
 * each. Physical `code` values are used rather than `key`, so the layout holds
 * on AZERTY and QWERTZ keyboards.
 */

/** Semitone offset from the base note for each physical key. */
const KEY_MAP: Record<string, number> = {
  // Lower row — base octave.
  KeyZ: 0,
  KeyS: 1,
  KeyX: 2,
  KeyD: 3,
  KeyC: 4,
  KeyV: 5,
  KeyG: 6,
  KeyB: 7,
  KeyH: 8,
  KeyN: 9,
  KeyJ: 10,
  KeyM: 11,
  Comma: 12,
  KeyL: 13,
  Period: 14,
  // Upper row — one octave higher.
  KeyQ: 12,
  Digit2: 13,
  KeyW: 14,
  Digit3: 15,
  KeyE: 16,
  KeyR: 17,
  Digit5: 18,
  KeyT: 19,
  Digit6: 20,
  KeyY: 21,
  Digit7: 22,
  KeyU: 23,
  KeyI: 24,
  Digit9: 25,
  KeyO: 26,
};

/** C3 — puts the two rows either side of middle C. */
const BASE_NOTE = 48;

const MIN_OCTAVE_SHIFT = -3;
const MAX_OCTAVE_SHIFT = 3;

/** Typing in a control should never play the piano. */
function isTypingTarget(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) return false;
  const tag = target.tagName;
  return (
    tag === "INPUT" ||
    tag === "TEXTAREA" ||
    tag === "SELECT" ||
    target.isContentEditable
  );
}

export function useComputerKeyboard({
  engine,
  velocity,
  enabled,
}: {
  engine: PianoEngine;
  velocity: number;
  enabled: boolean;
}): { octaveShift: number } {
  const [octaveShift, setOctaveShift] = useState(0);

  // Latest values for the listeners, without re-binding them on every render.
  const latest = useRef({ velocity, enabled, octaveShift });
  useEffect(() => {
    latest.current = { velocity, enabled, octaveShift };
  });

  useEffect(() => {
    /** Physical key code -> the note it started, so release hits the same note. */
    const held = new Map<string, number>();

    const handleDown = (event: KeyboardEvent) => {
      const { velocity, enabled, octaveShift } = latest.current;
      if (!enabled || event.metaKey || event.ctrlKey || event.altKey) return;
      if (isTypingTarget(event.target)) return;

      if (event.code === "Space") {
        event.preventDefault();
        if (!event.repeat) engine.setSustain(true);
        return;
      }

      if (event.code === "ArrowLeft" || event.code === "ArrowRight") {
        if (event.repeat) return;
        event.preventDefault();
        setOctaveShift((current) =>
          Math.min(
            MAX_OCTAVE_SHIFT,
            Math.max(
              MIN_OCTAVE_SHIFT,
              current + (event.code === "ArrowRight" ? 1 : -1),
            ),
          ),
        );
        return;
      }

      const offset = KEY_MAP[event.code];
      if (offset === undefined) return;
      // Auto-repeat would retrigger the note dozens of times per second.
      if (event.repeat || held.has(event.code)) return;

      const note = BASE_NOTE + octaveShift * 12 + offset;
      if (note < MIDI_NOTE_MIN || note > MIDI_NOTE_MAX) return;

      event.preventDefault();
      held.set(event.code, note);
      engine.noteOn(note, velocity);
    };

    const handleUp = (event: KeyboardEvent) => {
      if (event.code === "Space") {
        engine.setSustain(false);
        return;
      }
      const note = held.get(event.code);
      if (note === undefined) return;
      held.delete(event.code);
      engine.noteOff(note);
    };

    /** Losing focus mid-chord would otherwise leave the notes sounding. */
    const releaseAll = () => {
      for (const note of held.values()) engine.noteOff(note);
      held.clear();
      engine.setSustain(false);
    };

    window.addEventListener("keydown", handleDown);
    window.addEventListener("keyup", handleUp);
    window.addEventListener("blur", releaseAll);

    return () => {
      window.removeEventListener("keydown", handleDown);
      window.removeEventListener("keyup", handleUp);
      window.removeEventListener("blur", releaseAll);
      releaseAll();
    };
  }, [engine]);

  return { octaveShift };
}
