from langgraph.graph import END, START, StateGraph

from .nodes import (
    apply_guardrails,
    compute_features,
    evaluate_signal,
    fetch_market_data,
    format_output,
)
from .state import BuyAlertState


def _route_on_error(state: BuyAlertState) -> str:
    if state.get("error"):
        return "format_output"
    return "compute_features"


def _route_on_error_after_features(state: BuyAlertState) -> str:
    if state.get("error"):
        return "format_output"
    return "evaluate_signal"


def build_buy_alert_graph():
    graph = StateGraph(BuyAlertState)
    graph.add_node("fetch_market_data", fetch_market_data)
    graph.add_node("compute_features", compute_features)
    graph.add_node("evaluate_signal", evaluate_signal)
    graph.add_node("apply_guardrails", apply_guardrails)
    graph.add_node("format_output", format_output)

    graph.add_edge(START, "fetch_market_data")
    graph.add_conditional_edges(
        "fetch_market_data",
        _route_on_error,
        {"compute_features": "compute_features", "format_output": "format_output"},
    )
    graph.add_conditional_edges(
        "compute_features",
        _route_on_error_after_features,
        {"evaluate_signal": "evaluate_signal", "format_output": "format_output"},
    )
    graph.add_edge("evaluate_signal", "apply_guardrails")
    graph.add_edge("apply_guardrails", "format_output")
    graph.add_edge("format_output", END)
    return graph.compile()
