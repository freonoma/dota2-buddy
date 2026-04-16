import { useEffect, useState } from "react";
import type { Hero } from "../types";
import { HeroPortrait } from "./HeroPortrait";

interface BanSuggestion {
  heroId: number;
  heroName: string;
  iconUrl: string;
  banScore: number;
  worstMatchups: Array<{
    heroId: number;
    heroName: string;
    winRateAgainstYou: number;
    yourComfort: number;
    yourGames: number;
  }>;
}

interface Props {
  open: boolean;
  onClose: () => void;
  heroes: Hero[];
}

export function BanSuggestionsModal({ open, onClose, heroes }: Props) {
  const [suggestions, setSuggestions] = useState<BanSuggestion[] | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const heroById = new Map(heroes.map((h) => [h.id, h]));

  useEffect(() => {
    if (!open) return;
    setLoading(true);
    setError(null);
    fetch("/api/bans")
      .then((r) => r.json())
      .then((j) => setSuggestions(j.suggestions ?? []))
      .catch((e) => setError(e instanceof Error ? e.message : String(e)))
      .finally(() => setLoading(false));
  }, [open]);

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, onClose]);

  if (!open) return null;

  return (
    <div
      className="fixed inset-0 z-50 bg-black/70 backdrop-blur-sm flex items-center justify-center p-4"
      onClick={onClose}
    >
      <div
        className="panel w-full max-w-2xl max-h-[90vh] flex flex-col"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="panel-header">
          <h2 className="text-sm font-semibold uppercase tracking-wide text-slate-300">
            Pre-queue ban suggestions
          </h2>
          <button onClick={onClose} className="btn-ghost">
            Close
          </button>
        </div>

        <div className="p-4 overflow-y-auto">
          <p className="text-xs text-muted mb-4 max-w-xl">
            The 4 heroes that hurt your hero pool the most. Set these as your
            ban preferences in the Dota 2 Heroes tab before queueing. Computed
            from matchup data against the heroes you have at 3+ stars comfort.
          </p>

          {loading && (
            <div className="text-center text-muted text-sm py-8">
              Computing…
            </div>
          )}
          {error && (
            <div className="text-xs text-enemy mt-2">{error}</div>
          )}
          {suggestions && suggestions.length === 0 && (
            <div className="text-sm text-muted py-8 text-center max-w-md mx-auto">
              No ban suggestions yet. Either you don't have any heroes rated
              3+ stars in your profile, or matchup data hasn't been fetched (
              <code className="bg-bg-elevated px-1 rounded">
                npm run fetch-data
              </code>
              ).
            </div>
          )}
          {suggestions && suggestions.length > 0 && (
            <div className="space-y-2">
              {suggestions.map((s, i) => {
                const hero = heroById.get(s.heroId);
                return (
                  <div
                    key={s.heroId}
                    className="bg-bg-elevated rounded-md p-3 flex items-start gap-3"
                  >
                    <div className="w-6 text-center text-muted text-sm font-semibold pt-1">
                      {i + 1}
                    </div>
                    {hero && <HeroPortrait hero={hero} size="md" />}
                    <div className="flex-1 min-w-0">
                      <div className="flex items-baseline justify-between gap-2">
                        <div className="font-semibold text-slate-100">
                          {s.heroName}
                        </div>
                        <div className="text-enemy text-sm font-bold">
                          {s.banScore.toFixed(0)}
                        </div>
                      </div>
                      <div className="text-[11px] text-muted mt-1">
                        Beats your{" "}
                        {s.worstMatchups.map((m, j) => (
                          <span key={m.heroId}>
                            {j > 0 && ", "}
                            <span className="text-slate-300">{m.heroName}</span>{" "}
                            ({(m.winRateAgainstYou * 100).toFixed(0)}%)
                          </span>
                        ))}
                      </div>
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
