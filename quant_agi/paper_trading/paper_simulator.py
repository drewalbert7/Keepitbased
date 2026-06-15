"""MVP paper fill simulator — policy + quant rotation execution."""

from __future__ import annotations

from dataclasses import dataclass, field
from typing import Any, Optional

from paper_trading.market_session import is_entry_window, is_exit_window, parse_run_at_iso
from paper_trading.quant_execution import (
    QUANT_EXIT_MIN_SCORE,
    QUANT_HOLD_TOP_N,
    compute_buy_notional,
    evaluate_exit_reason,
)


@dataclass
class ProposedFill:
    symbol: str
    side: str
    quantity: float
    price_usd: float
    notional_usd: float
    reason_tags: list[str]
    reason_json: dict[str, Any] = field(default_factory=dict)

    def as_dict(self) -> dict[str, Any]:
        return {
            "symbol": self.symbol,
            "side": self.side,
            "quantity": round(self.quantity, 6),
            "price_usd": round(self.price_usd, 4),
            "notional_usd": round(self.notional_usd, 2),
            "reason_tags": self.reason_tags,
            "reason_json": self.reason_json,
        }


def _held_symbols(positions: list[dict[str, Any]]) -> set[str]:
    return {str(p.get("symbol", "")).upper() for p in positions if p.get("symbol")}


def _resolve_policy(policy: dict[str, Any] | None) -> dict[str, float | int]:
    from paper_trading.bot_policy_engine import DEFAULT_POLICY, merge_active_rules

    merged = merge_active_rules(None)
    if policy:
        merged.update({k: policy[k] for k in DEFAULT_POLICY if k in policy})
    return merged


def _position_map(positions: list[dict[str, Any]]) -> dict[str, dict[str, Any]]:
    out: dict[str, dict[str, Any]] = {}
    for p in positions:
        sym = str(p.get("symbol", "")).upper().strip()
        if sym:
            out[sym] = p
    return out


def _reorder_symbols(ordered: list[str], prioritized: list[str] | None) -> list[str]:
    """Agent plan may reprioritize symbols; unknown symbols keep original order."""
    if not prioritized:
        return ordered
    prio_set = {str(s).upper() for s in prioritized}
    front = [s for s in prioritized if s in ordered]
    tail = [s for s in ordered if s not in prio_set]
    return front + tail


def _ordered_positions_for_exits(
    pos_by_sym: dict[str, dict[str, Any]],
    prioritized_exit_symbols: list[str] | None,
) -> list[tuple[str, dict[str, Any]]]:
    if not prioritized_exit_symbols:
        return list(pos_by_sym.items())
    seen: set[str] = set()
    out: list[tuple[str, dict[str, Any]]] = []
    for sym in prioritized_exit_symbols:
        key = str(sym).upper()
        if key in pos_by_sym and key not in seen:
            seen.add(key)
            out.append((key, pos_by_sym[key]))
    for sym, pos in pos_by_sym.items():
        if sym not in seen:
            out.append((sym, pos))
    return out


