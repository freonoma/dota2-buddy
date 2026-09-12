import { useState } from "react";
import type { DraftStore } from "../hooks/useDraftStore";
import type { Hero, Recommendation } from "../types";
import { HeroPortrait } from "./HeroPortrait";

interface Props {
  store: DraftStore;
}

export function Recommendations({ store }: Props) {
  const { recommendations, heroById, profile, draft } = store;

  return (
    <div className="panel flex flex-col h-full">
      <div className="panel-header">
        <h2 className="text-sm font-semibold uppercase tracking-wide text-slate-300">
          Recommended Picks
        </h2>
        <RolePicker store={store} />
      </div>

      <ScoreLegend />

      <div className="p-3 flex-1 overflow-y-auto space-y-2">
        {recommendations.length === 0 ? (
          <div className="text-center text-muted text-sm py-12">
            Add picks below to see recommendations
          </div>
        ) : (
          recommendations.map((rec, idx) => (
            <RecRow
              key={rec.heroId}
              rec={rec}
              rank={idx + 1}
              heroById={heroById}
              comfort={profile?.heroComfort[rec.heroId]?.comfortLevel}
              draftAllies={draft.allyPicks}
              draftEnemies={draft.enemyPicks}
              yourRole={draft.yourRole}
            />
          ))
        )}
      </div>
    </div>
  );
}

function ScoreLegend() {
  return (
    <div className="px-4 py-2 border-b border-white/5 text-[10px] text-muted flex items-center gap-3 flex-wrap">
      <span className="text-slate-400">0-100 scores, not win rates</span>
      <span title="Matchup edge against the enemy picks, beyond what this hero's overall strength already implies. 50 is neutral.">
        <b className="text-slate-400">counter</b> · edge vs enemy picks
      </span>
      <span title="How well this hero's roles fill the gaps in the ally team. 50 is neutral.">
        <b className="text-slate-400">synergy</b> · fits ally team
      </span>
      <span title="This hero's overall win rate at your bracket, rescaled.">
        <b className="text-slate-400">meta</b> · bracket strength
      </span>
      <span title="Your star rating for this hero, rescaled.">
        <b className="text-slate-400">comfort</b> · your hero pool
      </span>
    </div>
  );
}

const EXPLAIN_TIMEOUT_MS = 30000;

// An explanation is only valid for the draft it was requested for.
type ExplainState =
  | { draftKey: string; status: "loading" }
  | { draftKey: string; status: "ready"; text: string }
  | { draftKey: string; status: "error" };

function RecRow({
  rec,
  rank,
  heroById,
  comfort,
  draftAllies,
  draftEnemies,
  yourRole,
}: {
  rec: Recommendation;
  rank: number;
  heroById: Map<number, Hero>;
  comfort: number | undefined;
  draftAllies: number[];
  draftEnemies: number[];
  yourRole: number;
}) {
  const hero = heroById.get(rec.heroId);
  const [explain, setExplain] = useState<ExplainState | null>(null);

  if (!hero) return null;

  const draftKey = `${yourRole}|${draftAllies.join(",")}|${draftEnemies.join(",")}`;
  const current = explain?.draftKey === draftKey ? explain : null;

  const fetchExplanation = async () => {
    if (current && current.status !== "error") return;
    setExplain({ draftKey, status: "loading" });
    try {
      const res = await fetch("/api/explain", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          heroId: hero.id,
          allyHeroIds: draftAllies,
          enemyHeroIds: draftEnemies,
          yourRole,
        }),
        signal: AbortSignal.timeout(EXPLAIN_TIMEOUT_MS),
      });
      const json = await res.json();
      if (!res.ok) {
        throw new Error(json.error ?? `HTTP ${res.status}`);
      }
      setExplain((prev) =>
        prev?.draftKey === draftKey
          ? { draftKey, status: "ready", text: json.explanation }
          : prev
      );
    } catch (e) {
      console.error("Explain request failed", e);
      setExplain((prev) =>
        prev?.draftKey === draftKey ? { draftKey, status: "error" } : prev
      );
    }
  };

  return (
    <div className="bg-bg-elevated rounded-md p-2.5 hover:bg-bg-hover transition-colors">
      <div className="flex items-center gap-3">
        <div className="w-6 text-center text-muted text-sm font-semibold">
          {rank}
        </div>
        <HeroPortrait hero={hero} size="md" />
        <div className="flex-1 min-w-0">
          <div className="flex items-baseline justify-between gap-2">
            <div className="font-semibold text-slate-100 truncate">
              {hero.localizedName}
            </div>
            <div className="text-accent font-bold text-lg leading-none">
              {rec.totalScore.toFixed(0)}
            </div>
          </div>
          <div className="flex items-center gap-3 text-[11px] text-muted mt-0.5 flex-wrap">
            <Stat label="counter" value={rec.breakdown.counterScore} />
            <Stat label="synergy" value={rec.breakdown.synergyScore} />
            <Stat label="meta" value={rec.breakdown.metaScore} />
            <Stat label="comfort" value={rec.breakdown.comfortScore} />
            <ComfortStars value={comfort} />
            <button
              onClick={fetchExplanation}
              disabled={current?.status === "loading"}
              className="ml-auto text-[10px] uppercase tracking-wider text-accent/80 hover:text-accent disabled:text-muted px-1.5 py-0.5 rounded border border-accent/20 hover:border-accent/50"
              title="Get a one-sentence reasoning from Claude"
            >
              {current?.status === "loading"
                ? "thinking…"
                : current?.status === "ready"
                  ? "why ✓"
                  : "why?"}
            </button>
          </div>
        </div>
      </div>
      {current?.status === "ready" && (
        <div className="mt-2 pl-9 text-xs text-slate-300 leading-relaxed border-l-2 border-accent/30 ml-3 pl-3">
          {current.text}
        </div>
      )}
      {current?.status === "error" && (
        <div className="mt-2 pl-9 text-xs text-enemy/80">
          Couldn't get an explanation — try again.
        </div>
      )}
    </div>
  );
}

function Stat({ label, value }: { label: string; value: number }) {
  const color =
    value >= 65
      ? "text-ally"
      : value >= 45
        ? "text-slate-300"
        : "text-enemy/80";
  return (
    <span className="tabular-nums">
      <span className="text-muted">{label}</span>{" "}
      <span className={color}>{value.toFixed(0)}</span>
    </span>
  );
}

function ComfortStars({ value }: { value?: number }) {
  if (!value) return <span className="text-muted/50">·····</span>;
  return (
    <span className="text-accent" title={`Comfort: ${value}/5 stars`}>
      {"★".repeat(value)}
      <span className="text-muted/50">{"★".repeat(5 - value)}</span>
    </span>
  );
}

function RolePicker({ store }: { store: DraftStore }) {
  return (
    <div className="flex items-center gap-1 text-xs">
      <span className="text-muted mr-1">Role</span>
      {[1, 2, 3, 4, 5].map((r) => (
        <button
          key={r}
          onClick={() => store.setRole(r)}
          className={`w-6 h-6 rounded ${
            store.draft.yourRole === r
              ? "bg-accent/30 text-accent border border-accent/50"
              : "bg-bg-elevated text-muted hover:text-slate-200"
          }`}
        >
          {r}
        </button>
      ))}
    </div>
  );
}
