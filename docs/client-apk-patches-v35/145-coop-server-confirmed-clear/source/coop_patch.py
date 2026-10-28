"""服务器确认通关：四个原方法仅插入，三个助手和一个已有类静态弱键槽。"""
import asm

SCENE = "pinball.scene.battle::BattleScene"
PLAYING = "pinball.scene.battle.state::BattleScenePlayingStateImpl"
DISPATCH = "BattleScenePlayingStateImpl/socketInput_serverMessage"
WAIT = "BattleScenePlayingStateImpl/isOtherBattleFinished"
ERROR = "BattleScene/socketErrorDialog"
TIMEOUT = "BattleScene/isolateAsForceAbort"
CAPABILITY = "coop-server-confirmed-clear-v1"
TARGETS = [DISPATCH, WAIT, ERROR, TIMEOUT]


def marker_helpers(editor):
    q = editor.q
    slot = editor.add_slot(SCENE, "wfxServerClearedBattles", "haxe.ds::WeakMap", static=True)
    active = editor.add_method(SCENE, "wfxServerClearActive", "Boolean", [], [
        ("getlocal_0",), ("pushscope",),
        ("getlex", q(SCENE)), ("getproperty", slot), ("setlocal_1",),
        ("getlocal_1",), ("iffalse", "NO"),
        ("getlocal_0",), ("getproperty", q("myBattle")), ("setlocal_2",),
        ("getlocal_2",), ("iffalse", "NO"),
        ("getlocal_1",), ("getlocal_2",), ("callproperty", q("get"), 1),
        ("convert_b",), ("returnvalue",),
        ("label", "NO"), ("pushfalse",), ("returnvalue",),
    ], 3)
    mark = editor.add_method(SCENE, "wfxMarkServerClear", "void", [], [
        ("getlocal_0",), ("pushscope",),
        ("getlex", q(SCENE)), ("getproperty", slot), ("setlocal_1",),
        ("getlocal_1",), ("iftrue", "READY"),
        ("getlex", q("haxe.ds::WeakMap")), ("construct", 0), ("setlocal_1",),
        ("getlex", q(SCENE)), ("getlocal_1",), ("setproperty", slot),
        ("label", "READY"),
        ("getlocal_1",), ("getlocal_0",), ("getproperty", q("myBattle")),
        ("pushtrue",), ("callpropvoid", q("set"), 2), ("returnvoid",),
    ], 2)
    return active, mark


def accept_helper(editor, active, mark):
    q, n = editor.q, editor.number
    runtime = next(i for i, row in enumerate(editor.abc.multinames) if row[0] == 0x1B)
    # locals: scene1, BattleSceneKind2, battle3, zoneManager4.
    code = [
        ("getlocal_0",), ("pushscope",),
        ("getlocal_0",), ("getproperty", q("scene")), ("setlocal_1",),
        ("getlocal_1",), ("callproperty", active, 0), ("iftrue", "DONE"),
        ("getlocal_1",), ("getproperty", q("kind")), ("setlocal_2",),
        ("getlocal_2",), ("getproperty", q("index")), n(1), ("ifne", "DONE"),
        ("getlocal_2",), ("getproperty", q("params")), n(0),
        ("getproperty", runtime), ("getproperty", q("config")),
        ("getproperty", q("index")), n(0), ("ifne", "DONE"),
        ("getlocal_1",), ("getproperty", q("questId")),
        ("getproperty", q("index")), n(1), ("ifne", "DONE"),
        ("getlocal_1",), ("getproperty", q("isolated")), ("iftrue", "DONE"),
        ("getlocal_0",), ("callproperty", q("isRestoring"), 0), ("iftrue", "DONE"),
        ("getlocal_0",), ("getproperty", q("bothBossManager")),
        ("getproperty", q("enable")), ("iftrue", "DONE"),
        ("getlocal_0",), ("callproperty", q("get_myBattle"), 0), ("setlocal_3",),
        ("getlocal_3",), ("getproperty", q("state")),
        ("getproperty", q("index")), n(1), ("ifne", "DONE"),
        ("getlocal_3",), ("getproperty", q("floor")),
        ("getlocal_3",), ("callproperty", q("get_totalFloor"), 0),
        n(1), ("subtract_i",), ("ifne", "DONE"),
        ("getlocal_3",), ("getproperty", q("zoneManager")), ("setlocal", 4),
        ("getlocal", 4), ("getproperty", q("state")),
        ("getproperty", q("index")), n(0), ("ifne", "DONE"),
        ("getlocal", 4), ("getproperty", q("index")), n(1), ("add_i",),
        ("getlocal", 4), ("getproperty", q("totalZones")), ("ifne", "DONE"),
        ("getlocal_1",), ("callpropvoid", mark, 0),
        ("getlocal_3",), ("callpropvoid", q("changeToQuestClearState"), 0),
        ("label", "DONE"), ("returnvoid",),
    ]
    return editor.add_method(PLAYING, "wfxAcceptServerClear", "void", [], code, 5)


def build(editor):
    active, mark = marker_helpers(editor)
    accept = accept_helper(editor, active, mark)
    original = asm.decode(editor.body(DISPATCH)[5])
    assert original[23].name == "lookupswitch" and original[23].cases[2] == 37
    assert original[37].name == "jump" and original[37].target == 56
    # ENTER 改写 case 2 的既有入边；其它消息仍落在完整原始指令序列。
    editor.insert(DISPATCH, 37, [
        ("getlocal_0",), ("callpropvoid", accept, 0)])
    editor.insert(WAIT, 2, [
        ("getlocal_0",), ("getproperty", editor.q("scene")),
        ("callproperty", active, 0), ("iffalse", "OLD"),
        ("pushtrue",), ("returnvalue",), ("label", "OLD")])
    for label in (ERROR, TIMEOUT):
        editor.insert(label, 2, [
            ("getlocal_0",), ("callproperty", active, 0),
            ("iffalse", "OLD"), ("returnvoid",), ("label", "OLD")])
    return {
        "capability": CAPABILITY, "targets": TARGETS,
        "wire": [1, [2]], "marker": "WeakMap<Battle identity, true>",
        "native_clear": "Battle.changeToQuestClearState",
        "normal_clear_animation_preserved": True,
        "last_floor": "battle.floor == battle.get_totalFloor() - 1",
        "last_zone": "zoneManager.state.index == 0 && index + 1 == totalZones",
    }
