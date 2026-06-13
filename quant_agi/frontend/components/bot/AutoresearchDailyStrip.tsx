"use client";

import { useCallback, useEffect, useState } from "react";
import {
  addPaperBotTrustedTrader,
  fetchPaperBotLearningLatest,
  removePaperBotTrustedTrader,
  runPaperBotLearningCycle,
  type PaperBotLearningLatest,
  type PaperBotLearningSource,
  type PaperBotTrustedXTrader
} from "../../lib/paperBotApi";

type Props = {
  refreshKey?: number;
  onLearningComplete?: () => void;
};

function fmtUsd(n: number): string {
  const sign = n >= 0 ? "+" : "";
  return `${sign}$${Math.abs(n).toLocaleString(undefined, { maximumFractionDigits: 0 })}`;
}

function timeAgo(iso: string | null | undefined): string {
  if (!iso) return "";
  const ms = Date.now() - new Date(iso).getTime();
  if (!Number.isFinite(ms) || ms < 0) return "";
  const hrs = Math.floor(ms / (60 * 60 * 1000));
  if (hrs < 24) return `${hrs}h ago`;
  return `${Math.floor(hrs / 24)}d ago`;
}

function capabilityLabel(caps: PaperBotLearningLatest["capabilities"]): string {
  const parts = ["arXiv"];
  if (caps.x_search) parts.push("X search");
  if (caps.x_monitor) parts.push("monitored X accounts");
  else if (caps.x) parts.push("X");
  return parts.join(" + ");
}

function SourceRow({ source }: { source: PaperBotLearningSource }) {
  const type = source.source_type || "source";
  const label =
    type === "x" ? "X" : type === "x_monitor" ? "X monitor" : type === "arxiv" ? "arXiv" : type;
  return (
    <li className="rounded-md border border-white/10 bg-black/20 px-2 py-1.5 text-[11px]">
      <div className="flex flex-wrap items-center gap-2">
        <span className="rounded bg-white/10 px-1.5 py-0.5 text-[10px] uppercase text-white/55">{label}</span>
        {source.url ? (
          <a
            href={source.url}
            target="_blank"
            rel="noopener noreferrer"
            className="font-medium text-neon underline-offset-2 hover:underline"
          >
            {source.title || source.url}
          </a>
        ) : (
          <span className="font-medium text-white/80">{source.title}</span>
        )}
      </div>
      {source.snippet ? <p className="mt-1 text-white/50">{source.snippet.slice(0, 180)}…</p> : null}
    </li>
  );
}

