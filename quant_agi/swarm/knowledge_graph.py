"""Entity graph (NetworkX primary, optional igraph layout export). Lightweight seed builder."""

from __future__ import annotations

from typing import Iterable, Optional

import networkx as nx

try:
    import igraph as ig  # noqa: WPS433 — runtime optional heavyweight
except ImportError:  # pragma: no cover
    ig = None  # type: ignore[misc]


def build_seed_graph(*, ticker: str, sector: str, macro_tags: Iterable[str]) -> nx.DiGraph:
    """Star graph: TICKER hub + sector/macro/news-like tags as spokes."""
    G = nx.DiGraph()
    hub = ticker.upper()
    G.add_node(hub, kind="instrument", reflex_historical=1.0)
    G.add_node(sector.upper(), kind="sector", corr=0.6)
    G.add_edge(hub, sector.upper(), relation="classified_in")

    for i, raw in enumerate(macro_tags):
        tag = raw.strip().upper()[:48] if raw else "MACRO_GENERIC"
        G.add_node(f"M_{i}:{tag}", kind="macro", tag=tag)
        G.add_edge(f"M_{i}:{tag}", sector.upper(), relation="stresses_sector")
        G.add_edge(hub, f"M_{i}:{tag}", relation="priced_in_or_not")

    return G


def graph_to_edge_index(G: nx.DiGraph) -> tuple[list[tuple[int, int]], list[str]]:
    """Return edges + node ids (for Torch GNN stubs)."""
    nodes = list(G.nodes())
    ix = {n: i for i, n in enumerate(nodes)}
    edges = [(ix[u], ix[v]) for u, v in G.edges()]
    return edges, nodes


def reflexive_backfire_score(G: nx.DiGraph) -> float:
    """Heuristic 0–1 tag from graph topology (placeholder for richer narrative graph)."""
    n = max(1, len(G.nodes))
    dens = nx.density(G) if n > 1 else 0.05
    hub_penalty = max(0.0, 0.52 - 0.04 * min(10, n))
    return float(min(1.0, 0.19 + dens * 14.0 + hub_penalty))


def export_igraph_optional(G: nx.DiGraph) -> Optional["ig.Graph"]:
    if ig is None:
        return None
    ig_g = ig.Graph(directed=True)
    nodes = list(G.nodes())
    ig_g.add_vertices(len(nodes))
    ig_g.vs["name"] = nodes
    name_ix = {n: i for i, n in enumerate(nodes)}
    for u, v in G.edges():
        ig_g.add_edge(name_ix[u], name_ix[v])
    return ig_g