def evaluate_run_day(
    *,
    cash_usd: float,
    positions: list[dict[str, Any]],
    universe_symbols: list[str],
    prices: dict[str, float],
    policy: dict[str, Any] | None = None,
    policy_version: int = 1,
    universe_source: str = "deploy_list",
    fill_price_source: str = "massive_snapshot",
    quant_rank_by_symbol: dict[str, Any] | None = None,
    quant_mode: bool = False,
    run_at_iso: Optional[str] = None,
    agent_plan: dict[str, Any] | None = None,
    max_sells_per_run: int = 2,
    max_buys_per_run: int = 1,
) -> tuple[list[dict[str, Any]], list[dict[str, Any]], str | None]:
    """
    Returns (fills, intents, block_reason).
    Quant mode: rank rotation exits first, timed entries, equity-based score-weighted sizing.
    """
    p = _resolve_policy(policy)
    max_position_pct = float(p["max_position_pct"])
    max_notional_per_trade = float(p["max_notional_per_trade"])
    min_cash_reserve = float(p["min_cash_reserve"])
    max_open_positions = int(p["max_open_positions"])

    run_at = parse_run_at_iso(run_at_iso)
    ordered_universe = [str(s).upper().strip() for s in universe_symbols if str(s).strip()]
    agent_prioritized_entries: list[str] | None = None
    agent_prioritized_exits: list[str] | None = None
    if agent_plan and isinstance(agent_plan, dict):
        agent_prioritized_entries = agent_plan.get("prioritized_entry_symbols")
        agent_prioritized_exits = agent_plan.get("prioritized_exit_symbols")
        ordered_universe = _reorder_symbols(ordered_universe, agent_prioritized_entries)
    rank_map = quant_rank_by_symbol or {}
    pos_by_sym = _position_map(positions)

    available_cash = float(cash_usd)
    invested = sum(
        float(pos.get("quantity") or 0)
        * float(prices.get(str(pos.get("symbol", "")).upper()) or pos.get("avg_cost_usd") or 0)
        for pos in positions
    )
    equity = available_cash + invested

    intents: list[dict[str, Any]] = []
    fills: list[ProposedFill] = []
    held = _held_symbols(positions)
    open_count = len(held)

    if quant_mode and not is_exit_window(run_at) and not is_entry_window(run_at):
        return (
            [],
            [
                {
                    "action": "blocked",
                    "reason": "outside_session",
                    "detail": "Outside US entry/exit windows for quant auto-pick.",
                }
            ],
            "Outside quant trading windows.",
        )

    # --- Exits (quant rotation + stop-loss) ---
    sells_done = 0
    if quant_mode and is_exit_window(run_at):
        exit_iter = _ordered_positions_for_exits(pos_by_sym, agent_prioritized_exits)
        for sym, pos in exit_iter:
            if sells_done >= max_sells_per_run:
                break
            price = float(prices.get(sym) or 0)
            if price <= 0:
                continue
            avg_cost = float(pos.get("avg_cost_usd") or pos.get("avg_cost") or 0)
            exit_reason = evaluate_exit_reason(
                symbol=sym,
                avg_cost_usd=avg_cost,
                price_usd=price,
                quant_rank_by_symbol=rank_map,
                ordered_universe=ordered_universe,
            )
            if not exit_reason:
                continue

            qty = float(pos.get("quantity") or 0)
            if qty <= 0:
                continue

            meta = rank_map.get(sym) if isinstance(rank_map.get(sym), dict) else {}
            score = float(meta.get("score", 0)) if meta else 0.0
            strategy = str(meta.get("strategy", "")) if meta else ""

            reason_json = {
                "policy_version": policy_version,
                "universe_source": universe_source,
                "fill_price_source": fill_price_source,
                "exit_reason": exit_reason,
                "rank_score": score,
                "rank_strategy": strategy,
                "quant_hold_top_n": QUANT_HOLD_TOP_N,
                "quant_exit_min_score": QUANT_EXIT_MIN_SCORE,
            }
            if agent_plan:
                reason_json["agent_plan"] = True
                if agent_prioritized_exits and sym in [str(s).upper() for s in agent_prioritized_exits]:
                    reason_json["agent_prioritized_exit"] = True
            notional = qty * price
            intents.append(
                {
                    "symbol": sym,
                    "action": "sell",
                    "side": "sell",
                    "quantity": round(qty, 6),
                    "price_usd": round(price, 4),
                    "notional_usd": round(notional, 2),
                    "detail": f"Exit: {exit_reason}",
                    "reason_tags": ["quant_exit", exit_reason],
                }
            )
            fills.append(
                ProposedFill(
                    symbol=sym,
                    side="sell",
                    quantity=qty,
                    price_usd=price,
                    notional_usd=notional,
                    reason_tags=["run_day", "quant_exit", exit_reason],
                    reason_json=reason_json,
                )
            )
            available_cash += notional
            held.discard(sym)
            open_count = max(0, open_count - 1)
            sells_done += 1

    # --- Entries ---
    if available_cash <= min_cash_reserve:
        if fills:
            return [f.as_dict() for f in fills], intents, None
        return (
            [],
            intents
            + [
                {
                    "action": "blocked",
                    "reason": "cash_reserve",
                    "detail": f"Cash ${available_cash:.2f} at or below reserve ${min_cash_reserve:.2f}.",
                }
            ],
            "Cash at or below minimum reserve.",
        )

    if quant_mode and not is_entry_window(run_at):
        if fills:
            return [f.as_dict() for f in fills], intents, None
        return (
            [],
            intents
            + [
                {
                    "action": "blocked",
                    "reason": "entry_window",
                    "detail": "Quant entries only 10:00–15:30 ET (momentum entry window).",
                }
            ],
            "Outside quant entry window.",
        )

    buys_done = 0
    for symbol in ordered_universe:
        if buys_done >= max_buys_per_run:
            break
        if open_count >= max_open_positions:
            intents.append(
                {
                    "symbol": symbol,
                    "action": "blocked",
                    "reason": "max_open_positions",
                    "detail": f"Already holding {open_count} positions (max {max_open_positions}).",
                }
            )
            break

        if symbol in held:
            intents.append(
                {
                    "symbol": symbol,
                    "action": "skip",
                    "reason": "already_held",
                    "detail": "Symbol already in portfolio.",
                }
            )
            continue

        price = float(prices.get(symbol) or 0)
        if price <= 0:
            intents.append(
                {
                    "symbol": symbol,
                    "action": "skip",
                    "reason": "no_price",
                    "detail": "No snapshot price available.",
                }
            )
            continue

        meta = rank_map.get(symbol) if isinstance(rank_map.get(symbol), dict) else {}
        rank_score = float(meta.get("score", 0)) if meta and quant_mode else None
        rank_strategy = str(meta.get("strategy", "")) if meta else ""

        notional = compute_buy_notional(
            equity_usd=equity,
            available_cash=available_cash,
            min_cash_reserve=min_cash_reserve,
            max_position_pct=max_position_pct,
            max_notional_per_trade=max_notional_per_trade,
            max_open_positions=max_open_positions,
            open_count=open_count,
            rank_score=rank_score,
        )

        if notional < price:
            intents.append(
                {
                    "symbol": symbol,
                    "action": "skip",
                    "reason": "notional_too_small",
                    "detail": f"Cap ${notional:.2f} below one share at ${price:.2f}.",
                }
            )
            continue

        qty = round(notional / price, 6)
        if qty <= 0:
            intents.append(
                {
                    "symbol": symbol,
                    "action": "skip",
                    "reason": "zero_quantity",
                    "detail": "Computed quantity is zero.",
                }
            )
            continue

        actual_notional = qty * price
        target_weight_pct = round((actual_notional / equity) * 100, 2) if equity > 0 else 0.0
        reason_json = {
            "policy_version": policy_version,
            "universe_source": universe_source,
            "fill_price_source": fill_price_source,
            "applied_policy": {
                "max_position_pct": max_position_pct,
                "max_notional_per_trade": max_notional_per_trade,
                "min_cash_reserve": min_cash_reserve,
                "max_open_positions": max_open_positions,
            },
            "target_weight_pct": target_weight_pct,
            "sizing": "equity_slot",
        }
        if quant_mode and rank_score is not None:
            reason_json["rank_score"] = rank_score
            reason_json["rank_strategy"] = rank_strategy
        if agent_plan:
            reason_json["agent_plan"] = True
            if agent_prioritized_entries and symbol in [str(s).upper() for s in agent_prioritized_entries]:
                reason_json["agent_prioritized_entry"] = True

        tag_base = "quant_auto_agent" if agent_plan and quant_mode else ("quant_auto" if quant_mode else "deploy_universe")
        intents.append(
            {
                "symbol": symbol,
                "action": "buy",
                "side": "buy",
                "quantity": round(qty, 6),
                "price_usd": round(price, 4),
                "notional_usd": round(actual_notional, 2),
                "target_weight_pct": target_weight_pct,
                "reason_tags": ["dry_run", tag_base, "approved_policy"],
                "reason_json": reason_json,
            }
        )
        fills.append(
            ProposedFill(
                symbol=symbol,
                side="buy",
                quantity=qty,
                price_usd=price,
                notional_usd=actual_notional,
                reason_tags=["run_day", tag_base, "approved_policy"],
                reason_json=reason_json,
            )
        )
        available_cash -= actual_notional
        held.add(symbol)
        open_count += 1
        buys_done += 1

    block_reason = None
    if not fills and not intents:
        block_reason = "Empty universe — add deploy list or watchlist symbols."
    elif not fills:
        block_reason = "No qualifying orders at current prices, windows, or cash limits."

    return [f.as_dict() for f in fills], intents, block_reason


