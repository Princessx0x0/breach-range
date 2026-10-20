"""Offline tests for the pure logic of the Attacker and Referee.

Path-finding and scoring touch neither GCP nor Firestore, so they are tested directly on
an in-memory graph. The live read-only checks in tools/verify.py run against the real
sandbox (no mock data by convention), so they are exercised end-to-end, not here.
"""

from breach_range.attacker.agent import find_paths, path_node_ids
from breach_range.referee.agent import apply_verdicts
from breach_range.shared.schema import Edge, Graph, Node, NodeKind, Relation


def _mc01_mc02_graph() -> Graph:
    """The headline chain: public bucket leaks a key, key escalates to owner."""
    return Graph(
        round=1,
        score=0,
        nodes=[
            Node("bucket:assets-public", NodeKind.BUCKET, "proj-assets-public",
                 fromMisconfig="MC-01", labels={"iamPublic": True}),
            Node("sa:ci-deployer", NodeKind.SERVICE_ACCOUNT, "ci-deployer@proj.iam",
                 labels={"roles": []}),
            Node("sa:org-admin", NodeKind.SERVICE_ACCOUNT, "org-admin@proj.iam",
                 labels={"roles": ["roles/owner"]}),
        ],
        edges=[
            Edge("e1", "bucket:assets-public", "sa:ci-deployer",
                 Relation.LEAKS_KEY, viaMisconfig="MC-01"),
            Edge("e2", "sa:ci-deployer", "sa:org-admin",
                 Relation.TOKEN_CREATOR, viaMisconfig="MC-02"),
        ],
    )


def test_finds_the_chained_path():
    paths = find_paths(_mc01_mc02_graph())
    assert len(paths) == 1
    p = paths[0]
    assert p.startNode == "bucket:assets-public"
    assert p.targetNode == "sa:org-admin"
    assert p.edges == ["e1", "e2"]
    assert p.misconfigs == ["MC-01", "MC-02"]


def test_no_path_without_a_high_value_target():
    g = _mc01_mc02_graph()
    g.nodes[2].labels = {"roles": []}  # org-admin loses owner -> nothing worth reaching
    assert find_paths(g) == []


def test_dfs_terminates_on_a_cycle():
    g = Graph(
        round=1, score=0,
        nodes=[
            Node("sa:a", NodeKind.SERVICE_ACCOUNT, "a@proj.iam", labels={"roles": []}),
            Node("sa:b", NodeKind.SERVICE_ACCOUNT, "b@proj.iam",
                 labels={"roles": ["roles/owner"]}),
        ],
        edges=[
            Edge("e1", "sa:a", "sa:b", Relation.TOKEN_CREATOR),
            Edge("e2", "sa:b", "sa:a", Relation.TOKEN_CREATOR),
        ],
    )
    # sa:a is a source (no incoming once the cycle is broken? both have incoming),
    # so iamPublic/source entry rules still let the traversal run and terminate.
    paths = find_paths(g)
    for p in paths:
        assert len(p.edges) == len(set(p.edges))  # simple paths only


def test_scoring_counts_distinct_verified_misconfigs():
    g = _mc01_mc02_graph()
    p = find_paths(g)[0]
    edges_by_id = {e.id: e for e in g.edges}
    node_ids = path_node_ids(p, edges_by_id)

    verified = apply_verdicts(g, {p.id: (True, p, node_ids)})
    assert verified == 2  # MC-01 and MC-02
    assert all(n.reachable for n in g.nodes)


def test_rejected_path_goes_dark_and_scores_zero():
    g = _mc01_mc02_graph()
    p = find_paths(g)[0]
    edges_by_id = {e.id: e for e in g.edges}
    node_ids = path_node_ids(p, edges_by_id)

    score = apply_verdicts(g, {p.id: (False, p, node_ids)})
    assert score == 0
    assert not any(n.reachable for n in g.nodes)  # the graph goes dark
