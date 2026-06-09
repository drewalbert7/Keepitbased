"""MVP paper fill simulator — deterministic policy for run-day proposals."""

from __future__ import annotations

from dataclasses import dataclass, field
from typing import Any


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
) -> tuple[list[dict[str, Any]], list[dict[str, Any]], str | None]:
    """
    Returns (fills, intents, block_reason).
    intents describe buy/skip/blocked per symbol for BotBrainPanel dry-run.
    """
    p = _resolve_policy(policy)
    max_position_pct = float(p["max_position_pct"])
    max_notional_per_trade = float(p["max_notional_per_trade"])
    min_cash_reserve = float(p["min_cash_reserve"])
    max_open_positions = int(p["max_open_positions"])

    held = _held_symbols(positions)
    open_count = len(held)
    available_cash = float(cash_usd)
    invested = sum(
        float(pos.get("quantity") or 0)
        * float(prices.get(str(pos.get("symbol", "")).upper()) or pos.get("avg_cost_usd") or 0)
        for pos in positions
    )
    equity = available_cash + invested

    intents: list[dict[str, Any]] = []
    fills: list[ProposedFill] = []

    if available_cash <= min_cash_reserve:
        return (
            [],
            [
                {
                    "action": "blocked",
                    "reason": "cash_reserve",
                    "detail": f"Cash ${available_cash:.2f} at or below reserve ${min_cash_reserve:.2f}.",
                }
            ],
            "Cash at or below minimum reserve.",
        )

    bought = False
    for raw in universe_symbols:
        if bought:
            break
        if open_count >= max_open_positions:
            intents.append(
                {
                    "symbol": str(raw or "").upper().strip() or None,
                    "action": "blocked",
                    "reason": "max_open_positions",
                    "detail": f"Already holding {open_count} positions (max {max_open_positions}).",
                }
            )
            break

        symbol = str(raw or "").upper().strip()
        if not symbol:
            continue
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

        cap_by_pct = available_cash * (max_position_pct / 100.0)
        notional = min(max_notional_per_trade, cap_by_pct, available_cash - min_cash_reserve)
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
        }
        intent = {
            "symbol": symbol,
            "action": "buy",
            "side": "buy",
            "quantity": round(qty, 6),
            "price_usd": round(price, 4),
            "notional_usd": round(actual_notional, 2),
            "target_weight_pct": target_weight_pct,
            "reason_tags": ["dry_run", "deploy_universe", "approved_policy"],
            "reason_json": reason_json,
        }
        intents.append(intent)
        fills.append(
            ProposedFill(
                symbol=symbol,
                side="buy",
                quantity=qty,
                price_usd=price,
                notional_usd=actual_notional,
                reason_tags=["run_day", "deploy_universe", "approved_policy"],
                reason_json=reason_json,
            )
        )
        available_cash -= actual_notional
        held.add(symbol)
        open_count += 1
        bought = True

    block_reason = None
    if not fills and not intents:
        block_reason = "Empty universe — add deploy list or watchlist symbols."
    elif not fills:
        block_reason = "No qualifying buys at current prices or cash limits."

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
    """Phase 1 MVP: one small deploy-list buy per run when flat capacity remains."""
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
) -> dict[str, Any]:
    """Preview intents without persisting fills (BotBrainPanel)."""
    from paper_trading.bot_policy_engine import merge_active_rules

    policy = active_policy or merge_active_rules(active_rules or [])

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
        }

    fills, intents, block_reason = evaluate_run_day(
        cash_usd=cash_usd,
        positions=positions,
        universe_symbols=universe_symbols,
        prices=prices,
        policy=policy,
        policy_version=policy_version,
        universe_source=universe_source,
    )

    if not fills:
        return {
            "ok": True,
            "skipped": True,
            "reason": block_reason or "No qualifying fills at current prices or cash limits.",
            "fills": [],
            "intents": intents,
            "policy_version": policy_version,
            "applied_policy": policy,
        }

    return {
        "ok": True,
        "skipped": False,
        "reason": None,
        "fills": fills,
        "intents": intents,
        "policy_version": policy_version,
        "applied_policy": policy,
    }


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
) -> dict[str, Any]:
    result = dry_run_payload(
        cash_usd=cash_usd,
        positions=positions,
        universe_symbols=universe_symbols,
        prices=prices,
        kill_switch_armed=kill_switch_armed,
        policy_version=policy_version,
        active_rules=active_rules,
        active_policy=active_policy,
        universe_source=universe_source,
    )
    # run-day consumers ignore intents today
    return result
