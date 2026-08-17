"use client";

import { useEffect, useState, useSyncExternalStore } from "react";
import { PianoEngine, type EngineSnapshot } from "@/lib/audio/piano-engine";

/**
 * Owns a single PianoEngine for the lifetime of the component and subscribes to
 * its snapshot.
 *
 * `useSyncExternalStore` is the right primitive here: the engine is the source
 * of truth and mutates from async callbacks (fetch progress, worklet readiness)
 * that have nothing to do with the render cycle.
 *
 * The instance is held in lazily-initialised `useState` rather than a ref —
 * a ref may not be read during render, and the subscribe/getSnapshot callbacks
 * are read on every render.
 */
export function usePianoEngine(): {
  engine: PianoEngine;
  snapshot: EngineSnapshot;
} {
  const [engine] = useState(() => new PianoEngine());

  const snapshot = useSyncExternalStore(
    engine.subscribe,
    engine.getSnapshot,
    engine.getServerSnapshot,
  );

  useEffect(() => {
    return () => {
      // Closes the AudioContext. Safe under StrictMode's double-mount: destroy()
      // resets the engine to `idle`, and a later start() rebuilds it cleanly.
      void engine.destroy();
    };
  }, [engine]);

  return { engine, snapshot };
}

/** A sounding note and the velocity it was struck with. */
export interface ActiveNote {
  note: number;
  velocity: number;
}

export interface EngineTelemetry {
  voiceCount: number;
  activeNotes: ActiveNote[];
}

const EMPTY_TELEMETRY: EngineTelemetry = { voiceCount: 0, activeNotes: [] };

/**
 * Samples the engine once per animation frame.
 *
 * Voice count and held notes change far too often to push through the snapshot
 * store — every note-on would re-render. Instead the engine keeps them in plain
 * mutable structures and this hook reads them on a frame tick, committing state
 * only when the values actually differ.
 *
 * Mount this in a small leaf component: while notes decay, the voice count
 * changes most frames, so anything rendered alongside it re-renders too.
 */
export function useEngineTelemetry(
  engine: PianoEngine,
  running: boolean,
): EngineTelemetry {
  const [telemetry, setTelemetry] = useState<EngineTelemetry>(EMPTY_TELEMETRY);

  useEffect(() => {
    if (!running) return;

    let frame = 0;
    let previous = "";

    const tick = () => {
      const activeNotes = [...engine.getActiveNotes().entries()]
        .sort(([a], [b]) => a - b)
        .map(([note, velocity]) => ({ note, velocity }));
      const voiceCount = engine.getVoiceCount();

      const signature = `${voiceCount}:${activeNotes
        .map((n) => `${n.note}/${n.velocity}`)
        .join(",")}`;

      if (signature !== previous) {
        previous = signature;
        setTelemetry({ voiceCount, activeNotes });
      }
      frame = requestAnimationFrame(tick);
    };

    frame = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(frame);
  }, [engine, running]);

  return telemetry;
}
