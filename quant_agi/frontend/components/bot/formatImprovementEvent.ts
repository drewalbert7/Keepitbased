import type { PaperBotEvent } from "../../lib/paperBotApi";
import { moneyPrecise } from "./format";

export type ImprovementTone = "trade" | "policy" | "safety" | "research" | "shadow" | "account" | "neutral";

export type FormattedImprovementEvent = {
  id: number;
  eventType: string;
  createdAt: string;
  title: string;
  detail: string | null;
  tone: ImprovementTone;
  payload: Record<string, unknown>;
};

const TONE_CLASS: Record<ImprovementTone, string> = {
  trade: "bg-mint/15 text-mint",
  policy: "bg-cyan-400/15 text-cyan-200",
  safety: "bg-warn/15 text-warn",
  research: "bg-violet-400/15 text-violet-200",
  shadow: "bg-amber-500/15 text-amber-100",
  account: "bg-white/10 text-white/65",
  neutral: "bg-white/10 text-white/60"
};

export function improvementToneClass(tone: ImprovementTone): string {
  return TONE_CLASS[tone];
}

function shortSha(v: unknown): string | null {
  if (typeof v !== "string" || !v) return null;
  return v.length > 10 ? `${v.slice(0, 7)}…` : v;
}

export function formatImprovementEvent(ev: PaperBotEvent): FormattedImprovementEvent {
  const p = ev.payload || {};
  const base = {
    id: ev.id,
    eventType: ev.eventType,
    createdAt: ev.createdAt,
    payload: p
  };

  switch (ev.eventType) {
    case "fill": {
      const side = String(p.side || "buy").toUpperCase();
      const symbol = String(p.symbol || "—");
      const notional = Number(p.notionalUsd) || 0;
      const rj = p.reasonJson as Record<string, unknown> | undefined;
      const exitReason = rj?.exit_reason ?? p.exit_reason;
      return {
        ...base,
        tone: side === "SELL" ? "safety" : "trade",
        title: exitReason
          ? `Paper exit · ${symbol} (${String(exitReason)})`
          : `Paper fill · ${side} ${symbol}`,
        detail: notional > 0 ? moneyPrecise(notional) : null
      };
    }
    case "bot_started":
      return {
        ...base,
        tone: "trade",
        title: "Bot turned ON",
        detail: p.marketOpen ? "Auto-trading during market hours" : "Waiting for market open"
      };
    case "bot_stopped":
      return {
        ...base,
        tone: "safety",
        title: "Bot turned OFF",
        detail: "Auto-trading stopped"
      };
    case "brain_reflection":
      return {
        ...base,
        tone: "research",
        title: "Brain reflection",
        detail: p.summary
          ? String(p.summary).slice(0, 160)
          : p.proposalCount
            ? `${Number(p.proposalCount)} policy proposal(s) — review rules inbox`
            : "No policy changes suggested"
      };
    case "bot_learning": {
      const sourceCount = Array.isArray(p.sources) ? p.sources.length : 0;
      const autoN = Array.isArray(p.autoApprovedRuleIds) ? p.autoApprovedRuleIds.length : 0;
      const isAuto = p.source === "auto";
      return {
        ...base,
        tone: "research",
        title: isAuto ? "Auto-learning cycle" : "Bot learning cycle",
        detail: p.summary
          ? `${String(p.summary).slice(0, 90)}${sourceCount ? ` · ${sourceCount} source(s)` : ""}${autoN ? ` · ${autoN} rule(s) auto-applied` : ""}`
          : sourceCount
            ? `${sourceCount} external source(s) reviewed`
            : "External research complete"
      };
    }
    case "agent_plan_tick": {
      const intents = Array.isArray(p.tradeIntents) ? p.tradeIntents : [];
      const buys = intents.filter((i) => String((i as Record<string, unknown>).action) === "buy").length;
      const sells = intents.filter((i) => String((i as Record<string, unknown>).action) === "sell").length;
      const regime = p.regimeLabel ? String(p.regimeLabel) : null;
      const grok = p.grokUsed ? "Grok" : "rules";
      return {
        ...base,
        tone: "research",
        title: "Multi-agent plan tick",
        detail:
          intents.length > 0
            ? `${regime ? `${regime} · ` : ""}${buys} buy / ${sells} sell intent(s) (${grok})`
            : p.rationale
              ? String(p.rationale).slice(0, 140)
              : `No trade intents (${grok})`
      };
    }
    case "auto_run_tick":
      return {
        ...base,
        tone: "trade",
        title: "Auto-run policy check",
        detail: p.skipped
          ? `Skipped${p.reason ? ` — ${String(p.reason)}` : ""}`
          : `${Number(p.fillCount) || 0} fill(s) this tick`
      };
    case "run_day_completed":
      return {
        ...base,
        tone: "trade",
        title: "Simulate day completed",
        detail: `${Number(p.fillCount) || 0} fill(s) applied to paper ledger`
      };
    case "run_day_skipped":
      return {
        ...base,
        tone: "safety",
        title: "Simulate day skipped",
        detail: p.reason ? String(p.reason) : "No fills this run"
      };
    case "shadow_run":
      return {
        ...base,
        tone: "shadow",
        title: "Shadow preview run",
        detail: p.skipped
          ? `Skipped${p.reason ? ` — ${String(p.reason)}` : ""}`
          : `${Number(p.orderCount) || 0} hypothetical order(s), not sent`
      };
    case "kill_switch":
      return {
        ...base,
        tone: "safety",
        title: p.armed ? "Kill switch armed" : "Kill switch disarmed",
        detail: p.armed ? "Paper trades paused until you disarm" : "Paper trades enabled"
      };
    case "settings_updated":
      return {
        ...base,
        tone: "policy",
        title: "Bot settings updated",
        detail:
          p.universeMode === "quant_auto_agent"
            ? "Universe: quant auto-pick (multi-agent LangGraph)"
            : p.universeMode === "quant_auto"
              ? "Universe: quant auto-pick (rank strategies)"
              : p.universeMode === "deploy_list_only" || p.tradeDeployListOnly
              ? "Universe limited to deploy list only"
              : "Universe: watchlist + deploy list"
      };
    case "rule_applied":
      return {
        ...base,
        tone: "policy",
        title: "Grok rule approved",
        detail: p.ruleId != null ? `Rule #${String(p.ruleId)} active — policy version bumped` : null
      };
    case "rule_revoked":
      return {
        ...base,
        tone: "policy",
        title: "Active rule removed",
        detail:
          p.ruleText != null
            ? String(p.ruleText).slice(0, 120)
            : p.ruleId != null
              ? `Rule #${String(p.ruleId)} — policy version bumped`
              : "Policy version bumped"
      };
    case "rule_dismissed":
      return {
        ...base,
        tone: "policy",
        title: p.bulk ? "Pending rules cleared" : "Pending rule removed",
        detail: p.bulk
          ? `${Number(p.removedCount) || 0} rule(s) removed`
          : p.ruleId != null
            ? `Rule #${String(p.ruleId)} removed from inbox`
            : null
      };
    case "user_note":
      return {
        ...base,
        tone: "policy",
        title: "Trading note sent to Grok Bot",
        detail: p.note ? String(p.note).slice(0, 120) : null
      };
    case "autoresearch_promoted": {
      const sha = shortSha(p.promotedSha || p.sourceSha);
      return {
        ...base,
        tone: "research",
        title: "Autoresearch patch promoted",
        detail: sha ? `Staging commit ${sha}` : "Moved to promoted/staging branch"
      };
    }
    case "account_reset":
      return {
        ...base,
        tone: "account",
        title: "Paper account reset",
        detail: "Ledger cleared — fresh $10k paper run"
      };
    case "account_created":
      return {
        ...base,
        tone: "account",
        title: "Paper account created",
        detail: "Starting cash $10,000"
      };
    default:
      return {
        ...base,
        tone: "neutral",
        title: ev.eventType.replace(/_/g, " "),
        detail: p.reason ? String(p.reason) : null
      };
  }
}
