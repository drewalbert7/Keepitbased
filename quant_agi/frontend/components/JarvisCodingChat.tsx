"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { getQuantAgiBaseUrl } from "../lib/quantBase";
import { quantAuthedFetch } from "../lib/quantAuth";

type Role = "user" | "assistant";

type Turn = { role: Role; content: string };

export function JarvisCodingChat() {
  const [turns, setTurns] = useState<Turn[]>([]);
  const [input, setInput] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const bottomRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [turns, loading]);

  const send = useCallback(async () => {
    const text = input.trim();
    if (!text || loading) return;

    setError(null);
    setInput("");
    const userTurn: Turn = { role: "user", content: text };
    setTurns((t) => [...t, userTurn]);
    setLoading(true);

    const base = getQuantAgiBaseUrl();

    try {
      const history = [...turns, userTurn].map(({ role, content }) => ({ role, content }));
      const res = await quantAuthedFetch(`${base}/v1/coding-chat`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ message: text, history: history.slice(0, -1) }),
        cache: "no-store"
      });
      let data: {
        ok?: boolean;
        reply?: string;
        error?: string | null;
        model?: string;
      } = {};
      try {
        data = (await res.json()) as typeof data;
      } catch {
        /* non-JSON body (e.g. proxy HTML 404) */
      }

      if (!res.ok || !data.ok || !data.reply) {
        const apiErr = typeof data.error === "string" && data.error.trim() ? data.error.trim() : null;
        let errText: string;
        if (apiErr) {
          errText = apiErr;
        } else if (res.status === 404) {
          errText = `Not found (404) at ${base}/v1/coding-chat. Redeploy keepitbased-api (sidecar proxy) and quant-agi-api, or set NEXT_PUBLIC_QUANT_AGI_URL for local sidecar.`;
        } else {
          errText = `Request failed (${res.status}). Ensure quant-agi-api is running and GROK_API_KEY is set when the route exists.`;
        }
        setError(errText);
        setTurns((t) => [...t, { role: "assistant", content: errText }]);
        return;
      }

      const reply: string = data.reply;
      setTurns((t) => [...t, { role: "assistant", content: reply }]);
    } catch (e) {
      const msg = e instanceof Error ? e.message : "Network error";
      setError(msg);
      setTurns((t) => [
        ...t,
        {
          role: "assistant",
          content: `Could not reach the advisor service at ${getQuantAgiBaseUrl()}. Is quant-agi-api running? (${msg})`
        }
      ]);
    } finally {
      setLoading(false);
    }
  }, [input, loading, turns]);

  return (
    <section className="relative overflow-hidden rounded-2xl border border-cyan-500/35 bg-[linear-gradient(145deg,rgba(6,22,36,0.95),rgba(4,8,20,0.92))] shadow-[0_0_40px_rgba(34,211,238,0.08)]">
      <div className="pointer-events-none absolute inset-0 bg-[repeating-linear-gradient(0deg,transparent,transparent_2px,rgba(34,211,238,0.03)_2px,rgba(34,211,238,0.03)_4px)] opacity-60" />
      <div className="relative border-b border-cyan-500/25 px-4 py-3 sm:px-5">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <div>
            <p className="font-mono text-[10px] uppercase tracking-[0.35em] text-cyan-300/90">
              Coding advisor
            </p>
            <h2 className="text-lg font-semibold tracking-wide text-cyan-50">
              J.A.R.V.I.S. <span className="font-normal text-cyan-200/70">· Grok</span>
            </h2>
          </div>
          <div className="flex h-9 w-9 items-center justify-center rounded-full border border-cyan-400/40 bg-cyan-500/10 shadow-[0_0_18px_rgba(34,211,238,0.45)]">
            <span className="h-3 w-3 rounded-full bg-cyan-300 shadow-[0_0_12px_#22d3ee]" />
          </div>
        </div>
        <p className="mt-2 text-xs leading-relaxed text-cyan-100/55">
          Ask for autoresearch improvements, evaluator hooks, swarm parameters, or FastAPI changes — suggestions only; merge via your normal review flow.
        </p>
      </div>

      <div className="relative flex max-h-[min(52vh,420px)] min-h-[200px] flex-col">
        <div className="flex-1 space-y-3 overflow-y-auto px-4 py-3 sm:px-5">
          {turns.length === 0 && !loading && (
            <p className="text-sm italic text-cyan-200/40">
              e.g. “How should we add walk-forward validation to the autoresearch loop?”
            </p>
          )}
          {turns.map((t, i) => (
            <div
              key={`${i}-${t.role}`}
              className={`flex ${t.role === "user" ? "justify-end" : "justify-start"}`}
            >
              <div
                className={`max-w-[95%] rounded-xl border px-3 py-2 text-sm leading-relaxed sm:max-w-[90%] ${
                  t.role === "user"
                    ? "border-cyan-500/25 bg-cyan-950/50 text-cyan-50"
                    : "border-white/10 bg-black/50 text-cyan-100/90"
                }`}
              >
                {t.role === "assistant" && (
                  <span className="mb-1 block font-mono text-[10px] uppercase tracking-wider text-cyan-500/80">
                    System
                  </span>
                )}
                <pre className="whitespace-pre-wrap font-sans">{t.content}</pre>
              </div>
            </div>
          ))}
          {loading && (
            <div className="flex justify-start">
              <div className="rounded-xl border border-cyan-500/20 bg-black/40 px-3 py-2 font-mono text-xs text-cyan-300/80">
                Processing…
              </div>
            </div>
          )}
          <div ref={bottomRef} />
        </div>

        <div className="border-t border-cyan-500/20 bg-black/30 px-3 py-3 sm:px-4">
          {error && <p className="mb-2 text-xs text-orange-300/90">{error}</p>}
          <div className="flex flex-col gap-2 sm:flex-row sm:items-end">
            <textarea
              value={input}
              onChange={(e) => setInput(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter" && !e.shiftKey) {
                  e.preventDefault();
                  void send();
                }
              }}
              placeholder="Describe what you want to improve in autoresearch…"
              rows={2}
              className="min-h-[44px] flex-1 resize-y rounded-lg border border-cyan-500/25 bg-black/50 px-3 py-2 text-sm text-cyan-50 placeholder:text-cyan-600/50 focus:border-cyan-400/50 focus:outline-none focus:ring-1 focus:ring-cyan-400/30"
            />
            <button
              type="button"
              disabled={loading || !input.trim()}
              onClick={() => void send()}
              className="shrink-0 rounded-lg border border-cyan-400/40 bg-cyan-500/15 px-4 py-2 text-sm font-medium text-cyan-100 transition hover:bg-cyan-500/25 disabled:opacity-40"
            >
              Send
            </button>
          </div>
        </div>
      </div>
    </section>
  );
}
