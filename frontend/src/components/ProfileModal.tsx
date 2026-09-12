import { useEffect, useRef, useState } from "react";
import type { DraftStore } from "../hooks/useDraftStore";
import type { Hero, PlayerProfile, ScreenshotImportResult } from "../types";
import { HeroPortrait } from "./HeroPortrait";

interface Props {
  store: DraftStore;
  open: boolean;
  onClose: () => void;
}

const RANKS: PlayerProfile["rankBracket"][] = [
  "herald",
  "guardian",
  "crusader",
  "archon",
  "legend",
  "ancient",
  "divine",
  "immortal",
];

const FOCUSABLE_SELECTOR =
  'a[href], button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])';

interface HealthStatus {
  extractionMode: "api" | "cli";
  cliBinary: string | null;
}

type EditableRow = ScreenshotImportResult["matched"][number];

export function ProfileModal({ store, open, onClose }: Props) {
  const { profile, heroes, saveProfile } = store;
  const [draft, setDraft] = useState<PlayerProfile | null>(profile);
  const [importing, setImporting] = useState(false);
  const [applying, setApplying] = useState(false);
  const [importError, setImportError] = useState<string | null>(null);
  const [pendingRows, setPendingRows] = useState<EditableRow[]>([]);
  const [unmatchedNotice, setUnmatchedNotice] = useState<string | null>(null);
  const [health, setHealth] = useState<HealthStatus | null>(null);
  const dirtyRef = useRef(false);
  const panelRef = useRef<HTMLDivElement>(null);

  // A server push must not clobber edits the user has not saved.
  useEffect(() => {
    if (open && dirtyRef.current) return;
    dirtyRef.current = false;
    setDraft(profile);
  }, [open, profile]);

  useEffect(() => {
    if (!open) return;
    fetch("/api/health")
      .then((r) => r.json())
      .then(setHealth)
      .catch(() => {});
  }, [open]);

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        onClose();
        return;
      }
      if (e.key !== "Tab") return;
      const panel = panelRef.current;
      if (!panel) return;
      // offsetParent is null for display:none, dropping the hidden file input.
      const focusable = Array.from(
        panel.querySelectorAll<HTMLElement>(FOCUSABLE_SELECTOR)
      ).filter((el) => el.offsetParent !== null);
      if (focusable.length === 0) return;
      const first = focusable[0];
      const last = focusable[focusable.length - 1];
      const active = document.activeElement;
      if (!panel.contains(active)) {
        e.preventDefault();
        first.focus();
      } else if (e.shiftKey && (active === first || active === panel)) {
        e.preventDefault();
        last.focus();
      } else if (!e.shiftKey && active === last) {
        e.preventDefault();
        first.focus();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, onClose]);

  const showing = open && draft !== null;

  useEffect(() => {
    if (!showing) return;
    const restoreTo = document.activeElement as HTMLElement | null;
    panelRef.current?.focus();
    return () => {
      restoreTo?.focus();
    };
  }, [showing]);

  if (!open || !draft) return null;

  const editDraft = (update: (current: PlayerProfile) => PlayerProfile) => {
    dirtyRef.current = true;
    setDraft((d) => (d ? update(d) : d));
  };

  const handleSave = () => {
    saveProfile(draft);
    onClose();
  };

  const setComfort = (heroId: number, level: 1 | 2 | 3 | 4 | 5 | 0) => {
    editDraft((d) => {
      const next = { ...d, heroComfort: { ...d.heroComfort } };
      if (level === 0) {
        delete next.heroComfort[heroId];
      } else {
        next.heroComfort[heroId] = {
          ...(next.heroComfort[heroId] ?? {}),
          comfortLevel: level,
        };
      }
      return next;
    });
  };

  const handleFile = async (file: File) => {
    setImporting(true);
    setImportError(null);
    setUnmatchedNotice(null);
    try {
      const base64 = await toBase64(file);
      const mediaType = file.type as
        | "image/png"
        | "image/jpeg"
        | "image/webp"
        | "image/gif";
      const res = await fetch("/api/profile/extract-screenshot", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ image: base64, mediaType }),
      });
      const json = await res.json();
      if (!res.ok) {
        throw new Error(json.error ?? `HTTP ${res.status}`);
      }
      const result = json.result as ScreenshotImportResult;
      // Append to existing pending rows so a second screenshot adds to the
      // first instead of replacing it. Dedupe by hero ID — newer wins.
      setPendingRows((prev) => {
        const byId = new Map<number, EditableRow>();
        for (const row of prev) byId.set(row.heroId, row);
        for (const row of result.matched) byId.set(row.heroId, row);
        return Array.from(byId.values());
      });
      if (result.unmatched.length > 0) {
        setUnmatchedNotice(
          `${result.unmatched.length} row${result.unmatched.length === 1 ? "" : "s"} couldn't be matched: ${result.unmatched.map((u) => u.rawName).join(", ")}`
        );
      }
    } catch (e) {
      setImportError(e instanceof Error ? e.message : String(e));
    } finally {
      setImporting(false);
    }
  };

  const updateRow = (index: number, patch: Partial<EditableRow>) => {
    setPendingRows((prev) =>
      prev.map((r, i) => (i === index ? { ...r, ...patch } : r))
    );
  };

  const removeRow = (index: number) => {
    setPendingRows((prev) => prev.filter((_, i) => i !== index));
  };

  const applyImport = async () => {
    if (pendingRows.length === 0) return;
    setApplying(true);
    setImportError(null);
    try {
      const res = await fetch("/api/profile/apply-import", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ matched: pendingRows }),
      });
      const json = await res.json();
      if (!res.ok) {
        throw new Error(json.error ?? `HTTP ${res.status}`);
      }
      const saved = json.profile as PlayerProfile;
      // Merge so unsaved ratings for other heroes survive the import.
      setDraft((d) => {
        if (!d) return d;
        const heroComfort = { ...d.heroComfort };
        for (const row of pendingRows) {
          const entry = saved.heroComfort[row.heroId];
          if (entry) heroComfort[row.heroId] = entry;
        }
        return { ...d, heroComfort };
      });
      setPendingRows([]);
      setUnmatchedNotice(null);
    } catch (e) {
      setImportError(e instanceof Error ? e.message : String(e));
    } finally {
      setApplying(false);
    }
  };

  const discardImport = () => {
    setPendingRows([]);
    setUnmatchedNotice(null);
    setImportError(null);
  };

  return (
    <div
      className="fixed inset-0 z-50 bg-black/70 backdrop-blur-sm flex items-center justify-center p-4"
      onClick={onClose}
    >
      <div
        ref={panelRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby="profile-modal-title"
        tabIndex={-1}
        className="panel w-full max-w-4xl max-h-[90vh] flex flex-col focus:outline-none"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="panel-header">
          <h2
            id="profile-modal-title"
            className="text-sm font-semibold uppercase tracking-wide text-slate-300"
          >
            Player Profile
          </h2>
          <button onClick={onClose} className="btn-ghost">
            Close
          </button>
        </div>

        <div className="p-4 overflow-y-auto space-y-6">
          {/* --- Basic info --- */}
          <section className="grid grid-cols-2 md:grid-cols-4 gap-3">
            <Field label="Name">
              <input
                type="text"
                value={draft.name}
                onChange={(e) =>
                  editDraft((d) => ({ ...d, name: e.target.value }))
                }
                className="input"
              />
            </Field>
            <Field label="Friend ID">
              <input
                type="text"
                value={draft.friendId ?? ""}
                onChange={(e) =>
                  editDraft((d) => ({ ...d, friendId: e.target.value }))
                }
                className="input"
              />
            </Field>
            <Field label="MMR">
              <input
                type="number"
                value={draft.mmr ?? ""}
                onChange={(e) =>
                  editDraft((d) => ({
                    ...d,
                    mmr: e.target.value ? Number(e.target.value) : undefined,
                  }))
                }
                className="input"
              />
            </Field>
            <Field label="Rank">
              <select
                value={draft.rankBracket}
                onChange={(e) =>
                  editDraft((d) => ({
                    ...d,
                    rankBracket: e.target.value as PlayerProfile["rankBracket"],
                  }))
                }
                className="input"
              >
                {RANKS.map((r) => (
                  <option key={r} value={r}>
                    {r}
                  </option>
                ))}
              </select>
            </Field>
          </section>

          <section>
            <div className="text-xs uppercase tracking-wider text-muted mb-2">
              Preferred roles
            </div>
            <div className="flex gap-2">
              {[1, 2, 3, 4, 5].map((r) => {
                const on = draft.preferredRoles.includes(r);
                return (
                  <button
                    key={r}
                    onClick={() =>
                      editDraft((d) => ({
                        ...d,
                        preferredRoles: d.preferredRoles.includes(r)
                          ? d.preferredRoles.filter((x) => x !== r)
                          : [...d.preferredRoles, r].sort(),
                      }))
                    }
                    className={`px-3 py-1.5 rounded-md text-sm border ${
                      on
                        ? "bg-accent/30 text-accent border-accent/50"
                        : "bg-bg-elevated text-muted border-white/5 hover:text-slate-200"
                    }`}
                  >
                    Pos {r}
                  </button>
                );
              })}
            </div>
          </section>

          {/* --- Screenshot import --- */}
          <section>
            <div className="text-xs uppercase tracking-wider text-muted mb-2">
              Import from in-game screenshot
            </div>
            <p className="text-xs text-muted mb-3 max-w-xl">
              Drag a screenshot of your <b>Hero Stats</b> or <b>Battle Stats</b>{" "}
              page. Claude identifies each row, then you review and confirm
              before anything is saved.
            </p>
            {health && <ModeBadge health={health} />}
            <DropZone onFile={handleFile} disabled={importing || applying} />
            {importing && (
              <div className="text-xs text-accent mt-2">
                Reading screenshot…
              </div>
            )}
            {importError && (
              <div className="text-xs text-enemy mt-2 max-w-xl">
                {importError}
              </div>
            )}
            {unmatchedNotice && (
              <div className="text-xs text-enemy/80 mt-2 max-w-xl">
                {unmatchedNotice}
              </div>
            )}
            {pendingRows.length > 0 && (
              <ImportEditor
                rows={pendingRows}
                heroes={heroes}
                onUpdate={updateRow}
                onRemove={removeRow}
                onApply={applyImport}
                onDiscard={discardImport}
                applying={applying}
              />
            )}
          </section>

          {/* --- Hero comfort grid --- */}
          <section>
            <div className="flex items-center justify-between mb-2">
              <div className="text-xs uppercase tracking-wider text-muted">
                Hero comfort ({Object.keys(draft.heroComfort).length}/{heroes.length})
              </div>
              <div className="flex items-center gap-3">
                <div className="text-[11px] text-muted">
                  Click stars to rate · click same star to clear
                </div>
                {Object.keys(draft.heroComfort).length > 0 && (
                  <button
                    onClick={() => {
                      if (
                        confirm(
                          "Clear ALL hero comfort ratings? This cannot be undone."
                        )
                      ) {
                        editDraft((d) => ({ ...d, heroComfort: {} }));
                      }
                    }}
                    className="text-[11px] text-enemy/80 hover:text-enemy underline"
                  >
                    Clear all
                  </button>
                )}
              </div>
            </div>
            <ComfortGrid
              heroes={heroes}
              draft={draft}
              setComfort={setComfort}
            />
          </section>
        </div>

        <div className="px-4 py-3 border-t border-white/5 flex items-center justify-end gap-2">
          <button onClick={onClose} className="btn-ghost">
            Cancel
          </button>
          <button onClick={handleSave} className="btn-primary">
            Save profile
          </button>
        </div>

        <style>{`
          .input {
            background: #1a1f2a;
            border: 1px solid rgba(255,255,255,0.08);
            border-radius: 6px;
            padding: 6px 10px;
            font-size: 13px;
            color: #f1f5f9;
            width: 100%;
          }
          .input:focus {
            outline: none;
            border-color: rgba(232,163,61,0.5);
          }
          .kbd {
            display: inline-block;
            padding: 0 4px;
            border-radius: 3px;
            background: #1a1f2a;
            border: 1px solid rgba(255,255,255,0.08);
            font-family: ui-monospace, monospace;
            font-size: 10px;
          }
        `}</style>
      </div>
    </div>
  );
}