export function AutoresearchDailyStrip({ refreshKey = 0, onLearningComplete }: Props) {
  const [data, setData] = useState<PaperBotLearningLatest | null>(null);
  const [loading, setLoading] = useState(true);
  const [running, setRunning] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [handleInput, setHandleInput] = useState("");
  const [traderBusy, setTraderBusy] = useState(false);
  const [traderError, setTraderError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setError(null);
    setLoading(true);
    try {
      setData(await fetchPaperBotLearningLatest());
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not load bot learning lab");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load, refreshKey]);

  const onRunLearning = () => {
    setRunning(true);
    setError(null);
    void runPaperBotLearningCycle()
      .then((next) => {
        setData(next);
        onLearningComplete?.();
      })
      .catch((e) => setError(e instanceof Error ? e.message : "Learning cycle failed"))
      .finally(() => setRunning(false));
  };

  const onAddTrustedTrader = () => {
    const raw = handleInput.trim().replace(/^@/, "");
    if (!raw) return;
    setTraderBusy(true);
    setTraderError(null);
    void addPaperBotTrustedTrader({ username: raw })
      .then(async () => {
        setHandleInput("");
        setData(await fetchPaperBotLearningLatest());
      })
      .catch((e) => setTraderError(e instanceof Error ? e.message : "Could not add trader"))
      .finally(() => setTraderBusy(false));
  };

  const onRemoveTrustedTrader = (trader: PaperBotTrustedXTrader) => {
    setTraderBusy(true);
    setTraderError(null);
    void removePaperBotTrustedTrader(trader.id)
      .then(async () => {
        setData(await fetchPaperBotLearningLatest());
      })
      .catch((e) => setTraderError(e instanceof Error ? e.message : "Could not remove trader"))
      .finally(() => setTraderBusy(false));
  };

  if (loading && !data) {
    return (
      <div className="rounded-xl border border-violet-500/25 bg-violet-500/5 p-3">
        <p className="text-xs text-white/50">Loading bot learning lab…</p>
      </div>
    );
  }

  if (error && !data) {
    return (
      <div className="rounded-xl border border-warn/30 bg-warn/10 p-3">
        <p className="text-xs text-warn">{error}</p>
      </div>
    );
  }

  if (!data) return null;

  const { metrics, capabilities, lastLearning, learningPendingRules, autoLearning, activeLearningMemory, xTrusted, trustedTraders = [], maxTrustedTraders = 12 } = data;
  const payload = lastLearning?.payload;
  const coach = activeLearningMemory?.coaching_directives;
  const trustedSymbols = coach?.trusted_symbols?.length
    ? coach.trusted_symbols
    : xTrusted?.trustedSymbols || xTrusted?.tickerBuzz?.map((r) => r.symbol) || [];
  const pnlPositive = metrics.cumPnlUsd >= 0;
  const autoStatus = autoLearning?.schedulerEnabled
    ? autoLearning.botOn
      ? autoLearning.marketOpen
        ? "Scheduled after market close"
        : `Auto-learning ON · every ${autoLearning.intervalHours}h`
      : "Turn bot ON to enable auto-learning"
    : "Auto-learning disabled on server";

  return (
    <div className="rounded-xl border border-violet-500/25 bg-violet-500/5 p-3">
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div>
          <h3 className="text-sm font-semibold text-violet-100">Bot learning lab</h3>
          <p className="mt-0.5 text-[11px] text-white/50">
            Researches trusted X accounts + arXiv from your paper performance. Cashtags from monitors expand the
            bot universe beyond dashboard lists.
          </p>
          <p className="mt-1 text-[10px] text-emerald-300/90">{autoStatus}</p>
          {autoLearning?.lastAutoLearningAt ? (
            <p className="mt-0.5 text-[10px] text-white/40">
              Last auto run {timeAgo(autoLearning.lastAutoLearningAt)}
            </p>
          ) : null}
          <p className="mt-1 text-[10px] text-white/40">
            Sources: {capabilityLabel(capabilities)}
            {trustedTraders.length
              ? ` · ${trustedTraders.length} trusted handle(s) via x_search`
              : " · add @handles below"}
            {!capabilities.x_search ? " · needs XAI/GROK API key for x_search" : ""}
          </p>
        </div>
        <div className="flex gap-2">
          <button
            type="button"
            onClick={() => void load()}
            disabled={loading || running}
            className="rounded border border-white/15 px-2 py-0.5 text-[10px] text-white/60 hover:border-white/30 hover:text-white/80 disabled:opacity-50"
          >
            Refresh
          </button>
          <button
            type="button"
            onClick={onRunLearning}
            disabled={running}
            className="rounded border border-violet-400/40 bg-violet-500/20 px-2.5 py-0.5 text-[10px] font-medium text-violet-100 hover:bg-violet-500/30 disabled:opacity-50"
          >
            {running ? "Researching…" : "Run now"}
          </button>
        </div>
      </div>

      {error ? <p className="mt-2 text-[11px] text-warn">{error}</p> : null}

      <div className="mt-3 rounded-md border border-sky-500/25 bg-sky-500/5 p-2.5">
        <div className="flex flex-wrap items-start justify-between gap-2">
          <div>
            <p className="text-[10px] uppercase tracking-wide text-sky-200/80">Trusted X traders</p>
            <p className="mt-0.5 text-[11px] text-white/50">
              Add @handles you follow — Grok x_search pulls their posts (no paid X API). Cashtags expand the bot universe.
            </p>
          </div>
          <p className="text-[10px] text-white/40">
            {trustedTraders.length}/{maxTrustedTraders}
          </p>
        </div>

        {capabilities.x_search ? (
          <p className="mt-1 text-[10px] text-sky-200/60">Post access via Grok x_search only — no X developer API.</p>
        ) : (
          <div className="mt-2 rounded border border-amber-500/30 bg-amber-500/10 px-2 py-1.5 text-[11px] text-amber-100/90">
            Set <code className="text-amber-50">XAI_API_KEY</code> or <code className="text-amber-50">GROK_API_KEY</code> on
            the quant-agi server to enable x_search, then restart{" "}
            <code className="text-amber-50">quant-agi-api</code>.
          </div>
        )}

        <div className="mt-2 flex flex-wrap gap-2">
          <input
            type="text"
            value={handleInput}
            onChange={(e) => setHandleInput(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter") onAddTrustedTrader();
            }}
            placeholder="@traderhandle"
            disabled={traderBusy || trustedTraders.length >= maxTrustedTraders || !capabilities.x_search}
            className="min-w-[140px] flex-1 rounded border border-white/15 bg-black/30 px-2 py-1 text-xs text-white placeholder:text-white/35 focus:border-sky-400/50 focus:outline-none disabled:opacity-50"
          />
          <button
            type="button"
            onClick={onAddTrustedTrader}
            disabled={
              traderBusy || !handleInput.trim() || trustedTraders.length >= maxTrustedTraders || !capabilities.x_search
            }
            className="rounded border border-sky-400/40 bg-sky-500/20 px-2.5 py-1 text-[10px] font-medium text-sky-100 hover:bg-sky-500/30 disabled:opacity-50"
          >
            {traderBusy ? "Adding…" : "Add"}
          </button>
        </div>

        {traderError ? <p className="mt-2 text-[11px] text-warn">{traderError}</p> : null}

        {trustedTraders.length ? (
          <ul className="mt-2 flex flex-wrap gap-1.5">
            {trustedTraders.map((trader) => (
              <li
                key={trader.id}
                className="flex items-center gap-1 rounded-full border border-white/15 bg-black/25 pl-2 pr-1 py-0.5 text-[11px]"
              >
                <a
                  href={`https://x.com/${trader.username}`}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="font-medium text-sky-200 hover:underline"
                  title={trader.label}
                >
                  @{trader.username}
                </a>
                <button
                  type="button"
                  onClick={() => onRemoveTrustedTrader(trader)}
                  disabled={traderBusy}
                  className="rounded px-1 text-white/45 hover:bg-white/10 hover:text-rose-300 disabled:opacity-50"
                  aria-label={`Remove @${trader.username}`}
                >
                  ×
                </button>
              </li>
            ))}
          </ul>
        ) : (
          <p className="mt-2 text-[11px] text-white/40">No trusted traders yet — add an @handle to start monitoring.</p>
        )}
      </div>

      <div className="mt-3 grid gap-2 sm:grid-cols-2 lg:grid-cols-4">
        <div className="rounded-md border border-white/10 bg-black/20 px-2 py-1.5">
          <p className="text-[10px] uppercase tracking-wide text-white/45">Paper equity</p>
          <p className="text-sm font-medium text-white">${metrics.equityUsd.toLocaleString()}</p>
        </div>
        <div className="rounded-md border border-white/10 bg-black/20 px-2 py-1.5">
          <p className="text-[10px] uppercase tracking-wide text-white/45">Cum P&amp;L</p>
          <p className={`text-sm font-medium ${pnlPositive ? "text-emerald-300" : "text-rose-300"}`}>
            {fmtUsd(metrics.cumPnlUsd)}
          </p>
        </div>
        <div className="rounded-md border border-white/10 bg-black/20 px-2 py-1.5">
          <p className="text-[10px] uppercase tracking-wide text-white/45">Paper days</p>
          <p className="text-sm font-medium text-white">
            {metrics.paperDays} · {metrics.tradeCount} fills
          </p>
        </div>
        <div className="rounded-md border border-white/10 bg-black/20 px-2 py-1.5">
          <p className="text-[10px] uppercase tracking-wide text-white/45">Pending from lab</p>
          <p className="text-sm font-medium text-white">{learningPendingRules.length} rule(s)</p>
        </div>
      </div>

      {payload?.summary ? (
        <div className="mt-3 rounded-md border border-white/10 bg-black/15 p-2">
          <p className="text-[10px] uppercase tracking-wide text-white/45">
            Latest learning {lastLearning?.createdAt ? `· ${timeAgo(lastLearning.createdAt)}` : ""}
          </p>
          <p className="mt-1 text-xs leading-relaxed text-white/75">{payload.summary}</p>
        </div>
      ) : (
        <p className="mt-3 text-[11px] text-white/45">
          No learning cycle yet — run one to pull arXiv papers and X discourse based on your bot&apos;s
          performance.
        </p>
      )}

      {payload?.lessons?.length ? (
        <ul className="mt-3 space-y-2">
          {payload.lessons.map((lesson, idx) => (
            <li key={`${lesson.title}-${idx}`} className="rounded-md border border-white/10 bg-black/20 p-2">
              <p className="text-xs font-medium text-white/85">{lesson.title}</p>
              {lesson.detail ? <p className="mt-1 text-[11px] text-white/55">{lesson.detail}</p> : null}
            </li>
          ))}
        </ul>
      ) : null}

      {payload?.agentHints?.length ? (
        <div className="mt-3 rounded-md border border-cyan-500/20 bg-cyan-500/5 p-2">
          <p className="text-[10px] uppercase tracking-wide text-cyan-200/70">Hints for multi-agent graph</p>
          <ul className="mt-1 list-disc space-y-1 pl-4 text-[11px] text-white/60">
            {payload.agentHints.map((hint) => (
              <li key={hint}>{hint}</li>
            ))}
          </ul>
        </div>
      ) : null}

      {trustedSymbols.length ? (
        <div className="mt-3 rounded-md border border-amber-500/25 bg-amber-500/5 p-2">
          <p className="text-[10px] uppercase tracking-wide text-amber-200/80">Trusted X universe watch</p>
          <p className="mt-1 flex flex-wrap gap-1.5">
            {trustedSymbols.slice(0, 10).map((sym) => (
              <span key={sym} className="rounded bg-white/10 px-1.5 py-0.5 text-[11px] font-medium text-amber-100">
                ${sym}
              </span>
            ))}
          </p>
          <p className="mt-2 text-[10px] text-white/45">
            Merged into scout candidates even when not on your deploy list — sourced from monitored accounts
            {xTrusted?.tickerBuzz?.length ? " (live cashtags)" : " (last learning cycle)"}.
          </p>
        </div>
      ) : null}

      {activeLearningMemory?.summary ? (
        <div className="mt-3 rounded-md border border-emerald-500/25 bg-emerald-500/5 p-2">
          <p className="text-[10px] uppercase tracking-wide text-emerald-200/80">
            Active coaching memory
            {activeLearningMemory.updated_at ? ` · ${timeAgo(activeLearningMemory.updated_at)}` : ""}
          </p>
          <p className="mt-1 text-xs leading-relaxed text-white/75">{activeLearningMemory.summary}</p>
          {coach ? (
            <div className="mt-2 flex flex-wrap gap-1.5 text-[10px]">
              {coach.regime_bias ? (
                <span className="rounded bg-white/10 px-1.5 py-0.5 text-white/70">regime: {coach.regime_bias}</span>
              ) : null}
              {coach.entry_posture ? (
                <span className="rounded bg-white/10 px-1.5 py-0.5 text-white/70">entries: {coach.entry_posture}</span>
              ) : null}
              {coach.exit_posture ? (
                <span className="rounded bg-white/10 px-1.5 py-0.5 text-white/70">exits: {coach.exit_posture}</span>
              ) : null}
            </div>
          ) : null}
          <p className="mt-2 text-[10px] text-emerald-200/70">
            Injected into every agent plan tick until the next learning cycle.
          </p>
        </div>
      ) : null}

      {payload?.sources?.length ? (
        <div className="mt-3">
          <p className="text-[10px] uppercase tracking-wide text-white/45">Sources consulted</p>
          <ul className="mt-2 space-y-1.5">
            {payload.sources.slice(0, 6).map((source, idx) => (
              <SourceRow key={`${source.url || source.title}-${idx}`} source={source} />
            ))}
          </ul>
        </div>
      ) : null}

      <p className="mt-3 border-t border-white/10 pt-2 text-[10px] leading-relaxed text-white/40">
        {data.disclaimer}
      </p>
    </div>
  );
}
