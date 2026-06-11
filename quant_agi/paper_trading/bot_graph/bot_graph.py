from __future__ import annotations

from langgraph.graph import END, START, StateGraph

from paper_trading.bot_graph.bot_nodes import (
    candidate_debate,
    entry_strategist,
    execution_planner,
    exit_strategist,
    load_context,
    reconcile,
    regime_analyst,
    risk_manager,
    universe_scout,
)
from paper_trading.bot_graph.bot_state import BotPlanState


def build_bot_plan_graph():
    """Multi-agent plan-tick graph: scout → regime → entry/exit strategists → risk → planner."""
    graph = StateGraph(BotPlanState)
    graph.add_node("load_context", load_context)
    graph.add_node("universe_scout", universe_scout)
    graph.add_node("regime_analyst", regime_analyst)
    graph.add_node("exit_strategist", exit_strategist)
    graph.add_node("entry_strategist", entry_strategist)
    graph.add_node("candidate_debate", candidate_debate)
    graph.add_node("reconcile", reconcile)
    graph.add_node("risk_manager", risk_manager)
    graph.add_node("execution_planner", execution_planner)

    graph.add_edge(START, "load_context")
    graph.add_edge("load_context", "universe_scout")
    graph.add_edge("universe_scout", "regime_analyst")
    graph.add_edge("regime_analyst", "exit_strategist")
    graph.add_edge("exit_strategist", "entry_strategist")
    graph.add_edge("entry_strategist", "candidate_debate")
    graph.add_edge("candidate_debate", "reconcile")
    graph.add_edge("reconcile", "risk_manager")
    graph.add_edge("risk_manager", "execution_planner")
    graph.add_edge("execution_planner", END)

    return graph.compile()
