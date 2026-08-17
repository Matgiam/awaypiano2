import { MIDI_NOTE_MAX, MIDI_NOTE_MIN, isBlackKey } from "./audio/midi";

/**
 * Geometry for an 88-key piano.
 *
 * Positions are normalised fractions of the total keyboard width (0..1) rather
 * than pixels, so the canvas visualiser and the DOM keyboard can share one
 * source of truth and stay aligned at any viewport size.
 */

/** Black keys are narrower than white ones; this is the classic proportion. */
const BLACK_WIDTH_RATIO = 0.62;

/** Black keys reach only part-way down the keyboard. */
export const BLACK_KEY_HEIGHT_RATIO = 0.62;

export interface KeyGeometry {
  readonly note: number;
  readonly isBlack: boolean;
  /** Left edge, as a fraction of total keyboard width. */
  readonly x: number;
  /** Width, as a fraction of total keyboard width. */
  readonly width: number;
  /** Horizontal centre, as a fraction of total width. */
  readonly centre: number;
}

function buildKeys(): { keys: KeyGeometry[]; whiteCount: number } {
  // First pass: how many white keys are there in the range?
  let whites = 0;
  for (let note = MIDI_NOTE_MIN; note <= MIDI_NOTE_MAX; note++) {
    if (!isBlackKey(note)) whites++;
  }

  const whiteWidth = 1 / whites;
  const blackWidth = whiteWidth * BLACK_WIDTH_RATIO;
  const keys: KeyGeometry[] = [];

  // Second pass: white keys tile left to right; each black key straddles the
  // boundary between the white key before it and the one after.
  let whiteIndex = 0;
  for (let note = MIDI_NOTE_MIN; note <= MIDI_NOTE_MAX; note++) {
    if (isBlackKey(note)) {
      const x = whiteIndex * whiteWidth - blackWidth / 2;
      keys.push({
        note,
        isBlack: true,
        x,
        width: blackWidth,
        centre: x + blackWidth / 2,
      });
    } else {
      const x = whiteIndex * whiteWidth;
      keys.push({
        note,
        isBlack: false,
        x,
        width: whiteWidth,
        centre: x + whiteWidth / 2,
      });
      whiteIndex++;
    }
  }

  return { keys, whiteCount: whites };
}

const built = buildKeys();

/** Every key, in ascending pitch order. */
export const PIANO_KEYS: readonly KeyGeometry[] = built.keys;

/** 52 on a standard 88-key instrument. */
export const WHITE_KEY_COUNT = built.whiteCount;

/** Fast lookup from MIDI note to its geometry. */
export const KEY_BY_NOTE: ReadonlyMap<number, KeyGeometry> = new Map(
  PIANO_KEYS.map((key) => [key.note, key]),
);

/** White keys only — the layer rendered underneath the black keys. */
export const WHITE_KEYS: readonly KeyGeometry[] = PIANO_KEYS.filter(
  (key) => !key.isBlack,
);

/** Black keys only — drawn on top, so they win hit-testing. */
export const BLACK_KEYS: readonly KeyGeometry[] = PIANO_KEYS.filter(
  (key) => key.isBlack,
);

/**
 * Hue for a note, ramped across the keyboard so the low end reads violet and
 * the top end reads teal. Gives the trails a spectrum without needing a palette.
 */
export function noteHue(note: number): number {
  const t = (note - MIDI_NOTE_MIN) / (MIDI_NOTE_MAX - MIDI_NOTE_MIN);
  // 268deg (violet) down to 172deg (teal).
  return 268 - t * 96;
}
