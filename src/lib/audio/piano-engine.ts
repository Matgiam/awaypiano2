import type { WorkletSynthesizer } from "spessasynth_lib";
import type { SoundfontEntry } from "@/lib/soundfont-manifest";
import { MIDI_CC, MIDI_STATUS, PIANO_CHANNEL } from "./midi";
import {
  TUNING_DEFAULT_HZ,
  clampTuningHz,
  tuningCentsFor,
} from "./tuning";

/**
 * The audio core.
 *
 * Deliberately framework-agnostic: no React imports live here. The class owns
 * the AudioContext and the spessasynth worklet, and exposes an immutable
 * snapshot that React subscribes to via `useSyncExternalStore`.
 *
 * Two rules shape the design:
 *
 * 1. **The note path never touches React.** `noteOn`/`noteOff` post straight to
 *    the worklet and mutate a plain Map. Re-rendering on every keypress would
 *    put React's reconciler between the key and the sound.
 * 2. **Nothing starts before a user gesture.** Browsers refuse to run an
 *    AudioContext otherwise, so construction is inert and `start()` does the work.
 */

/** Served by `scripts/sync-worklet.mjs` on predev/prebuild. */
const WORKLET_URL = "/worklets/spessasynth_processor.min.js";

/** Every bank is loaded under this id, replacing whatever was there before. */
const BANK_ID = "main";

/**
 * Ceiling on how long the worklet may take to install a bank.
 * Without this, a bank the parser chokes on leaves the UI spinning forever
 * because the promise simply never settles.
 */
const BANK_INSTALL_TIMEOUT_MS = 30_000;

/** Rejects if `promise` has not settled within `ms`. */
function withTimeout<T>(
  promise: Promise<T>,
  ms: number,
  message: string,
): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(message)), ms);
    promise.then(
      (value) => {
        clearTimeout(timer);
        resolve(value);
      },
      (error: unknown) => {
        clearTimeout(timer);
        reject(error instanceof Error ? error : new Error(String(error)));
      },
    );
  });
}

/**
 * Rejects anything that is not a real SoundFont before it reaches the parser.
 *
 * The common failure in production is a static host serving Git LFS pointer
 * files — a 133-byte text stub — in place of the binary. Handing that to the
 * synthesizer produces an unhelpful hang, so it is caught here with a message
 * that names the actual cause.
 */
function assertValidSoundBank(buffer: ArrayBuffer, name: string): void {
  const bytes = new Uint8Array(buffer);

  if (bytes.length < 12) {
    throw new Error(
      `“${name}” is only ${bytes.length} bytes — that is not a sound bank.`,
    );
  }

  const preamble = String.fromCharCode(...bytes.subarray(0, 45));
  if (preamble.startsWith("version https://git-lfs")) {
    throw new Error(
      `“${name}” was served as a Git LFS pointer (${bytes.length} bytes) instead of the real file. ` +
        `The host is not resolving LFS objects — commit the soundfonts as regular files or serve them from object storage.`,
    );
  }

  // Every SoundFont2/SoundFont3 bank is a RIFF container of form "sfbk".
  const riff = String.fromCharCode(...bytes.subarray(0, 4));
  const form = String.fromCharCode(...bytes.subarray(8, 12));
  if (riff !== "RIFF" || form !== "sfbk") {
    throw new Error(
      `“${name}” is not a valid SoundFont: expected a RIFF/sfbk header, got “${riff}”/“${form}” (${bytes.length} bytes).`,
    );
  }
}

export type EngineStatus =
  | "idle"
  | "starting"
  | "loading"
  | "ready"
  | "error";

/**
 * A key strike or release, delivered synchronously as it happens.
 *
 * The visualiser and the keyboard listen to these directly rather than through
 * React state — a note must reach the screen on the same tick it reaches the
 * synthesizer, not one render later.
 */
export interface NoteEvent {
  readonly type: "on" | "off";
  readonly note: number;
  readonly velocity: number;
  /** `performance.now()` at the moment the event was dispatched. */
  readonly time: number;
}

export type NoteListener = (event: NoteEvent) => void;

