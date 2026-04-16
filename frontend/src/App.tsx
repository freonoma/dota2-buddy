import { useState } from "react";
import { useDraftStore } from "./hooks/useDraftStore";
import { DraftBoard } from "./components/DraftBoard";
import { Recommendations } from "./components/Recommendations";
import { HeroGrid } from "./components/HeroGrid";
import { ProfileModal } from "./components/ProfileModal";
import { BanSuggestionsModal } from "./components/BanSuggestionsModal";

export default function App() {
  const store = useDraftStore();
  const [profileOpen, setProfileOpen] = useState(false);
  const [bansOpen, setBansOpen] = useState(false);

  return (
    <div className="min-h-screen text-slate-100">
      <header className="border-b border-white/5 bg-bg-panel/60 backdrop-blur sticky top-0 z-10">
        <div className="max-w-[1400px] mx-auto px-6 py-3 flex items-center justify-between">
          <div className="flex items-center gap-3">
            <img
              src="/dota-logo.png"
              alt="Dota 2"
              width={32}
              height={32}
              className="shrink-0"
            />
            <div>
              <div className="font-semibold leading-tight">
                Dota 2 Buddy
                <span className="text-muted font-normal text-xs ml-1.5">
                  Draft Assistant
                </span>
              </div>
              <div className="text-[11px] text-muted leading-tight">
                Round {store.draft.round} of 3 · Pos {store.draft.yourRole}
              </div>
            </div>
          </div>
          <div className="flex items-center gap-2">
            <span
              className={`text-[11px] px-2 py-0.5 rounded-full border ${
                store.connected
                  ? "border-ally/50 text-ally bg-ally/10"
                  : "border-enemy/50 text-enemy bg-enemy/10"
              }`}
            >
              {store.connected ? "● connected" : "○ offline"}
            </span>
            <span className="text-[11px] text-muted">
              {store.heroes.length} heroes
            </span>
            <button
              onClick={() => setBansOpen(true)}
              className="btn-ghost text-xs"
              title="Pre-queue ban suggestions based on your hero pool"
            >
              Bans
            </button>
            <button
              onClick={() => setProfileOpen(true)}
              className="btn-ghost text-xs"
              title={
                store.profile
                  ? `${store.profile.name} · ${store.profile.mmr ?? "?"} MMR`
                  : "Profile"
              }
            >
              {store.profile?.name ?? "Profile"}
            </button>
          </div>
        </div>
      </header>

      <main className="max-w-[1400px] mx-auto p-6 grid grid-cols-1 lg:grid-cols-[1.2fr_1fr] gap-4">
        <div className="space-y-4">
          <DraftBoard store={store} />
          <HeroGrid store={store} />
        </div>
        <div className="lg:sticky lg:top-[72px] lg:h-[calc(100vh-92px)]">
          <Recommendations store={store} />
        </div>
      </main>

      <ProfileModal
        store={store}
        open={profileOpen}
        onClose={() => setProfileOpen(false)}
      />
      <BanSuggestionsModal
        open={bansOpen}
        onClose={() => setBansOpen(false)}
        heroes={store.heroes}
      />
    </div>
  );
}
