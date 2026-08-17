"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  DEFAULT_SOUNDFONT_ID,
  SOUNDFONT_BY_ID,
  groupSoundfontsByFamily,
} from "@/lib/soundfont-manifest";
import { formatBytes } from "@/lib/format";
import { usePianoEngine } from "@/hooks/usePianoEngine";
import { useMidiInput } from "@/hooks/useMidiInput";
import { useComputerKeyboard } from "@/hooks/useComputerKeyboard";
import { NoteTrails } from "@/components/NoteTrails";
import { PianoKeyboard } from "@/components/PianoKeyboard";
import { TuningControl } from "@/components/TuningControl";
import { VolumeControl } from "@/components/VolumeControl";

/**
 * The instrument.
 *
 * Fills the viewport: a slim control bar, the trail stage, and the 88-key
 * keyboard pinned to the bottom. Everything in the note path (MIDI, computer
 * keys, pointer) writes straight to the engine; React only renders chrome.
 */
export function PianoStudio() {
  const { engine, snapshot } = usePianoEngine();
  const [selectedId, setSelectedId] = useState(DEFAULT_SOUNDFONT_ID);
  const [velocity, setVelocity] = useState(96);
  const [midiLive, setMidiLive] = useState(false);
  const midiFlashTimer = useRef<ReturnType<typeof setTimeout> | undefined>(
    undefined,
  );

  const families = useMemo(() => groupSoundfontsByFamily(), []);
  const ready = snapshot.status === "ready" && snapshot.bankId !== null;
  const started = snapshot.status !== "idle";

  const flashMidiActivity = useCallback(() => {
    // React bails out when the value is unchanged, so a dense MIDI stream
    // does not cost a render per message.
    setMidiLive(true);
    clearTimeout(midiFlashTimer.current);
    midiFlashTimer.current = setTimeout(() => setMidiLive(false), 400);
  }, []);

  useEffect(() => () => clearTimeout(midiFlashTimer.current), []);

  const midi = useMidiInput({
    onNoteOn: (note, vel) => engine.noteOn(note, vel),
    onNoteOff: (note) => (note < 0 ? engine.panic() : engine.noteOff(note)),
    onSustain: (down) => engine.setSustain(down),
    onPitchBend: (value) => engine.pitchBend(value),
    onActivity: flashMidiActivity,
  });

  const { octaveShift } = useComputerKeyboard({
    engine,
    velocity,
    enabled: ready,
  });

  const loadBank = useCallback(
    async (id: string) => {
      const entry = SOUNDFONT_BY_ID.get(id);
      if (!entry) return;
      try {
        await engine.loadBank(entry);
      } catch {
        // Already surfaced through snapshot.error.
      }
    },
    [engine],
  );

  const handleSelect = useCallback(
    (id: string) => {
      setSelectedId(id);
      if (snapshot.status !== "idle") void loadBank(id);
    },
    [loadBank, snapshot.status],
  );

  useEffect(() => {
    const release = () => engine.panic();
    window.addEventListener("blur", release);
    return () => window.removeEventListener("blur", release);
  }, [engine]);

  const progress =
    snapshot.totalBytes > 0
      ? Math.min(1, snapshot.loadedBytes / snapshot.totalBytes)
      : 0;

  return (
    <div className="flex h-dvh w-full flex-col overflow-hidden bg-void">
      {/* ---------- control bar ---------- */}
      <header className="z-20 flex flex-wrap items-center gap-x-3 gap-y-2 border-b border-edge bg-ink/80 px-4 py-2.5 backdrop-blur-xl">
        <h1 className="mr-1 text-sm font-semibold tracking-tight text-bright">
          Solo Resonance
        </h1>

        <select
          value={selectedId}
          onChange={(event) => handleSelect(event.target.value)}
          aria-label="Sound bank"
          className="max-w-52 rounded-lg border border-edge bg-void px-2.5 py-1.5 text-sm text-bright outline-none focus:border-accent"
        >
          {families.map((family) => (
            <optgroup key={family.family} label={family.label}>
              {family.entries.map((entry) => (
                <option key={entry.id} value={entry.id}>
                  {entry.name}
                </option>
              ))}
            </optgroup>
          ))}
        </select>

        <TuningControl
          engine={engine}
          tuningHz={snapshot.tuningHz}
          tuningCents={snapshot.tuningCents}
        />

        <VolumeControl
          engine={engine}
          volume={snapshot.volume}
          muted={snapshot.muted}
        />

        <label className="flex items-center gap-2 text-xs text-faint">
          VEL
          <input
            type="range"
            min={1}
            max={127}
            value={velocity}
            onChange={(event) => setVelocity(Number(event.target.value))}
            aria-label="Velocity for mouse and computer keyboard"
            className="w-20 accent-[var(--color-accent)]"
          />
          <span className="numeric w-6 text-muted">{velocity}</span>
        </label>

        <div className="ml-auto flex items-center gap-3">
          <span
            className="flex items-center gap-1.5 text-xs text-muted"
            title={
              midi.support === "ready"
                ? `${midi.devices.length} MIDI device(s)`
                : `MIDI: ${midi.support}`
            }
          >
            <span
              className={`inline-block size-2 rounded-full ${
                midiLive
                  ? "bg-signal"
                  : midi.devices.length > 0
                    ? "bg-signal/50"
                    : "bg-faint"
              }`}
            />
            {midi.devices.length > 0
              ? (midi.devices[0].name ?? "MIDI")
              : "No MIDI"}
          </span>

          <span className="numeric hidden text-xs text-faint sm:inline">
            oct {octaveShift >= 0 ? `+${octaveShift}` : octaveShift}
          </span>

          <button
            type="button"
            onClick={() => engine.panic()}
            className="rounded-lg border border-edge px-2.5 py-1.5 text-xs text-muted transition-colors hover:border-edge-bright hover:text-bright"
          >
            Panic
          </button>
        </div>
      </header>

      {/* ---------- trail stage ---------- */}
      <div className="relative flex-1 overflow-hidden">
        <NoteTrails engine={engine} className="absolute inset-0 size-full" />

        {!ready && (
          <div className="absolute inset-0 z-10 flex flex-col items-center justify-center gap-4 bg-void/70 backdrop-blur-sm">
            {snapshot.status === "idle" && (
              <>
                <button
                  type="button"
                  onClick={() => void loadBank(selectedId)}
                  className="rounded-xl bg-accent px-7 py-3 text-base font-medium text-void transition-colors hover:bg-accent-dim"
                >
                  Start playing
                </button>
                <p className="max-w-sm text-center text-sm text-muted">
                  Play with a MIDI keyboard, your mouse, or the computer keys —
                  <span className="text-bright"> Z–M</span> and
                  <span className="text-bright"> Q–I</span>, space for sustain,
                  arrows to shift octave.
                </p>
              </>
            )}

            {(snapshot.status === "starting" ||
              snapshot.status === "loading") && (
              <div className="w-64 text-center">
                <p className="text-sm text-muted">
                  {snapshot.status === "starting"
                    ? "Starting audio engine…"
                    : `Loading ${SOUNDFONT_BY_ID.get(selectedId)?.name ?? "bank"}…`}
                </p>
                <div className="mt-3 h-1 overflow-hidden rounded-full bg-edge">
                  <div
                    className="h-full bg-accent transition-[width] duration-150"
                    style={{ width: `${progress * 100}%` }}
                  />
                </div>
                {snapshot.totalBytes > 0 && (
                  <p className="numeric mt-2 text-xs text-faint">
                    {formatBytes(snapshot.loadedBytes)} /{" "}
                    {formatBytes(snapshot.totalBytes)}
                  </p>
                )}
              </div>
            )}

            {snapshot.status === "error" && (
              <div className="max-w-md text-center">
                <p className="text-sm text-bright">{snapshot.error}</p>
                <button
                  type="button"
                  onClick={() => void loadBank(selectedId)}
                  className="mt-3 rounded-lg border border-edge px-4 py-2 text-sm text-muted hover:border-edge-bright hover:text-bright"
                >
                  Retry
                </button>
              </div>
            )}
          </div>
        )}

        {started && snapshot.presetName && (
          <span className="pointer-events-none absolute left-4 top-3 text-xs text-faint">
            {snapshot.presetName}
          </span>
        )}
      </div>

      {/* ---------- keyboard ---------- */}
      <div className="keybed-seam h-px w-full" />
      <div className="h-[24vh] max-h-56 min-h-28 w-full bg-gradient-to-b from-ink to-void px-0.5 pb-0.5">
        <PianoKeyboard engine={engine} velocity={velocity} enabled={ready} />
      </div>
    </div>
  );
}