function ModeBadge({ health }: { health: HealthStatus }) {
  if (health.extractionMode === "api") {
    return (
      <div className="mb-3 text-[11px] text-ally bg-ally/10 border border-ally/30 rounded-md px-2.5 py-1.5 inline-block">
        ● Using <b>Anthropic API</b> · ~$0.005 per import · ~2s per call
      </div>
    );
  }
  return (
    <div className="mb-3 text-[11px] text-accent bg-accent/10 border border-accent/30 rounded-md px-2.5 py-1.5 inline-block max-w-xl">
      ● Using <b>Claude Code CLI</b> · free under your Pro/Max subscription ·
      ~10s per call
      {health.cliBinary && health.cliBinary !== "claude" && (
        <div className="text-muted text-[10px] mt-0.5 break-all">
          {health.cliBinary}
        </div>
      )}
    </div>
  );
}

function Field({
  label,
  children,
}: {
  label: string;
  children: React.ReactNode;
}) {
  return (
    <label className="block">
      <div className="text-[10px] uppercase tracking-wider text-muted mb-1">
        {label}
      </div>
      {children}
    </label>
  );
}

function DropZone({
  onFile,
  disabled,
}: {
  onFile: (file: File) => void;
  disabled: boolean;
}) {
  const [over, setOver] = useState(false);
  return (
    <label
      onDragOver={(e) => {
        e.preventDefault();
        setOver(true);
      }}
      onDragLeave={() => setOver(false)}
      onDrop={(e) => {
        e.preventDefault();
        setOver(false);
        const f = e.dataTransfer.files[0];
        if (f && f.type.startsWith("image/")) onFile(f);
      }}
      className={`block border-2 border-dashed rounded-lg p-6 text-center cursor-pointer transition-colors ${
        over
          ? "border-accent bg-accent/10"
          : "border-white/10 hover:border-white/30"
      } ${disabled ? "opacity-50 pointer-events-none" : ""}`}
    >
      <input
        type="file"
        accept="image/png,image/jpeg,image/webp"
        className="hidden"
        onChange={(e) => {
          const f = e.target.files?.[0];
          if (f) onFile(f);
        }}
      />
      <div className="text-sm text-slate-300">
        Drop a screenshot here or click to browse
      </div>
      <div className="text-[11px] text-muted mt-1">PNG, JPEG, or WebP</div>
    </label>
  );
}

