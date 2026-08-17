import { PianoStudio } from "@/components/PianoStudio";

/**
 * The studio is entirely client-side: it owns an AudioContext, a Web MIDI
 * connection, and (from Phase 4) a canvas. Nothing here can be server-rendered
 * beyond the initial shell.
 */
export default function Home() {
  return <PianoStudio />;
}
