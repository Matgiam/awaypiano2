"use client";

import { useEffect, useRef } from "react";
import type { PianoEngine } from "@/lib/audio/piano-engine";
import { KEY_BY_NOTE, PIANO_KEYS, noteHue } from "@/lib/piano-layout";

/**
 * Synthesia-style note trails.
 *
 * A trail is born at the keyboard when a key goes down and grows upward for as
 * long as the key is held; on release it detaches and drifts off the top. All of
 * it lives inside one effect — the trail list is a plain array mutated by the
 * engine's note callback, never React state, so a keypress costs no render.
 */

/** Milliseconds for a released trail to travel the full height. */
const TRAVEL_MS = 2600;
/** Hard cap so a stuck sustain pedal cannot grow the array without bound. */
const MAX_TRAILS = 512;

interface Trail {
  note: number;
  velocity: number;
  startedAt: number;
  /** null while the key is still held. */
  endedAt: number | null;
}

export function NoteTrails({
  engine,
  className,
}: {
  engine: PianoEngine;
  className?: string;
}) {
  const canvasRef = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    const canvas = canvasRef.current;
    const ctx = canvas?.getContext("2d");
    if (!canvas || !ctx) return;

    const trails: Trail[] = [];
    const openByNote = new Map<number, Trail>();

    const unsubscribe = engine.onNote((event) => {
      if (event.type === "on") {
        // A retrigger before release closes the previous trail so the two
        // strikes read as separate blocks rather than one long smear.
        const previous = openByNote.get(event.note);
        if (previous && previous.endedAt === null) previous.endedAt = event.time;

        const trail: Trail = {
          note: event.note,
          velocity: event.velocity,
          startedAt: event.time,
          endedAt: null,
        };
        trails.push(trail);
        openByNote.set(event.note, trail);

        if (trails.length > MAX_TRAILS) {
          trails.splice(0, trails.length - MAX_TRAILS);
        }
      } else {
        const open = openByNote.get(event.note);
        if (open && open.endedAt === null) open.endedAt = event.time;
        openByNote.delete(event.note);
      }
    });

    let width = 0;
    let height = 0;

    const resize = () => {
      const rect = canvas.getBoundingClientRect();
      // Cap DPR at 2 — beyond that the fill cost outweighs the visible gain.
      const dpr = Math.min(window.devicePixelRatio || 1, 2);
      width = rect.width;
      height = rect.height;
      canvas.width = Math.round(width * dpr);
      canvas.height = Math.round(height * dpr);
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    };

    resize();
    const observer = new ResizeObserver(resize);
    observer.observe(canvas);

    let frame = 0;

    const draw = () => {
      frame = requestAnimationFrame(draw);
      if (width === 0 || height === 0) return;

      const now = performance.now();
      ctx.clearRect(0, 0, width, height);

      // Faint octave guides at each C, so the eye can find its place.
      ctx.fillStyle = "rgba(255,255,255,0.035)";
      for (const key of PIANO_KEYS) {
        if (key.note % 12 === 0) ctx.fillRect(key.x * width, 0, 1, height);
      }

      const speed = height / TRAVEL_MS;

      for (let i = trails.length - 1; i >= 0; i--) {
        const trail = trails[i];
        const key = KEY_BY_NOTE.get(trail.note);
        if (!key) {
          trails.splice(i, 1);
          continue;
        }

        // Distance travelled by the bottom edge. Zero while the key is held,
        // which is what pins the trail to the keyboard as it grows.
        const headOffset =
          trail.endedAt === null ? 0 : (now - trail.endedAt) * speed;
        if (headOffset > height) {
          trails.splice(i, 1);
          continue;
        }

        const tailOffset = (now - trail.startedAt) * speed;
        const yBottom = height - headOffset;
        const yTop = Math.max(-40, height - tailOffset);
        const barHeight = yBottom - yTop;
        if (barHeight <= 0.5) continue;

        const x = key.x * width;
        const w = Math.max(2, key.width * width - 1.5);
        const hue = noteHue(trail.note);
        const velocity = trail.velocity / 127;
        const lightness = 42 + velocity * 26;
        // Released trails fade as they climb.
        const fade =
          trail.endedAt === null ? 1 : Math.max(0, 1 - headOffset / height);

        const gradient = ctx.createLinearGradient(0, yBottom, 0, yTop);
        gradient.addColorStop(
          0,
          `hsla(${hue}, 92%, ${lightness}%, ${0.95 * fade})`,
        );
        gradient.addColorStop(
          1,
          `hsla(${hue}, 88%, ${lightness - 12}%, ${0.22 * fade})`,
        );

        ctx.beginPath();
        ctx.roundRect(x + 0.75, yTop, w, barHeight, Math.min(5, w / 2));
        ctx.fillStyle = gradient;
        ctx.shadowColor = `hsla(${hue}, 95%, 62%, ${0.5 * velocity * fade})`;
        ctx.shadowBlur = 14 * velocity;
        ctx.fill();
        ctx.shadowBlur = 0;

        // Bright cap on the leading edge gives the strike its punch.
        if (barHeight > 3) {
          ctx.fillStyle = `hsla(${hue}, 100%, ${72 + velocity * 18}%, ${0.9 * fade})`;
          ctx.beginPath();
          ctx.roundRect(x + 0.75, yBottom - 2.5, w, 2.5, 1.25);
          ctx.fill();
        }
      }
    };

    frame = requestAnimationFrame(draw);

    return () => {
      cancelAnimationFrame(frame);
      observer.disconnect();
      unsubscribe();
    };
  }, [engine]);

  return <canvas ref={canvasRef} className={className} aria-hidden="true" />;
}