/** Immutable view of the engine, safe to render from. */
export interface EngineSnapshot {
  readonly status: EngineStatus;
  readonly error: string | null;
  /** Manifest id of the bank currently loaded, if any. */
  readonly bankId: string | null;
  readonly bankName: string | null;
  /** Name of the selected preset inside that bank. */
  readonly presetName: string | null;
  /** Bytes fetched so far for the in-flight bank. */
  readonly loadedBytes: number;
  /** Expected total bytes for the in-flight bank. */
  readonly totalBytes: number;
  readonly sampleRate: number;
  /**
   * Latency the browser reports for the audio graph, in milliseconds.
   * `base` is processing latency; `output` includes the hardware buffer.
   */
  readonly baseLatencyMs: number;
  readonly outputLatencyMs: number;
  readonly sustainDown: boolean;
  /** Reference pitch of A4 in Hz. 440 is the modern standard. */
  readonly tuningHz: number;
  /** The same offset expressed in cents, which is what the synth consumes. */
  readonly tuningCents: number;
}

const INITIAL_SNAPSHOT: EngineSnapshot = Object.freeze({
  status: "idle",
  error: null,
  bankId: null,
  bankName: null,
  presetName: null,
  loadedBytes: 0,
  totalBytes: 0,
  sampleRate: 0,
  baseLatencyMs: 0,
  outputLatencyMs: 0,
  sustainDown: false,
  tuningHz: TUNING_DEFAULT_HZ,
  tuningCents: 0,
});

export class PianoEngine {
  #context: AudioContext | null = null;
  #synth: WorkletSynthesizer | null = null;
  #masterGain: GainNode | null = null;

  #snapshot: EngineSnapshot = INITIAL_SNAPSHOT;
  #listeners = new Set<() => void>();
  #noteListeners = new Set<NoteListener>();

  /** Note number -> velocity, for every key currently sounding. */
  #activeNotes = new Map<number, number>();
  /** Bumped on each load so a superseded fetch cannot clobber a newer one. */
  #loadToken = 0;
  #startPromise: Promise<void> | null = null;
  /**
   * Survives across engine restarts and bank swaps. A fresh WorkletSynthesizer
   * always begins at concert pitch, so the desired tuning is re-applied to it.
   */
  #tuningHz = TUNING_DEFAULT_HZ;

  // --- external store plumbing -------------------------------------------

  subscribe = (listener: () => void): (() => void) => {
    this.#listeners.add(listener);
    return () => {
      this.#listeners.delete(listener);
    };
  };

  getSnapshot = (): EngineSnapshot => this.#snapshot;

  /**
   * Subscribes to individual note events. Returns an unsubscribe function.
   * Listeners are invoked synchronously inside `noteOn`/`noteOff`, so they must
   * be cheap — push to a buffer or set a class, never trigger a React render.
   */
  onNote = (listener: NoteListener): (() => void) => {
    this.#noteListeners.add(listener);
    return () => {
      this.#noteListeners.delete(listener);
    };
  };

