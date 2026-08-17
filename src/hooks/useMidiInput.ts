"use client";

import {
  useCallback,
  useEffect,
  useRef,
  useState,
  useSyncExternalStore,
} from "react";
import { MIDI_CC, MIDI_STATUS } from "@/lib/audio/midi";

/**
 * Web MIDI input with hot-plug support.
 *
 * Incoming messages are dispatched through refs rather than state so that a
 * keypress reaches the synthesizer without waiting for a React render. Device
 * *metadata* is state (it changes rarely and drives UI); note events are not.
 */

export type MidiSupport =
  | "checking"
  | "unsupported"
  | "denied"
  | "ready"
  | "error";

export interface MidiDevice {
  readonly id: string;
  readonly name: string;
  readonly manufacturer: string;
  /** "connected" once the port is physically present. */
  readonly state: MIDIPortDeviceState;
  /** "open" once we are receiving from it. */
  readonly connection: MIDIPortConnectionState;
}

export interface MidiHandlers {
  onNoteOn?: (note: number, velocity: number) => void;
  /** Called with -1 to mean "release everything" (CC 120/123). */
  onNoteOff?: (note: number) => void;
  onSustain?: (down: boolean) => void;
  onPitchBend?: (value14bit: number) => void;
  /** Fired for every accepted message; drives the live activity indicator. */
  onActivity?: () => void;
}

export interface UseMidiInputResult {
  support: MidiSupport;
  devices: MidiDevice[];
  error: string | null;
  /** Re-request access after a denial or a browser permission change. */
  retry: () => void;
}

/** Resolution of the async permission handshake, separate from feature support. */
type AccessState = "pending" | "ready" | "denied" | "error";

function describePorts(access: MIDIAccess): MidiDevice[] {
  const devices: MidiDevice[] = [];
  access.inputs.forEach((input) => {
    devices.push({
      id: input.id,
      name: input.name ?? "Unknown device",
      manufacturer: input.manufacturer ?? "",
      state: input.state,
      connection: input.connection,
    });
  });
  return devices.sort((a, b) => a.name.localeCompare(b.name));
}

/** Web MIDI availability never changes, so the subscribe callback is a no-op. */
const subscribeToNothing = () => () => {};
const readMidiSupported = () =>
  typeof navigator !== "undefined" &&
  typeof navigator.requestMIDIAccess === "function";
const readMidiSupportedOnServer = () => false;

export function useMidiInput(handlers: MidiHandlers): UseMidiInputResult {
  // Read as an external store so the server and first client render agree,
  // rather than flipping state inside an effect.
  const midiSupported = useSyncExternalStore(
    subscribeToNothing,
    readMidiSupported,
    readMidiSupportedOnServer,
  );

  const [accessState, setAccessState] = useState<AccessState>("pending");
  const [devices, setDevices] = useState<MidiDevice[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [attempt, setAttempt] = useState(0);

  // Keeping handlers in a ref means changing them never detaches the MIDI
  // listeners, and the listeners never close over a stale render. Written in an
  // effect because refs must not be mutated during render.
  const handlersRef = useRef(handlers);
  useEffect(() => {
    handlersRef.current = handlers;
  });

  const retry = useCallback(() => {
    setAccessState("pending");
    setAttempt((n) => n + 1);
  }, []);

  useEffect(() => {
    if (!midiSupported) return;

    let cancelled = false;
    let access: MIDIAccess | null = null;

    const handleMessage = (event: MIDIMessageEvent) => {
      const data = event.data;
      if (!data || data.length === 0) return;

      const status = data[0];
      // System and real-time messages (clock, active sensing) arrive constantly
      // and carry nothing we act on.
      if (status >= MIDI_STATUS.system) return;

      const type = status & 0xf0;
      const cb = handlersRef.current;

      switch (type) {
        case MIDI_STATUS.noteOn: {
          const note = data[1];
          const velocity = data[2] ?? 0;
          // Many controllers signal release as note-on with velocity 0.
          if (velocity === 0) cb.onNoteOff?.(note);
          else cb.onNoteOn?.(note, velocity);
          break;
        }
        case MIDI_STATUS.noteOff:
          cb.onNoteOff?.(data[1]);
          break;
        case MIDI_STATUS.controlChange: {
          const controller = data[1];
          const value = data[2] ?? 0;
          if (controller === MIDI_CC.sustainPedal) {
            // Per the MIDI spec the pedal is down at 64 and above.
            cb.onSustain?.(value >= 64);
          } else if (
            controller === MIDI_CC.allNotesOff ||
            controller === MIDI_CC.allSoundOff
          ) {
            cb.onNoteOff?.(-1);
          }
          break;
        }
        case MIDI_STATUS.pitchBend:
          // 14-bit value split across two 7-bit bytes, LSB first.
          cb.onPitchBend?.((data[2] << 7) | data[1]);
          break;
        default:
          break;
      }

      cb.onActivity?.();
    };

    /** (Re)attach to every input port. Assignment is idempotent. */
    const syncPorts = () => {
      if (!access || cancelled) return;
      access.inputs.forEach((input) => {
        input.onmidimessage = handleMessage;
      });
      setDevices(describePorts(access));
    };

    navigator
      .requestMIDIAccess({ sysex: false })
      .then((midiAccess) => {
        if (cancelled) return;
        access = midiAccess;
        setAccessState("ready");
        setError(null);
        // Fires when a device is plugged in or unplugged.
        access.onstatechange = syncPorts;
        syncPorts();
      })
      .catch((cause: unknown) => {
        if (cancelled) return;
        // Chrome raises SecurityError when the permission is blocked.
        const denied =
          cause instanceof DOMException &&
          (cause.name === "SecurityError" || cause.name === "NotAllowedError");
        setAccessState(denied ? "denied" : "error");
        setError(cause instanceof Error ? cause.message : String(cause));
      });

    return () => {
      cancelled = true;
      if (access) {
        access.onstatechange = null;
        access.inputs.forEach((input) => {
          input.onmidimessage = null;
        });
      }
    };
  }, [attempt, midiSupported]);

  const support: MidiSupport = !midiSupported
    ? "unsupported"
    : accessState === "pending"
      ? "checking"
      : accessState;

  return { support, devices, error, retry };
}