def propose_run_day_fills(
    *,
    cash_usd: float,
    positions: list[dict[str, Any]],
    universe_symbols: list[str],
    prices: dict[str, float],
    max_position_pct: float = 10.0,
    max_notional_per_trade: float = 750.0,
    min_cash_reserve: float = 500.0,
    max_open_positions: int = 5,
    policy: dict[str, Any] | None = None,
    policy_version: int = 1,
    universe_source: str = "deploy_list",
) -> list[dict[str, Any]]:
    policy_merged = policy or {
        "max_position_pct": max_position_pct,
        "max_notional_per_trade": max_notional_per_trade,
        "min_cash_reserve": min_cash_reserve,
        "max_open_positions": max_open_positions,
    }
    fills, _, _ = evaluate_run_day(
        cash_usd=cash_usd,
        positions=positions,
        universe_symbols=universe_symbols,
        prices=prices,
        policy=policy_merged,
        policy_version=policy_version,
        universe_source=universe_source,
    )
    return fills


def _run_eval(
    *,
    cash_usd: float,
    positions: list[dict[str, Any]],
    universe_symbols: list[str],
    prices: dict[str, float],
    kill_switch_armed: bool,
    policy_version: int = 1,
    active_rules: list[dict[str, Any]] | None = None,
    active_policy: dict[str, Any] | None = None,
    universe_source: str = "deploy_list",
    quant_rank_by_symbol: dict[str, Any] | None = None,
    quant_mode: bool = False,
    run_at_iso: Optional[str] = None,
    agent_mode: bool = False,
    learning_memory: dict[str, Any] | None = None,
    x_research_snippets: list[dict[str, Any]] | None = None,
) -> dict[str, Any]:
    from paper_trading.bot_policy_engine import merge_active_rules

    policy = active_policy or merge_active_rules(active_rules or [])

    agent_plan: dict[str, Any] | None = None
    agent_plan_result: dict[str, Any] | None = None
    if agent_mode and quant_mode:
        from paper_trading.plan_tick import plan_tick_payload

        agent_plan_result = plan_tick_payload(
            cash_usd=cash_usd,
            positions=positions,
            universe_symbols=universe_symbols,
            prices=prices,
            kill_switch_armed=kill_switch_armed,
            policy_version=policy_version,
            active_rules=active_rules,
            active_policy=policy,
            universe_source=universe_source,
            quant_rank_by_symbol=quant_rank_by_symbol,
            run_at_iso=run_at_iso,
            learning_memory=learning_memory,
            x_research_snippets=x_research_snippets,
        )
        if agent_plan_result.get("ok") and isinstance(agent_plan_result.get("plan"), dict):
            agent_plan = agent_plan_result["plan"]

    if kill_switch_armed:
        return {
            "ok": True,
            "skipped": True,
            "reason": "Kill switch armed — no fills proposed.",
            "fills": [],
            "intents": [
                {
                    "action": "blocked",
                    "reason": "kill_switch",
                    "detail": "Kill switch is armed.",
                }
            ],
            "policy_version": policy_version,
            "applied_policy": policy,
            "agent_plan": agent_plan,
            "agent_plan_result": agent_plan_result,
        }

    if not universe_symbols:
        return {
            "ok": True,
            "skipped": True,
            "reason": "Empty universe — add deploy list or watchlist symbols.",
            "fills": [],
            "intents": [],
            "policy_version": policy_version,
            "applied_policy": policy,
            "agent_plan": agent_plan,
            "agent_plan_result": agent_plan_result,
        }

    fills, intents, block_reason = evaluate_run_day(
        cash_usd=cash_usd,
        positions=positions,
        universe_symbols=universe_symbols,
        prices=prices,
        policy=policy,
        policy_version=policy_version,
        universe_source=universe_source,
        quant_rank_by_symbol=quant_rank_by_symbol,
        quant_mode=quant_mode,
        run_at_iso=run_at_iso,
        agent_plan=agent_plan,
    )

    base_response = {
        "policy_version": policy_version,
        "applied_policy": policy,
        "agent_plan": agent_plan,
        "agent_plan_result": agent_plan_result,
        "regime_label": (agent_plan_result or {}).get("regime_label") if agent_plan_result else None,
        "grok_used": bool((agent_plan_result or {}).get("grok_used")) if agent_plan_result else False,
    }

    if not fills:
        return {
            "ok": True,
            "skipped": True,
            "reason": block_reason or "No qualifying orders at current prices or cash limits.",
            "fills": [],
            "intents": intents,
            **base_response,
        }

    return {
        "ok": True,
        "skipped": False,
        "reason": None,
        "fills": fills,
        "intents": intents,
        **base_response,
    }


