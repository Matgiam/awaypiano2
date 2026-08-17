/**
 * MIDI primitives shared by the input layer, the audio engine, and (from
 * Phase 4) the keyboard and visualiser.
 */

/** Lowest key on an 88-key piano: A0. */
export const MIDI_NOTE_MIN = 21;
/** Highest key on an 88-key piano: C8. */
export const MIDI_NOTE_MAX = 108;
/** Number of keys on a standard piano. */
export const PIANO_KEY_COUNT = MIDI_NOTE_MAX - MIDI_NOTE_MIN + 1;

/** MIDI note number of A4, the tuning reference. */
export const MIDI_NOTE_A4 = 69;

/** The MIDI channel the solo piano plays on. */
export const PIANO_CHANNEL = 0;

/**
 * Status bytes, with the channel nibble masked off.
 * A MIDI status byte is `0b1sssnnnn`: `sss` is the message type, `nnnn` the channel.
 */
export const MIDI_STATUS = {
  noteOff: 0x80,
  noteOn: 0x90,
  polyPressure: 0xa0,
  controlChange: 0xb0,
  programChange: 0xc0,
  channelPressure: 0xd0,
  pitchBend: 0xe0,
  system: 0xf0,
} as const;

/** Control Change numbers we act on. */
export const MIDI_CC = {
  bankSelectMSB: 0,
  bankSelectLSB: 32,
  sustainPedal: 64,
  sostenutoPedal: 66,
  softPedal: 67,
  allSoundOff: 120,
  allNotesOff: 123,
} as const;

const NOTE_NAMES = [
  "C",
  "C#",
  "D",
  "D#",
  "E",
  "F",
  "F#",
  "G",
  "G#",
  "A",
  "A#",
  "B",
] as const;

/** Pitch classes that sit on a black key. */
const BLACK_PITCH_CLASSES = new Set([1, 3, 6, 8, 10]);

/** True when the note falls on a black (accidental) key. */
export function isBlackKey(midiNote: number): boolean {
  return BLACK_PITCH_CLASSES.has(((midiNote % 12) + 12) % 12);
}

/**
 * Scientific pitch notation, e.g. 60 -> "C4", 21 -> "A0".
 * MIDI note 60 is middle C, which is C4 under this convention.
 */
export function noteName(midiNote: number): string {
  const pitchClass = ((midiNote % 12) + 12) % 12;
  const octave = Math.floor(midiNote / 12) - 1;
  return `${NOTE_NAMES[pitchClass]}${octave}`;
}

/**
 * Equal-temperament frequency for a MIDI note.
 *
 * `referenceHz` is the frequency of A4 — the knob Phase 3 exposes so the whole
 * instrument can be retuned from 440 Hz to 432 Hz and beyond.
 */
export function noteFrequency(midiNote: number, referenceHz = 440): number {
  return referenceHz * 2 ** ((midiNote - MIDI_NOTE_A4) / 12);
}

/**
 * Convert a tuning reference in Hz to an offset in cents from A=440.
 * 432 Hz works out to about -31.77 cents.
 */
export function hzToCents(referenceHz: number, baseHz = 440): number {
  return 1200 * Math.log2(referenceHz / baseHz);
}

/** True when the note is within the range of a physical 88-key piano. */
export function isPianoKey(midiNote: number): boolean {
  return midiNote >= MIDI_NOTE_MIN && midiNote <= MIDI_NOTE_MAX;
}
