"use client";

import type { PianoEngine } from "@/lib/audio/piano-engine";

/**
 * Master volume: a mute toggle and a slider.
 *
 * The slider position is stored, not the gain — the engine applies a squared
 * taper so the travel feels even to the ear.
 */

function SpeakerIcon({ level, muted }: { level: number; muted: boolean }) {
  return (
    <svg
      viewBox="0 0 24 24"
      className="size-4 shrink-0"
      fill="none"
      stroke="currentColor"
      strokeWidth={1.8}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <path d="M4 9.5h3.2L11.5 6v12L7.2 14.5H4z" />
      {muted ? (
        <>
          <path d="M16 9.5l4.5 5" />
          <path d="M20.5 9.5l-4.5 5" />
        </>
      ) : (
        <>
          {level > 0.05 && <path d="M14.8 9.6a3.4 3.4 0 0 1 0 4.8" />}
          {level > 0.5 && <path d="M17.4 7.3a6.8 6.8 0 0 1 0 9.4" />}
        </>
      )}
    </svg>
  );
}

export function VolumeControl({
  engine,
  volume,
  muted,
}: {
  engine: PianoEngine;
  volume: number;
  muted: boolean;
}) {
  const percent = Math.round(volume * 100);

  return (
    <div className="flex items-center gap-2">
      <button
        type="button"
        onClick={() => engine.toggleMute()}
        aria-label={muted ? "Unmute" : "Mute"}
        aria-pressed={muted}
        title={muted ? "Unmute" : "Mute"}
        className={`rounded-md p-1 transition-colors ${
          muted ? "text-accent" : "text-muted hover:text-bright"
        }`}
      >
        <SpeakerIcon level={volume} muted={muted} />
      </button>

      <input
        type="range"
        min={0}
        max={100}
        value={percent}
        onChange={(event) =>
          engine.setMasterVolume(Number(event.target.value) / 100)
        }
        aria-label="Master volume"
        className="w-24 accent-[var(--color-accent)]"
      />

      <span className="numeric w-8 text-xs text-muted">
        {muted ? "—" : percent}
      </span>
    </div>
  );
}
