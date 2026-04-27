from langgraph.graph import END, START, StateGraph

from .opportunity_nodes import (
    context_loader,
    intent_router,
    opportunity_scout,
    policy_guardrail,
    response_formatter,
)
from .opportunity_state import OpportunityState


def _route_or_fail(state: OpportunityState, success_node: str) -> str:
    if state.get("error"):
        return "response_formatter"
    return success_node


def build_opportunity_graph():
    graph = StateGraph(OpportunityState)
    graph.add_node("intent_router", intent_router)
    graph.add_node("context_loader", context_loader)
    graph.add_node("opportunity_scout", opportunity_scout)
    graph.add_node("policy_guardrail", policy_guardrail)
    graph.add_node("response_formatter", response_formatter)

    graph.add_edge(START, "intent_router")
    graph.add_conditional_edges(
        "intent_router",
        lambda state: _route_or_fail(state, "context_loader"),
        {"context_loader": "context_loader", "response_formatter": "response_formatter"},
    )
    graph.add_conditional_edges(
        "context_loader",
        lambda state: _route_or_fail(state, "opportunity_scout"),
        {"opportunity_scout": "opportunity_scout", "response_formatter": "response_formatter"},
    )
    graph.add_conditional_edges(
        "opportunity_scout",
        lambda state: _route_or_fail(state, "policy_guardrail"),
        {"policy_guardrail": "policy_guardrail", "response_formatter": "response_formatter"},
    )
    graph.add_edge("policy_guardrail", "response_formatter")
    graph.add_edge("response_formatter", END)
    return graph.compile()
