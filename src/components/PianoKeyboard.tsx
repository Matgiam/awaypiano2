"use client";

import { useCallback, useEffect, useRef } from "react";
import type { PianoEngine } from "@/lib/audio/piano-engine";
import {
  BLACK_KEYS,
  BLACK_KEY_HEIGHT_RATIO,
  WHITE_KEYS,
  noteHue,
} from "@/lib/piano-layout";
import { noteName } from "@/lib/audio/midi";

/**
 * The 88-key virtual keyboard.
 *
 * Keys are DOM nodes (crisp edges, cheap hover states) positioned with the same
 * normalised geometry the canvas uses, so trails line up with their keys exactly.
 *
 * Highlighting is done by writing `data-active` straight onto the element from
 * the engine's note callback. Routing that through React state would put a
 * render between the key and its own highlight.
 */
export function PianoKeyboard({
  engine,
  velocity,
  enabled,
}: {
  engine: PianoEngine;
  velocity: number;
  enabled: boolean;
}) {
  const containerRef = useRef<HTMLDivElement>(null);
  const keyElements = useRef(new Map<number, HTMLDivElement>());
  /** Note currently held by the mouse/touch pointer, for glissando tracking. */
  const pointerNote = useRef<number | null>(null);

  const registerKey = useCallback(
    (note: number) => (element: HTMLDivElement | null) => {
      if (element) keyElements.current.set(note, element);
      else keyElements.current.delete(note);
    },
    [],
  );

  // Paint key highlights directly from engine events.
  useEffect(() => {
    const elements = keyElements.current;
    const unsubscribe = engine.onNote((event) => {
      const element = elements.get(event.note);
      if (!element) return;
      if (event.type === "on") {
        element.style.setProperty(
          "--key-glow",
          `hsl(${noteHue(event.note)} 92% ${46 + (event.velocity / 127) * 24}%)`,
        );
        element.dataset.active = "true";
      } else {
        delete element.dataset.active;
      }
    });
    return () => {
      unsubscribe();
      for (const element of elements.values()) delete element.dataset.active;
    };
  }, [engine]);

  /** Maps a pointer position to a key. Black keys win where they overlap. */
  const hitTest = useCallback((clientX: number, clientY: number) => {
    const container = containerRef.current;
    if (!container) return null;
    const rect = container.getBoundingClientRect();
    const fx = (clientX - rect.left) / rect.width;
    const fy = (clientY - rect.top) / rect.height;
    if (fx < 0 || fx > 1 || fy < 0 || fy > 1) return null;

    if (fy <= BLACK_KEY_HEIGHT_RATIO) {
      for (const key of BLACK_KEYS) {
        if (fx >= key.x && fx < key.x + key.width) return key.note;
      }
    }
    for (const key of WHITE_KEYS) {
      if (fx >= key.x && fx < key.x + key.width) return key.note;
    }
    return null;
  }, []);

  const releasePointerNote = useCallback(() => {
    if (pointerNote.current !== null) {
      engine.noteOff(pointerNote.current);
      pointerNote.current = null;
    }
  }, [engine]);

  return (
    <div
      ref={containerRef}
      className="relative h-full w-full touch-none select-none"
      onPointerDown={(event) => {
        if (!enabled) return;
        const note = hitTest(event.clientX, event.clientY);
        if (note === null) return;
        try {
          event.currentTarget.setPointerCapture(event.pointerId);
        } catch {
          /* synthetic pointers cannot be captured; release still works */
        }
        pointerNote.current = note;
        engine.noteOn(note, velocity);
      }}
      onPointerMove={(event) => {
        // Dragging across the keyboard glissandos rather than sticking.
        if (!enabled || pointerNote.current === null) return;
        const note = hitTest(event.clientX, event.clientY);
        if (note === null || note === pointerNote.current) return;
        engine.noteOff(pointerNote.current);
        pointerNote.current = note;
        engine.noteOn(note, velocity);
      }}
      onPointerUp={releasePointerNote}
      onPointerCancel={releasePointerNote}
    >
      {WHITE_KEYS.map((key) => (
        <div
          key={key.note}
          ref={registerKey(key.note)}
          className="piano-key piano-key--white absolute top-0 h-full"
          style={{ left: `${key.x * 100}%`, width: `${key.width * 100}%` }}
        >
          {key.note % 12 === 0 && (
            <span className="pointer-events-none absolute inset-x-0 bottom-1.5 text-center text-[0.5rem] font-medium text-black/35">
              {noteName(key.note)}
            </span>
          )}
        </div>
      ))}

      {BLACK_KEYS.map((key) => (
        <div
          key={key.note}
          ref={registerKey(key.note)}
          className="piano-key piano-key--black absolute top-0"
          style={{
            left: `${key.x * 100}%`,
            width: `${key.width * 100}%`,
            height: `${BLACK_KEY_HEIGHT_RATIO * 100}%`,
          }}
        />
      ))}
    </div>
  );
}