def dry_run_payload(
    *,
    cash_usd: float,
    positions: list[dict[str, Any]],
    universe_symbols: list[str],
    prices: dict[str, float],
    kill_switch_armed: bool,
    policy_version: int = 1,
    active_rules: list[dict[str, Any]] | None = None,
    active_policy: dict[str, Any] | None = None,
    universe_source: str = "deploy_list",
    quant_rank_by_symbol: dict[str, Any] | None = None,
    quant_mode: bool = False,
    run_at_iso: Optional[str] = None,
    agent_mode: bool = False,
    learning_memory: dict[str, Any] | None = None,
    x_research_snippets: list[dict[str, Any]] | None = None,
) -> dict[str, Any]:
    return _run_eval(
        cash_usd=cash_usd,
        positions=positions,
        universe_symbols=universe_symbols,
        prices=prices,
        kill_switch_armed=kill_switch_armed,
        policy_version=policy_version,
        active_rules=active_rules,
        active_policy=active_policy,
        universe_source=universe_source,
        quant_rank_by_symbol=quant_rank_by_symbol,
        quant_mode=quant_mode,
        run_at_iso=run_at_iso,
        agent_mode=agent_mode,
        learning_memory=learning_memory,
        x_research_snippets=x_research_snippets,
    )


def run_day_payload(
    *,
    cash_usd: float,
    positions: list[dict[str, Any]],
    universe_symbols: list[str],
    prices: dict[str, float],
    kill_switch_armed: bool,
    policy_version: int = 1,
    active_rules: list[dict[str, Any]] | None = None,
    active_policy: dict[str, Any] | None = None,
    universe_source: str = "deploy_list",
    quant_rank_by_symbol: dict[str, Any] | None = None,
    quant_mode: bool = False,
    run_at_iso: Optional[str] = None,
    agent_mode: bool = False,
    learning_memory: dict[str, Any] | None = None,
    x_research_snippets: list[dict[str, Any]] | None = None,
) -> dict[str, Any]:
    return dry_run_payload(
        cash_usd=cash_usd,
        positions=positions,
        universe_symbols=universe_symbols,
        prices=prices,
        kill_switch_armed=kill_switch_armed,
        policy_version=policy_version,
        active_rules=active_rules,
        active_policy=active_policy,
        universe_source=universe_source,
        quant_rank_by_symbol=quant_rank_by_symbol,
        quant_mode=quant_mode,
        run_at_iso=run_at_iso,
        agent_mode=agent_mode,
        learning_memory=learning_memory,
        x_research_snippets=x_research_snippets,
    )