function ImportEditor({
  rows,
  heroes,
  onUpdate,
  onRemove,
  onApply,
  onDiscard,
  applying,
}: {
  rows: EditableRow[];
  heroes: Hero[];
  onUpdate: (index: number, patch: Partial<EditableRow>) => void;
  onRemove: (index: number) => void;
  onApply: () => void;
  onDiscard: () => void;
  applying: boolean;
}) {
  const heroById = new Map(heroes.map((h) => [h.id, h]));
  const sortedHeroes = [...heroes].sort((a, b) =>
    a.localizedName.localeCompare(b.localizedName)
  );
  return (
    <div className="mt-3 bg-bg-elevated rounded-md p-3">
      <div className="text-xs text-slate-300 mb-2 flex items-center justify-between">
        <span>
          {rows.length} hero{rows.length === 1 ? "" : "es"} ready · review then
          save
        </span>
        <span className="text-[10px] text-muted">
          drop another screenshot to add more
        </span>
      </div>
      <div className="max-h-72 overflow-y-auto pr-1 space-y-1">
        {rows.map((row, i) => {
          const hero = heroById.get(row.heroId);
          return (
            <div
              key={`${row.heroId}-${i}`}
              className="flex items-center gap-2 bg-bg-panel rounded px-2 py-1.5"
            >
              {hero && <HeroPortrait hero={hero} size="sm" />}
              <select
                value={row.heroId}
                onChange={(e) => {
                  const newId = Number(e.target.value);
                  const newHero = heroById.get(newId);
                  onUpdate(i, {
                    heroId: newId,
                    heroName: newHero?.localizedName ?? row.heroName,
                  });
                }}
                className="bg-bg-elevated border border-white/5 rounded px-1.5 py-0.5 text-xs text-slate-100 max-w-[160px] focus:outline-none focus:border-accent/50"
              >
                {sortedHeroes.map((h) => (
                  <option key={h.id} value={h.id}>
                    {h.localizedName}
                  </option>
                ))}
              </select>
              <input
                type="number"
                value={row.gamesPlayed}
                onChange={(e) =>
                  onUpdate(i, { gamesPlayed: Number(e.target.value) })
                }
                className="bg-bg-elevated border border-white/5 rounded px-1.5 py-0.5 text-xs text-slate-100 w-16 text-right focus:outline-none focus:border-accent/50"
                title="Games played"
              />
              <span className="text-[10px] text-muted">g</span>
              <input
                type="number"
                step="0.1"
                value={
                  row.winRate !== undefined
                    ? Number((row.winRate * 100).toFixed(1))
                    : ""
                }
                onChange={(e) => {
                  const v = e.target.value;
                  onUpdate(i, {
                    winRate: v === "" ? undefined : Number(v) / 100,
                  });
                }}
                className="bg-bg-elevated border border-white/5 rounded px-1.5 py-0.5 text-xs text-slate-100 w-14 text-right focus:outline-none focus:border-accent/50"
                title="Win rate %"
              />
              <span className="text-[10px] text-muted">%</span>
              <div
                role="group"
                aria-label={`${row.heroName} comfort, ${row.suggestedComfort} of 5`}
                className="flex items-center"
              >
                {[1, 2, 3, 4, 5].map((star) => (
                  <button
                    key={star}
                    onClick={() =>
                      onUpdate(i, {
                        suggestedComfort: star as 1 | 2 | 3 | 4 | 5,
                      })
                    }
                    aria-pressed={star <= row.suggestedComfort}
                    aria-label={`Set ${row.heroName} comfort to ${star} of 5`}
                    className={`w-4 text-sm leading-none ${
                      star <= row.suggestedComfort
                        ? "text-accent"
                        : "text-muted/40 hover:text-muted"
                    }`}
                  >
                    ★
                  </button>
                ))}
              </div>
              <button
                onClick={() => onRemove(i)}
                className="ml-auto text-muted hover:text-enemy text-sm leading-none px-1"
                title="Remove this row"
              >
                ×
              </button>
            </div>
          );
        })}
      </div>
      <div className="flex items-center justify-end gap-2 mt-3">
        <button
          onClick={onDiscard}
          disabled={applying}
          className="btn-ghost text-xs"
        >
          Discard
        </button>
        <button
          onClick={onApply}
          disabled={applying || rows.length === 0}
          className="btn-primary text-xs"
        >
          {applying ? "Saving…" : `Save ${rows.length} hero${rows.length === 1 ? "" : "es"} to profile`}
        </button>
      </div>
    </div>
  );
}

