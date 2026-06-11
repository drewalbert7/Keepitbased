"""Light tests for quant execution helpers."""

from paper_trading.quant_execution import compute_buy_notional, evaluate_exit_reason


def test_stop_loss_exit():
    reason = evaluate_exit_reason(
        symbol="AAA",
        avg_cost_usd=100.0,
        price_usd=90.0,
        quant_rank_by_symbol={"AAA": {"score": 80, "strategy": "momentum_liquidity"}},
        ordered_universe=["AAA"],
    )
    assert reason == "stop_loss"


def test_rank_drop_exit():
    reason = evaluate_exit_reason(
        symbol="ZZZ",
        avg_cost_usd=50.0,
        price_usd=52.0,
        quant_rank_by_symbol={"ZZZ": {"score": 40, "strategy": "momentum_liquidity"}},
        ordered_universe=["AAA", "BBB"],
    )
    assert reason == "rank_drop"


def test_score_weighted_sizing():
    small = compute_buy_notional(
        equity_usd=10000,
        available_cash=9000,
        min_cash_reserve=500,
        max_position_pct=10,
        max_notional_per_trade=750,
        max_open_positions=5,
        open_count=0,
        rank_score=60,
    )
    large = compute_buy_notional(
        equity_usd=10000,
        available_cash=9000,
        min_cash_reserve=500,
        max_position_pct=10,
        max_notional_per_trade=750,
        max_open_positions=5,
        open_count=0,
        rank_score=95,
    )
    assert large > small
