"""核实两份获准输入的主 ABC 仅有两条 host 字符串不同。"""
from pa_common import BODY_INDEX, INPUT_LOCKS, POOLS, body_bytes, load_locked, sha
from pa_integrity import frozen
from pa_patch import build


def verify_peer(before):
    digest = sha(before.path.read_bytes())
    peer_name = next(name for name, value in INPUT_LOCKS.items() if value != digest)
    peer = load_locked("input/" + peer_name)
    left, right = before.abc, peer.abc
    counts = {}
    for name in POOLS:
        a, b = getattr(left, name), getattr(right, name)
        assert len(a) == len(b), "两份输入常量池条数不一致：" + name
        counts[name] = len(a)
        if name != "strings":
            assert frozen(a) == frozen(b), "两份输入存在额外常量差异：" + name
    differences = [{"index": i, "input": a.decode("utf-8"), "peer": b.decode("utf-8")}
                   for i, (a, b) in enumerate(zip(left.strings, right.strings)) if a != b]
    assert [entry["index"] for entry in differences] == [92787, 92871]
    for entry in differences:
        assert {entry["input"], entry["peer"]} == {
            "<SERVER_HOST>:8001", "<SERVER_HOST>:8001"}
    saved = right.strings
    try:
        right.strings = left.strings
        assert right.serialize() == before._raw, "两份输入的主 ABC 存在额外差异"
    finally:
        right.strings = saved
    build(peer)
    expected_record = body_bytes(peer.abc.bodies[BODY_INDEX])
    return expected_record, {
        "peer_input": peer_name, "pool_counts_equal": counts,
        "host_string_differences": differences,
        "other_boot_abc_bytes_identical": True,
        "planned_patched_body_sha256": sha(expected_record),
        "planned_patched_body_byte_identical": True,
    }