  #emitNote(type: "on" | "off", note: number, velocity: number): void {
    if (this.#noteListeners.size === 0) return;
    const event: NoteEvent = { type, note, velocity, time: performance.now() };
    for (const listener of this.#noteListeners) listener(event);
  }

  /** The server renders the inert state; the engine only exists in the browser. */
  getServerSnapshot = (): EngineSnapshot => INITIAL_SNAPSHOT;

  #patch(changes: Partial<EngineSnapshot>): void {
    this.#snapshot = Object.freeze({ ...this.#snapshot, ...changes });
    for (const listener of this.#listeners) listener();
  }

  // --- lifecycle ----------------------------------------------------------

  /**
   * Boots the AudioContext and synthesizer. Must be called from a user gesture.
   * Concurrent calls share one in-flight promise, so a double-click cannot
   * create two AudioContexts.
   */
  start(): Promise<void> {
    this.#startPromise ??= this.#start().catch((error: unknown) => {
      // Clear the memo so a transient failure (e.g. worklet 404) can be retried.
      this.#startPromise = null;
      this.#patch({
        status: "error",
        error: error instanceof Error ? error.message : String(error),
      });
      throw error;
    });
    return this.#startPromise;
  }

  async #start(): Promise<void> {
    if (this.#synth) return;
    this.#patch({ status: "starting", error: null });

    // Imported lazily so the 400 KB library never enters the SSR path or the
    // initial client bundle — it is only fetched once the user asks for audio.
    const { WorkletSynthesizer } = await import("spessasynth_lib");

    // "interactive" asks the browser for the smallest buffer it can sustain,
    // which is the single biggest lever on perceived key-to-sound latency.
    const context = new AudioContext({ latencyHint: "interactive" });
    if (context.state === "suspended") await context.resume();

    await context.audioWorklet.addModule(WORKLET_URL);

    const synth = new WorkletSynthesizer(context, {
      oneOutput: false,
      eventsEnabled: true,
    });
    // Events default to a small delay to stay in sync with playback; the
    // visualiser needs them as early as possible instead.
    synth.eventHandler.timeDelay = 0;
    await synth.isReady;

    const masterGain = context.createGain();
    masterGain.gain.value = 1;
    synth.connect(masterGain);
    masterGain.connect(context.destination);

    this.#context = context;
    this.#synth = synth;
    this.#masterGain = masterGain;

    // A new synthesizer starts at concert pitch; restore the chosen tuning.
    this.#applyTuning();

    this.#patch({
      status: "ready",
      sampleRate: context.sampleRate,
      baseLatencyMs: (context.baseLatency ?? 0) * 1000,
      outputLatencyMs: (context.outputLatency ?? 0) * 1000,
    });
  }

  /**
   * Fetches and installs a SoundFont bank, replacing the current one.
   * Reports download progress through the snapshot.
   */
  async loadBank(entry: SoundfontEntry): Promise<void> {
    await this.start();
    const synth = this.#synth;
    if (!synth) throw new Error("Engine is not started.");

    const token = ++this.#loadToken;
    this.#patch({
      status: "loading",
      error: null,
      loadedBytes: 0,
      totalBytes: entry.bytes,
      presetName: null,
    });

    try {
      const buffer = await this.#fetchWithProgress(entry, token);
      // A newer load started while this one was in flight — discard it.
      if (token !== this.#loadToken) return;

      // Fail fast and legibly rather than handing junk to the parser.
      assertValidSoundBank(buffer, entry.name);

      await withTimeout(
        synth.soundBankManager.addSoundBank(buffer, BANK_ID),
        BANK_INSTALL_TIMEOUT_MS,
        `Timed out installing “${entry.name}” after ${BANK_INSTALL_TIMEOUT_MS / 1000}s.`,
      );
      if (token !== this.#loadToken) return;

      const presetName = this.#selectFirstPreset(synth);
      // Cheap insurance: keep the tuning pinned across bank swaps.
      this.#applyTuning();

      this.#patch({
        status: "ready",
        bankId: entry.id,
        bankName: entry.name,
        presetName,
        loadedBytes: entry.bytes,
      });
    } catch (error: unknown) {
      if (token !== this.#loadToken) return;
      this.#patch({
        status: "error",
        error: error instanceof Error ? error.message : String(error),
      });
      throw error;
    }
  }

  /** Streams the bank so the UI can show real progress on a 10 MB file. */
  async #fetchWithProgress(
    entry: SoundfontEntry,
    token: number,
  ): Promise<ArrayBuffer> {
    const response = await fetch(entry.url);
    if (!response.ok) {
      throw new Error(
        `Failed to fetch ${entry.name}: ${response.status} ${response.statusText}`,
      );
    }

    const declared = Number(response.headers.get("Content-Length"));
    const total = Number.isFinite(declared) && declared > 0 ? declared : entry.bytes;

    // Without a readable stream we cannot report progress; fall back to a
    // single blocking read rather than failing.
    if (!response.body) return response.arrayBuffer();

    const reader = response.body.getReader();
    const chunks: Uint8Array[] = [];
    let received = 0;

    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      chunks.push(value);
      received += value.byteLength;
      if (token === this.#loadToken) {
        this.#patch({ loadedBytes: received, totalBytes: total });
      }
    }

    const merged = new Uint8Array(received);
    let offset = 0;
    for (const chunk of chunks) {
      merged.set(chunk, offset);
      offset += chunk.byteLength;
    }
    return merged.buffer;
  }

  /**
   * Selects a playable preset from the freshly loaded bank.
   *
   * The 92 migrated banks do not agree on numbering — some sit at program 0,
   * others (e.g. "000_002 Electric Grand") at a different bank/program pair.
   * Reading the actual preset list and selecting the first pitched entry works
   * for all of them.
   */
  #selectFirstPreset(synth: WorkletSynthesizer): string | null {
    const presets = synth.presetList;
    if (!presets || presets.length === 0) return null;

    const preset = presets.find((candidate) => !candidate.isDrum) ?? presets[0];

    // Bank Select MSB/LSB then Program Change — the standard selection sequence.
    synth.sendMessage([
      MIDI_STATUS.controlChange | PIANO_CHANNEL,
      MIDI_CC.bankSelectMSB,
      preset.bankMSB,
    ]);
    synth.sendMessage([
      MIDI_STATUS.controlChange | PIANO_CHANNEL,
      MIDI_CC.bankSelectLSB,
      preset.bankLSB,
    ]);
    synth.programChange(PIANO_CHANNEL, preset.program);

    return preset.name;
  }

  // --- the hot path -------------------------------------------------------

  /**
   * Starts a note. Velocity is passed through untouched (0-127) so the
   * SoundFont's own velocity layers and amplitude curve do the work.
   */
  noteOn(midiNote: number, velocity: number): void {
    const synth = this.#synth;
    if (!synth) return;

    // Running-status note-on with zero velocity means note-off.
    if (velocity <= 0) {
      this.noteOff(midiNote);
      return;
    }

    this.#activeNotes.set(midiNote, velocity);
    synth.noteOn(PIANO_CHANNEL, midiNote, velocity);
    this.#emitNote("on", midiNote, velocity);
  }

  noteOff(midiNote: number): void {
    const synth = this.#synth;
    if (!synth) return;
    const velocity = this.#activeNotes.get(midiNote) ?? 0;
    this.#activeNotes.delete(midiNote);
    synth.noteOff(PIANO_CHANNEL, midiNote);
    this.#emitNote("off", midiNote, velocity);
  }

  // --- master tuning ------------------------------------------------------

  /**
   * Retunes the entire instrument by moving the reference pitch of A4.
   *
   * This writes the synthesizer's *global system* tuning layer. spessasynth sums
   * four independent tuning sources per voice:
   *
   *     globalSystem.fineTune + globalMIDI.fineTune
   *   + channelSystem.fineTune + channelMIDI.fineTune
   *
   * Using the global *system* layer means an RPN or SysEx tuning message
   * arriving from the MIDI keyboard lands in a different layer and adds to this
   * one rather than overwriting it.
   *
   * The sum is re-read while each voice renders, so notes already sounding
   * glide to the new pitch instead of waiting for the next keypress.
   */
  setTuningHz(referenceHz: number): void {
    const hz = clampTuningHz(referenceHz);
    const cents = tuningCentsFor(hz);
    this.#tuningHz = hz;

    this.#applyTuning();
    this.#patch({ tuningHz: hz, tuningCents: cents });
  }

  /** Pushes the stored tuning into the synthesizer, if one exists yet. */
  #applyTuning(): void {
    this.#synth?.setSystemParameter("fineTune", tuningCentsFor(this.#tuningHz));
  }

  /** Sustain pedal (CC 64). Values >= 64 are "down" per the MIDI spec. */
  setSustain(down: boolean): void {
    const synth = this.#synth;
    if (!synth) return;
    synth.controllerChange(PIANO_CHANNEL, MIDI_CC.sustainPedal, down ? 127 : 0);
    if (down !== this.#snapshot.sustainDown) {
      this.#patch({ sustainDown: down });
    }
  }

  pitchBend(value14bit: number): void {
    this.#synth?.pitchWheel(PIANO_CHANNEL, value14bit);
  }

  /** Immediately silences everything — the "stuck note" escape hatch. */
  panic(): void {
    // Emit releases before clearing so the visualiser can close open trails.
    for (const [note, velocity] of this.#activeNotes) {
      this.#emitNote("off", note, velocity);
    }
    this.#activeNotes.clear();
    this.#synth?.stopAll(true);
    this.setSustain(false);
  }

  setMasterVolume(volume: number): void {
    if (!this.#masterGain || !this.#context) return;
    // Ramp rather than jump; an instant gain change is an audible click.
    this.#masterGain.gain.setTargetAtTime(
      Math.max(0, Math.min(1, volume)),
      this.#context.currentTime,
      0.01,
    );
  }

  // --- read-only accessors, polled by rAF rather than subscribed to --------

  /** Live map of sounding notes. Read during animation frames; do not mutate. */
  getActiveNotes(): ReadonlyMap<number, number> {
    return this.#activeNotes;
  }

  getVoiceCount(): number {
    return this.#synth?.voiceCount ?? 0;
  }

  /** Current audio clock, used to timestamp note events for the visualiser. */
  getCurrentTime(): number {
    return this.#context?.currentTime ?? 0;
  }

  async destroy(): Promise<void> {
    this.#loadToken++;
    try {
      this.#synth?.destroy();
      this.#masterGain?.disconnect();
      await this.#context?.close();
    } catch {
      // Teardown races with an in-flight start are not worth surfacing.
    }
    this.#synth = null;
    this.#masterGain = null;
    this.#context = null;
    this.#activeNotes.clear();
    this.#startPromise = null;
    // The chosen tuning is a user preference, not engine state — it survives a
    // restart and is re-applied to the next synthesizer.
    this.#patch({
      ...INITIAL_SNAPSHOT,
      tuningHz: this.#tuningHz,
      tuningCents: tuningCentsFor(this.#tuningHz),
    });
  }
}
