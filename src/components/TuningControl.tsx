"use client";

import { useEffect, useRef, useState } from "react";
import type { PianoEngine } from "@/lib/audio/piano-engine";
import {
  TUNING_DEFAULT_HZ,
  TUNING_MAX_HZ,
  TUNING_MIN_HZ,
  TUNING_PRESETS,
  formatCents,
} from "@/lib/audio/tuning";

/**
 * Master tuning, folded into a popover so the toolbar stays slim.
 * The trigger doubles as the readout.
 */
export function TuningControl({
  engine,
  tuningHz,
  tuningCents,
}: {
  engine: PianoEngine;
  tuningHz: number;
  tuningCents: number;
}) {
  const [open, setOpen] = useState(false);
  const rootRef = useRef<HTMLDivElement>(null);
  const detuned = Math.abs(tuningHz - TUNING_DEFAULT_HZ) > 0.05;

  useEffect(() => {
    if (!open) return;
    const onPointerDown = (event: PointerEvent) => {
      if (!rootRef.current?.contains(event.target as Node)) setOpen(false);
    };
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") setOpen(false);
    };
    window.addEventListener("pointerdown", onPointerDown);
    window.addEventListener("keydown", onKeyDown);
    return () => {
      window.removeEventListener("pointerdown", onPointerDown);
      window.removeEventListener("keydown", onKeyDown);
    };
  }, [open]);

  return (
    <div ref={rootRef} className="relative">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className={`numeric flex items-center gap-2 rounded-lg border px-3 py-1.5 text-sm transition-colors ${
          detuned
            ? "border-accent/60 bg-accent/10 text-bright"
            : "border-edge text-muted hover:border-edge-bright hover:text-bright"
        }`}
        aria-expanded={open}
      >
        <span className="text-[0.65rem] uppercase tracking-wider text-faint">
          A4
        </span>
        {tuningHz.toFixed(1)} Hz
        {detuned && (
          <span className="text-xs text-accent">
            {formatCents(tuningCents)}¢
          </span>
        )}
      </button>

      {open && (
        <div className="absolute right-0 top-full z-30 mt-2 w-72 rounded-xl border border-edge bg-surface/95 p-4 shadow-2xl backdrop-blur-xl">
          <div className="flex items-baseline justify-between">
            <span className="numeric text-2xl text-bright">
              {tuningHz.toFixed(1)}
              <span className="ml-1 text-sm text-faint">Hz</span>
            </span>
            <span className="numeric text-sm text-accent">
              {formatCents(tuningCents)} cents
            </span>
          </div>

          <input
            type="range"
            min={TUNING_MIN_HZ}
            max={TUNING_MAX_HZ}
            step={0.1}
            value={tuningHz}
            onChange={(event) => engine.setTuningHz(Number(event.target.value))}
            aria-label="Master tuning reference pitch in hertz"
            className="mt-3 w-full accent-[var(--color-accent)]"
          />
          <div className="numeric flex justify-between text-[0.65rem] text-faint">
            <span>{TUNING_MIN_HZ}</span>
            <span>{TUNING_MAX_HZ}</span>
          </div>

          <div className="mt-3 grid grid-cols-4 gap-1.5">
            {TUNING_PRESETS.map((preset) => {
              const selected = Math.abs(tuningHz - preset.hz) < 0.05;
              return (
                <button
                  key={preset.hz}
                  type="button"
                  onClick={() => engine.setTuningHz(preset.hz)}
                  title={preset.description}
                  className={`numeric rounded-md border px-1 py-1.5 text-xs transition-colors ${
                    selected
                      ? "border-accent bg-accent/15 text-bright"
                      : "border-edge text-muted hover:border-edge-bright hover:text-bright"
                  }`}
                >
                  {preset.label}
                </button>
              );
            })}
          </div>

          <p className="mt-3 text-xs leading-relaxed text-faint">
            Retunes the whole instrument, including notes already ringing.
          </p>
        </div>
      )}
    </div>
  );
}