function ComfortGrid({
  heroes,
  draft,
  setComfort,
}: {
  heroes: Hero[];
  draft: PlayerProfile;
  setComfort: (id: number, level: 1 | 2 | 3 | 4 | 5 | 0) => void;
}) {
  const sorted = [...heroes].sort((a, b) =>
    a.localizedName.localeCompare(b.localizedName)
  );
  return (
    <div className="grid grid-cols-1 md:grid-cols-2 gap-1 max-h-96 overflow-y-auto pr-2">
      {sorted.map((hero) => {
        const c = draft.heroComfort[hero.id]?.comfortLevel ?? 0;
        return (
          <div
            key={hero.id}
            className="flex items-center gap-2 bg-bg-elevated/50 hover:bg-bg-elevated rounded px-2 py-1"
          >
            <HeroPortrait hero={hero} size="sm" />
            <div className="flex-1 text-xs truncate">{hero.localizedName}</div>
            <div
              role="group"
              aria-label={`${hero.localizedName} comfort, ${c} of 5`}
              className="flex"
            >
              {[1, 2, 3, 4, 5].map((star) => (
                <button
                  key={star}
                  onClick={() =>
                    setComfort(
                      hero.id,
                      (c === star ? 0 : star) as 0 | 1 | 2 | 3 | 4 | 5
                    )
                  }
                  aria-pressed={star <= c}
                  aria-label={
                    c === star
                      ? `Clear ${hero.localizedName} comfort`
                      : `Set ${hero.localizedName} comfort to ${star} of 5`
                  }
                  className={`w-4 text-sm leading-none ${
                    star <= c ? "text-accent" : "text-muted/40 hover:text-muted"
                  }`}
                >
                  ★
                </button>
              ))}
            </div>
          </div>
        );
      })}
    </div>
  );
}

function toBase64(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => {
      const result = reader.result as string;
      // strip "data:image/png;base64," prefix
      const comma = result.indexOf(",");
      resolve(comma >= 0 ? result.slice(comma + 1) : result);
    };
    reader.onerror = () => reject(reader.error);
    reader.readAsDataURL(file);
  });
}
