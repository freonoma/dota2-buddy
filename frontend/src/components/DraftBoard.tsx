import type { DraftStore } from "../hooks/useDraftStore";
import { HeroPortrait } from "./HeroPortrait";

interface Props {
  store: DraftStore;
}

function Slot({
  heroId,
  store,
  kind,
}: {
  heroId?: number;
  store: DraftStore;
  kind: "ally" | "enemy" | "ban";
}) {
  const hero = heroId ? store.heroById.get(heroId) : undefined;
  const colorBorder =
    kind === "ally"
      ? "border-ally/40"
      : kind === "enemy"
        ? "border-enemy/40"
        : "border-ban/40";

  if (!hero) {
    return (
      <div
        className={`w-14 h-9 rounded border border-dashed ${colorBorder} bg-bg-elevated/40`}
      />
    );
  }

  return (
    <button
      onClick={() => store.removeHero(hero.id)}
      title={`${hero.localizedName} — click to remove`}
      className="relative group"
    >
      <HeroPortrait
        hero={hero}
        size="md"
        className="ring-1 ring-white/10 group-hover:ring-accent"
      />
      <span className="absolute inset-0 rounded-sm bg-black/0 group-hover:bg-black/50 flex items-center justify-center transition-colors">
        <span className="text-xs font-bold opacity-0 group-hover:opacity-100">
          ×
        </span>
      </span>
    </button>
  );
}

export function DraftBoard({ store }: Props) {
  const { yourSide } = store.draft;
  const allySide = yourSide;
  const enemySide = yourSide === "radiant" ? "dire" : "radiant";

  const allySlots = Array.from(
    { length: 5 },
    (_, i) => store.draft.allyPicks[i]
  );
  const enemySlots = Array.from(
    { length: 5 },
    (_, i) => store.draft.enemyPicks[i]
  );
  const banSlots = Array.from(
    { length: Math.max(4, store.draft.bans.length) },
    (_, i) => store.draft.bans[i]
  );

  return (
    <div className="panel">
      <div className="panel-header">
        <h2 className="text-sm font-semibold uppercase tracking-wide text-slate-300">
          Draft
        </h2>
        <div className="flex items-center gap-2">
          <RoundIndicator round={store.draft.round} />
          <button onClick={store.reset} className="btn-ghost">
            Reset
          </button>
        </div>
      </div>

      <div className="p-4 grid grid-cols-2 gap-6">
        <TeamColumn
          label="Your Team"
          side={allySide}
          slots={allySlots}
          store={store}
          kind="ally"
          onSideClick={() =>
            store.setSide(yourSide === "radiant" ? "dire" : "radiant")
          }
        />
        <TeamColumn
          label="Enemy Team"
          side={enemySide}
          slots={enemySlots}
          store={store}
          kind="enemy"
        />
      </div>

      <div className="px-4 pb-4">
        <div className="text-[10px] uppercase tracking-wider text-muted mb-1">
          Pre-banned
        </div>
        <div className="flex gap-1.5 flex-wrap">
          {banSlots.map((id, i) => (
            <Slot key={i} heroId={id} store={store} kind="ban" />
          ))}
        </div>
      </div>
    </div>
  );
}

function TeamColumn({
  label,
  side,
  slots,
  store,
  kind,
  onSideClick,
}: {
  label: string;
  side: "radiant" | "dire";
  slots: (number | undefined)[];
  store: DraftStore;
  kind: "ally" | "enemy";
  onSideClick?: () => void;
}) {
  return (
    <div>
      <div className="flex items-center gap-2 mb-2">
        <button
          onClick={onSideClick}
          className={`flex items-center gap-1.5 ${
            onSideClick ? "cursor-pointer hover:opacity-80" : "cursor-default"
          }`}
          title={
            onSideClick
              ? `Click to switch sides (currently ${side})`
              : `${side} side`
          }
        >
          <SideIcon side={side} />
          <div className="text-xs uppercase tracking-wider text-slate-400">
            {label}
          </div>
          <div
            className={`text-[10px] px-1.5 py-0.5 rounded ${
              side === "radiant"
                ? "bg-ally/15 text-ally"
                : "bg-enemy/15 text-enemy"
            }`}
          >
            {side}
          </div>
        </button>
      </div>
      <div className="flex gap-1.5 flex-wrap">
        {slots.map((id, i) => (
          <Slot key={i} heroId={id} store={store} kind={kind} />
        ))}
      </div>
    </div>
  );
}

function SideIcon({ side }: { side: "radiant" | "dire" }) {
  return (
    <img
      src={side === "radiant" ? "/radiant.png" : "/dire.png"}
      alt={side}
      width={18}
      height={18}
      className="shrink-0"
      draggable={false}
    />
  );
}

function RoundIndicator({ round }: { round: 1 | 2 | 3 }) {
  return (
    <div className="flex bg-bg-elevated rounded-md overflow-hidden text-xs">
      {[1, 2, 3].map((r) => (
        <div
          key={r}
          className={`px-2.5 py-1 ${
            round === r ? "bg-accent/30 text-accent" : "text-slate-500"
          }`}
        >
          R{r}
        </div>
      ))}
    </div>
  );
}
