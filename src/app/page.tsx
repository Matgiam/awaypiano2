import {
  SOUNDFONTS,
  SOUNDFONT_LIBRARY_BYTES,
  DEFAULT_SOUNDFONT_ID,
  groupSoundfontsByFamily,
} from "@/lib/soundfont-manifest";
import { formatBytes } from "@/lib/format";

/**
 * Phase 1 status page.
 *
 * This is scaffolding, not the product: it proves the environment is wired up
 * and that every migrated SoundFont is discoverable and servable. Phase 4
 * replaces it with the keyboard and visualiser.
 */

const PHASES = [
  { id: 1, name: "Foundation & asset migration", state: "done" },
  { id: 2, name: "Audio & hardware core", state: "next" },
  { id: 3, name: "The pitch engine", state: "todo" },
  { id: 4, name: "UI & visualiser", state: "todo" },
  { id: 5, name: "Polish", state: "todo" },
] as const;

function Stat({
  label,
  value,
  detail,
}: {
  label: string;
  value: string;
  detail: string;
}) {
  return (
    <div className="rounded-xl border border-edge bg-surface/60 p-5 backdrop-blur-sm">
      <div className="text-[0.7rem] font-medium uppercase tracking-[0.14em] text-faint">
        {label}
      </div>
      <div className="numeric mt-2 text-2xl text-bright">{value}</div>
      <div className="mt-1 text-sm text-muted">{detail}</div>
    </div>
  );
}

export default function Home() {
  const families = groupSoundfontsByFamily();
  const defaultBank = SOUNDFONTS.find(
    (entry) => entry.id === DEFAULT_SOUNDFONT_ID,
  );
  const sf3Count = SOUNDFONTS.filter((entry) => entry.format === "sf3").length;

  return (
    <main className="mx-auto w-full max-w-5xl flex-1 px-6 py-16 sm:py-24">
      <header>
        <p className="numeric text-xs uppercase tracking-[0.24em] text-accent">
          Phase 01 · Foundation
        </p>
        <h1 className="mt-4 text-4xl font-semibold tracking-tight text-bright sm:text-5xl">
          Solo Resonance
        </h1>
        <p className="mt-4 max-w-2xl text-lg leading-relaxed text-muted">
          Environment initialised and the SoundFont library migrated. The audio
          engine, MIDI input, and visualiser land in the phases below.
        </p>
      </header>

      <section className="mt-12 grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <Stat
          label="Framework"
          value="Next 16.3"
          detail="App Router · React 19 · TS"
        />
        <Stat
          label="Audio engine"
          value="spessasynth"
          detail="AudioWorklet · SF2/SF3"
        />
        <Stat
          label="Banks migrated"
          value={String(SOUNDFONTS.length)}
          detail={`${sf3Count} compressed SF3`}
        />
        <Stat
          label="Library size"
          value={formatBytes(SOUNDFONT_LIBRARY_BYTES, 0)}
          detail="tracked via Git LFS"
        />
      </section>

      <section className="mt-6 rounded-xl border border-edge bg-surface/60 p-5 backdrop-blur-sm">
        <div className="text-[0.7rem] font-medium uppercase tracking-[0.14em] text-faint">
          Default bank
        </div>
        {defaultBank ? (
          <div className="mt-2 flex flex-wrap items-baseline gap-x-3 gap-y-1">
            <span className="text-lg text-bright">{defaultBank.name}</span>
            <span className="numeric text-sm text-muted">
              {defaultBank.format.toUpperCase()} ·{" "}
              {formatBytes(defaultBank.bytes)}
            </span>
            <code className="numeric text-xs text-faint">
              {defaultBank.url}
            </code>
          </div>
        ) : (
          <div className="mt-2 text-signal">
            Missing — expected id “{DEFAULT_SOUNDFONT_ID}”.
          </div>
        )}
      </section>

      <section className="mt-16">
        <h2 className="text-sm font-medium uppercase tracking-[0.14em] text-faint">
          Instrument families
        </h2>
        <div className="mt-5 grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {families.map((family) => {
            const bytes = family.entries.reduce(
              (sum, entry) => sum + entry.bytes,
              0,
            );

            return (
              <article
                key={family.family}
                className="group rounded-xl border border-edge bg-surface/40 p-4 transition-colors hover:border-edge-bright hover:bg-surface-raised/50"
              >
                <div className="flex items-baseline justify-between gap-3">
                  <h3 className="font-medium text-bright">{family.label}</h3>
                  <span className="numeric shrink-0 text-xs text-faint">
                    {family.entries.length} · {formatBytes(bytes, 0)}
                  </span>
                </div>
                <ul className="mt-3 space-y-1">
                  {family.entries.slice(0, 4).map((entry) => (
                    <li key={entry.id} className="truncate text-sm text-muted">
                      {entry.name}
                    </li>
                  ))}
                  {family.entries.length > 4 && (
                    <li className="numeric text-xs text-faint">
                      +{family.entries.length - 4} more
                    </li>
                  )}
                </ul>
              </article>
            );
          })}
        </div>
      </section>

      <section className="mt-16">
        <h2 className="text-sm font-medium uppercase tracking-[0.14em] text-faint">
          Roadmap
        </h2>
        <ol className="mt-5 divide-y divide-edge overflow-hidden rounded-xl border border-edge bg-surface/40">
          {PHASES.map((phase) => (
            <li
              key={phase.id}
              className="flex items-center gap-4 px-5 py-3.5 text-sm"
            >
              <span className="numeric w-6 shrink-0 text-faint">
                {String(phase.id).padStart(2, "0")}
              </span>
              <span
                className={
                  phase.state === "todo" ? "flex-1 text-faint" : "flex-1 text-bright"
                }
              >
                {phase.name}
              </span>
              {phase.state === "done" && (
                <span className="numeric text-xs uppercase tracking-wider text-signal">
                  complete
                </span>
              )}
              {phase.state === "next" && (
                <span className="numeric text-xs uppercase tracking-wider text-accent">
                  next
                </span>
              )}
            </li>
          ))}
        </ol>
      </section>
    </main>
  );
}
