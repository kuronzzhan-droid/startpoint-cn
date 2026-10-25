"""Prepare iOS full ABC for the seven-layer equipment rules port.

This is a compiler-input preparation step only. It starts from the accepted
startup-download iOS ABC and imports the reviewed Android L7 methods. No IPA,
linking, signing or admission material is handled here.
"""
from __future__ import annotations
import copy, hashlib, json, sys, types, zipfile
from pathlib import Path

HERE = Path(__file__).resolve().parent
CLIENT = HERE.parents[1]
ROOT = CLIENT.parent
SOURCE_IPA_SHA256 = "123fdafd38caff60b64bebf4bd2d7dc8f73a48de2e08ba5f99f8d9a79a20d769"
SOURCE_FULL_ABC_SHA256 = "e100ae2f0d6b77ed278f91fda753df3402d7aa12a1b1867600c61f63e4b07f39"
DONOR_SWF_SHA256 = "2eebe2196d5cbe51388efda7ce50bb8eb050da4bcc22eab1a0af85bb680f8845"
IOS_EXPECTED_METHODS = 101436
# The iOS carrier's native resolvePathCollection method has a four-slot
# activation frame. The donor implementation uses eighteen slots and is not
# safe to redirect through the native battle asset resolver. Keep the proven
# iOS resolver until a matching ABI implementation is available.
IOS_BATTLE_RESOLVE_SAFE = True
# Keep the native BattleCharacterLogic instance/vtable layout byte-for-byte
# stable.  The equipment rules are imported into static AuthorState helpers
# and entered from the three existing methods through getlex AuthorState plus callproperty.  This keeps
# the feature enabled without adding methods to the native class.
IOS_EQUIPMENT_RULES_SAFE = True

sys.path[:0] = [str(CLIENT / "lens0907-0908"), str(CLIENT / "lens0907-0908/vendor/abcasm"), str(ROOT / "tools/lens-integration")]
import build_swf as p  # type: ignore
from swfabc import abcfmt, swftags  # type: ignore

CHANGED = [
    "pinball.common.data.ability::AbilitySoulAbilityLogic/getDescriptionWithoutAdditional|1",
    "pinball.common.data.ability::AbilitySoulAbilityLogic/getDescriptionsWithoutAdditional|1",
    "pinball.master.generated::AbilitySoulValues$/parseAt106|1",
    "pinball.common.data.character::BattleCharacterLogic/getAvailableAbilities|1",
    "pinball.common.data.character::BattleCharacterLogic/resolvePathCollection|1",
    "pinball.common.data.ability::EquipmentEnhancementAbilityLogic/getAllDescriptionsToMapForDialog|1",
    "pinball.master.generated::EquipmentEnhancementAbilityValues$/parseAt109|1",
    "pinball.common.data.equipmentEnhancement::EquipmentEnhancementLogic/getPixelart|1",
    "pinball.scene.equipmentList::EquipmentListScene/compareByEquipmentStatus|1",
    "pinball.scene.equipmentSelect::EquipmentSelectThumbnailListRepository/sortByRarity|1",
    "pinball.ui.component.item::ItemThumbnailView/replace|1",
    "pinball.ui.component.item::ItemThumbnailView/setRarity|1",
    "pinball.common.data.item::OwnedEquipmentLogic/getUseableAwakingCrystal|1",
    "pinball.ui.component.item.party::PartyItemThumbnailView/updateEnhancedEffectAnimation|1",
]
RULE_METHODS = [
    ("pinball.common.data.character::BattleCharacterLogic/wfIsCursedSoul|1", "authorEquipmentIsCursedSoul", [38], 55),
    ("pinball.common.data.character::BattleCharacterLogic/wfIsDecaySoul|1", "authorEquipmentIsDecaySoul", [38], 55),
    ("pinball.common.data.character::BattleCharacterLogic/wfCountEquipment|1", "authorEquipmentCount", [32, 55], 38),
    ("pinball.common.data.character::BattleCharacterLogic/wfTierAbility|1", "authorEquipmentTier", [32, 32, 38], 32),
    ("pinball.common.data.character::BattleCharacterLogic/wfEquipmentRule|1", "authorEquipmentRule", [32, 32, 32], 32),
]
HELPER = "cn.mod::AuthorState"
OWNER = "pinball.common.data.character::BattleCharacterLogic"


def sha(data: bytes) -> str:
    return hashlib.sha256(data).hexdigest()


def view(abc):
    return p.View(types.SimpleNamespace(abc=abc), p.asm)


def dump(path: Path, obj):
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps(obj, ensure_ascii=False, indent=2, default=str) + "\n", encoding="utf8")


def main_abc(swf: Path):
    _, _, _, raw = swftags.load_swf(str(swf))
    hits = []
    for code, off, header, length in swftags.iter_tags(raw):
        if code != 82:
            continue
        data = raw[off + header : off + header + length]
        nul = data.index(b"\0", 4)
        name = data[4:nul].decode("utf8", "replace")
        if name.startswith("boot_"):
            hits.append((name, abcfmt.ABC(data[nul + 1 :])))
    if len(hits) != 1:
        raise AssertionError(("main ABC count", len(hits)))
    return hits[0]


def method_info(v, mid):
    m = v.a.methods[mid]
    return v.mn(m[0]), tuple(v.mn(x) for x in m[1]), m[3]


def method_id_for_label(v, label):
    """Resolve a unique body label to its method_info id, not its body index."""
    matches = v.by_label.get(label, [])
    if len(matches) != 1:
        raise AssertionError(("expected one method body", label, matches))
    mid = v.a.bodies[matches[0]][0]
    if not 0 <= mid < len(v.a.methods) or v.labels.get(mid) != label:
        raise AssertionError(("method body identity mismatch", label, mid))
    return mid


def activation(v, body):
    return p.activation_traits(v, body)


def ensure_qname(abc, namespace_name, name):
    """Return a public package multiname, appending only new pool records."""
    namespace = next(
        i for i, row in enumerate(abc.namespaces)
        if row[0] == 22 and abc.s(row[1]) == namespace_name
    )
    encoded = name.encode("utf8")
    if encoded in abc.strings:
        string_i = abc.strings.index(encoded)
    else:
        abc.strings.append(encoded)
        string_i = len(abc.strings) - 1
    match = next(
        (
            i for i, row in enumerate(abc.multinames)
            if row[0] == 7 and row[1] == namespace and row[2] == string_i
        ),
        None,
    )
    if match is not None:
        return match
    abc.multinames.append((7, namespace, string_i))
    return len(abc.multinames) - 1


def short_name(v, multiname):
    """Return the unqualified method/property name of a multiname."""
    name = v.a.mn_name(multiname)
    return name.rsplit("::", 1)[-1].split("|", 1)[0]


def clone_instruction(ins, *, op=None, args=None):
    return p.asm.Instruction(ins.op if op is None else op,
                             ins.args if args is None else args,
                             ins.target, ins.cases, ins.default)


def local_instruction(name, index):
    if name == "getlocal":
        return p.asm.Instruction(98, (index,))
    if name == "setlocal":
        return p.asm.Instruction(99, (index,))
    if name in {"getlocal_0", "getlocal_1", "getlocal_2", "getlocal_3",
                "setlocal_0", "setlocal_1", "setlocal_2", "setlocal_3"}:
        read = name.startswith("getlocal")
        return (p.asm.Instruction((208 if read else 212) + index) if index <= 3
                else p.asm.Instruction(98 if read else 99, (index,)))
    if name in {"inclocal", "inclocal_i", "declocal", "declocal_i", "kill"}:
        return p.asm.Instruction({"inclocal": 146, "inclocal_i": 194,
                                  "declocal": 148, "declocal_i": 195,
                                  "kill": 8}[name], (index,))
    raise AssertionError(("unsupported local instruction", name, index))


def shift_instance_locals(instructions, mapping, preserve_prologue=True):
    """Shift an instance method's locals into static-method slots.

    Static methods reserve local 0 for the class object.  The original
    getlocal_0/pushscope prologue therefore stays in place; all subsequent
    references to the instance local and arguments use the supplied mapping.
    """
    out = []
    for index, ins in enumerate(instructions):
        if preserve_prologue and index < 2:
            out.append(clone_instruction(ins))
            continue
        # The bundled assembler has the kill operand format but no mnemonic.
        name = "kill" if ins.op == 8 else ins.name
        if name in {"getlocal_0", "getlocal_1", "getlocal_2", "getlocal_3",
                    "setlocal_0", "setlocal_1", "setlocal_2", "setlocal_3"}:
            old = int(name[-1])
            out.append(local_instruction(name, mapping.get(old, old + 1)))
        elif name in {"getlocal", "setlocal", "inclocal", "inclocal_i", "declocal", "declocal_i", "kill"}:
            out.append(local_instruction(name, mapping.get(int(ins.args[0]), int(ins.args[0]) + 1)))
        elif name == "hasnext2":
            out.append(clone_instruction(ins, args=[mapping.get(int(x), int(x) + 1) for x in ins.args]))
        else:
            out.append(clone_instruction(ins))
    return out


def remap_targets(instructions, source_indices, index_map):
    """Remap branch targets after an instruction stream insertion/removal."""
    for ins, source in zip(instructions, source_indices):
        if ins.target is not None:
            ins.target = index_map[ins.target]
        if ins.cases is not None:
            ins.cases = [index_map[x] for x in ins.cases]
        if ins.default is not None:
            ins.default = index_map[ins.default]
    return instructions


def encode_body(body, instructions, source_indices=None, index_map=None, max_stack=None):
    if source_indices is not None and index_map is not None:
        remap_targets(instructions, source_indices, index_map)
    code, offsets = p.asm.encode(instructions)
    if body[6]:
        # Exceptions store byte offsets, while branches already use indices.
        # Even a short-local expansion can move these byte boundaries.
        old_code = body[5]
        old_instructions = p.asm.decode(old_code)
        _, old_offsets = p.asm.encode(old_instructions)
        old_offsets.append(len(old_code)); offsets.append(len(code))
        if index_map is None:
            if len(old_instructions) != len(instructions):
                raise AssertionError("exception relocation needs instruction index map")
            index_map = {i: i for i in range(len(old_offsets))}
        locations = {offset: offsets[index_map[i]] for i, offset in enumerate(old_offsets)}
        body[6] = [(locations[a], locations[b], locations[c], d, e)
                   for a, b, c, d, e in body[6]]
    body[5] = code
    if max_stack is not None:
        body[1] = max(body[1], max_stack)
    return body


def replace_rule_calls(v, instructions, method_ids):
    names = {
        "wfIsCursedSoul": ("authorEquipmentIsCursedSoul", 2),
        "wfIsDecaySoul": ("authorEquipmentIsDecaySoul", 2),
        "wfCountEquipment": ("authorEquipmentCount", 3),
        "wfTierAbility": ("authorEquipmentTier", 4),
        "wfEquipmentRule": ("authorEquipmentRule", 4),
    }
    old = list(instructions); calls = {}
    for i, ins in enumerate(old):
        if ins.op in (70, 79) and ins.args:
            short = v.a.mn_name(ins.args[0]).rsplit("::", 1)[-1].split("|", 1)[0]
            if short in names:
                receiver = next((j for j in range(i - 1, -1, -1) if old[j].name == "getlocal_0"), None)
                if receiver is None: raise AssertionError(("instance helper receiver not found", i, short))
                calls[i] = (receiver, *names[short])
    receiver_indices = {row[0] for row in calls.values()}
    owner_qmn = ensure_qname(v.a, "cn.mod", "AuthorState")
    result=[]; sources=[]; index_map={}
    for i, ins in enumerate(old):
        index_map[i] = len(result)
        if i in receiver_indices:
            result.extend([p.asm.Instruction(96, (owner_qmn,)), p.asm.Instruction(208)])
            sources.extend([i, i]); continue
        if i in calls:
            _receiver, name, argc = calls[i]
            qmn = ensure_qname(v.a, "cn.mod", name)
            result.append(p.asm.Instruction(70, (qmn, argc))); sources.append(i); continue
        result.append(clone_instruction(ins)); sources.append(i)
    index_map[len(old)] = len(result); remap_targets(result, sources, index_map)
    return result


def add_static_trait(target, helper_traits, name, method_id):
    qmn = ensure_qname(target.a, "cn.mod", name)
    trait = p.abcfmt.Trait(); trait.name = qmn; trait.kind = 1; trait.attr = 0
    trait.metadata = []; trait.data = ["method", 0, method_id]
    helper_traits.append(trait)
    return qmn


def static_info(return_type, params):
    return [return_type, list(params), 0, 0, None, None]


def append_method_shell(target, importer, helper_traits, name, info):
    """Reserve a static method and its AuthorState trait; return method id."""
    mid = len(target.a.methods)
    target.a.methods.append(copy.deepcopy(info))
    add_static_trait(target, helper_traits, name, mid)
    return mid


def append_imported_static(target, donor, importer, helper_traits, source_label,
                           name, params, return_type):
    source_bi = donor.by_label[source_label][0]
    source_mid = donor.a.bodies[source_bi][0]
    target_mid = len(target.a.methods)
    importer.methods[source_mid] = target_mid
    target.a.methods.append(static_info(return_type, [32] + list(params)))
    add_static_trait(target, helper_traits, name, target_mid)
    return source_bi, source_mid, target_mid


def transform_static_rule_body(body, target, method_ids):
    old = p.asm.decode(body[5])
    names = {
        "wfIsCursedSoul": ("authorEquipmentIsCursedSoul", 2),
        "wfIsDecaySoul": ("authorEquipmentIsDecaySoul", 2),
        "wfCountEquipment": ("authorEquipmentCount", 3),
        "wfTierAbility": ("authorEquipmentTier", 4),
        "wfEquipmentRule": ("authorEquipmentRule", 4),
    }
    helper_calls = {}
    for i, ins in enumerate(old):
        if ins.op in (70, 79) and ins.args:
            name = short_name(target, ins.args[0])
            if name in names:
                receiver = next((j for j in range(i - 1, -1, -1) if old[j].name == "getlocal_0"), None)
                if receiver is None: raise AssertionError(("helper receiver not found", body[0], i, name))
                helper_calls[i] = (receiver, *names[name])
    receiver_indices = {row[0] for row in helper_calls.values()}
    result=[]; sources=[]; index_map={}
    for i,ins in enumerate(old):
        index_map[i]=len(result)
        if i in receiver_indices:
            # class closure is local 0; character is explicit local 1
            result.extend([p.asm.Instruction(208), p.asm.Instruction(209)]); sources.extend([i,i]); continue
        if i in helper_calls:
            _receiver,name,argc=helper_calls[i]
            qmn=ensure_qname(target.a,"cn.mod",name)
            result.append(p.asm.Instruction(70,(qmn,argc))); sources.append(i); continue
        result.append(shift_instance_locals([ins], {j:j+1 for j in range(64)}, preserve_prologue=(i<2))[0]); sources.append(i)
    index_map[len(old)]=len(result); remap_targets(result,sources,index_map)
    body[2]=max(body[2],1+max((int(ins.args[0]) for ins in result if ins.op in {98,99,146,148,194,195,8} and ins.args),default=0))
    encode_body(body,result,index_map=index_map,max_stack=max(body[1],8)); return body


def transform_resolve_helper(body, target):
    if body[6]:
        raise AssertionError('Resolve closure exception handlers require explicit remapping')
    old = p.asm.decode(body[5])
    assert len(old) >= 4 and all(x.name == "op_ef" for x in old[:4])
    kept = old[4:]
    # Static class closure is local 0 (AuthorState class closure).  The native
    # character is explicit local 1, followed by tier, paths, owner, permit.
    captured = {"paths": 3, "characterOwner": 4, "featuresPermit": 5, "_gthis": 1}
    mapping = {0: 1, 1: 2, 2: 7, 3: 8, 4: 9}
    shifted = shift_instance_locals(kept, mapping, preserve_prologue=False)
    for ins in shifted:
        if ins.op == 96 and ins.args:
            short = target.a.mn_name(ins.args[0]).rsplit("::", 1)[-1]
            if short in captured:
                ins2 = local_instruction("getlocal", captured[short])
                ins.op, ins.args, ins.target, ins.cases, ins.default = ins2.op, ins2.args, ins2.target, ins2.cases, ins2.default
    result = [p.asm.Instruction(208), p.asm.Instruction(48)] + shifted
    for ins in result:
        if ins.target is not None: ins.target -= 2
        if ins.cases is not None: ins.cases = [x - 2 for x in ins.cases]
        if ins.default is not None: ins.default -= 2
    body[2] = max(body[2], 10); body[3] = 1; body[4] = 2; body[6] = []; body[7] = []
    encode_body(body, result, max_stack=max(body[1], 8))
    return body


def transform_preload_body(body, target, method_ids):
    old = p.asm.decode(body[5])
    helper_names = {
        "wfIsDecaySoul": ("authorEquipmentIsDecaySoul", 2),
        "wfTierAbility": ("authorEquipmentTier", 4),
    }
    calls = {}
    for i, ins in enumerate(old):
        if ins.op in (70, 79) and ins.args:
            short = target.a.mn_name(ins.args[0]).rsplit("::", 1)[-1].split("|", 1)[0]
            if short in helper_names:
                receiver = next((j for j in range(i - 1, -1, -1) if old[j].name == "getlocal_0"), None)
                if receiver is None: raise AssertionError(("preload helper receiver not found", i, short))
                calls[i] = (receiver, *helper_names[short])
    receiver_indices = {row[0] for row in calls.values()}
    resolve_qmn = ensure_qname(target.a, "cn.mod", "authorEquipmentResolveAbilityPaths")
    result=[]; sources=[]; index_map={}; i=0
    mapping = {0: 1, 1: 8, 2: 5, 3: 6, 4: 7}
    while i < len(old):
        index_map[i] = len(result)
        # callback(null, tier) becomes the direct static resolver.
        if (i + 4 < len(old) and old[i].name == "getlocal_1" and
                old[i + 1].name == "pushnull" and old[i + 2].name == "getlocal" and
                old[i + 2].args == [4] and old[i + 3].name == "call" and
                old[i + 4].name == "pop"):
            start = len(result)
            replacement = [local_instruction("getlocal", 0),
                           local_instruction("getlocal", 1),
                           local_instruction("getlocal", 7),
                           local_instruction("getlocal", 2),
                           local_instruction("getlocal", 3),
                           local_instruction("getlocal", 4),
                           p.asm.Instruction(70, (resolve_qmn, 5)),
                           p.asm.Instruction(41)]
            result.extend(replacement); sources.extend([i] * len(replacement))
            for j in range(i + 1, i + 5): index_map[j] = start
            i += 5; continue
        if i in receiver_indices:
            result.extend([local_instruction("getlocal", 0), local_instruction("getlocal", 1)])
            sources.extend([i, i]); i += 1; continue
        if i in calls:
            _receiver, name, argc = calls[i]
            qmn = ensure_qname(target.a, "cn.mod", name)
            result.append(p.asm.Instruction(70, (qmn, argc))); sources.append(i); i += 1; continue
        result.append(clone_instruction(old[i]) if i < 2 else shift_instance_locals([old[i]], mapping, preserve_prologue=False)[0])
        sources.append(i); i += 1
    index_map[len(old)] = len(result); remap_targets(result, sources, index_map)
    body[2] = max(body[2], 9); body[3] = 1; body[4] = 2
    encode_body(body, result, index_map=index_map, max_stack=max(body[1], 8))
    return body


def make_bridge_body(method_id, preload_mid, target):
    owner_qmn = ensure_qname(target.a, "cn.mod", "AuthorState")
    preload_qmn = ensure_qname(target.a, "cn.mod", "authorEquipmentPreloadTiers")
    code = [p.asm.Instruction(96, (owner_qmn,)),
            local_instruction("getlocal", 0), local_instruction("getlocal", 1),
            local_instruction("getlocal", 2), local_instruction("getlocal", 3),
            p.asm.Instruction(70, (preload_qmn, 4)), p.asm.Instruction(41),
            p.asm.Instruction(71)]
    encoded, _ = p.asm.encode(code)
    return [method_id, 5, 6, 0, 1, encoded, [], []]


def prepare_historical_input_unlinked(*, source_ipa, source_full_abc, donor_swf, output_dir):
    """Reproduce fixed historical inputs without enabling the disabled CLI."""
    WORK = Path(output_dir).resolve()
    if WORK.exists():
        raise FileExistsError("Preserve the existing historical output directory")
    ipa = Path(source_ipa).resolve()
    full_path = Path(source_full_abc).resolve()
    DONOR_SWF = Path(donor_swf).resolve()
    if any(path.is_relative_to(WORK) for path in (ipa, full_path, DONOR_SWF)):
        raise ValueError("Historical output overlaps an input")
    if sha(ipa.read_bytes()) != SOURCE_IPA_SHA256:
        raise AssertionError("accepted iOS IPA hash changed")
    full_bytes = full_path.read_bytes()
    if sha(full_bytes) != SOURCE_FULL_ABC_SHA256:
        raise AssertionError("accepted iOS full ABC hash changed")
    if len(abcfmt.ABC(full_bytes).methods) != IOS_EXPECTED_METHODS:
        raise AssertionError("unexpected accepted iOS method count")
    if sha(DONOR_SWF.read_bytes()) != DONOR_SWF_SHA256:
        raise AssertionError("Android L7 donor hash changed")
    _, donor_abc = main_abc(DONOR_SWF)
    target_abc = abcfmt.ABC(full_bytes)
    target_before = copy.deepcopy(target_abc)
    target = view(target_abc)
    donor = view(donor_abc)
    if len(donor.a.methods) != 101074:
        raise AssertionError(("unexpected L7 method count", len(donor.a.methods)))

    importer = p.Importer(target, donor)
    helper_i = next(i for i, row in enumerate(target.a.instances) if target.a.mn_name(row[0]) == HELPER)
    helper_traits = target.a.classes[helper_i][1]
    helper_traits_before = copy.deepcopy(helper_traits)
    owner_i = next(i for i, row in enumerate(target.a.instances) if target.a.mn_name(row[0]) == OWNER)

    # The description closure remains an ordinary imported compiler method.
    closure_label = "pinball.common.data.ability::EquipmentEnhancementAbilityLogic/getAllDescriptionsToMapForDialog|1/closure:0"
    source_bi = donor.by_label[closure_label][0]; source_mid = donor.a.bodies[source_bi][0]
    closure_mid = len(target.a.methods); importer.methods[source_mid] = closure_mid
    target.a.methods.append(importer.info(source_mid)); closure_body = importer.body(source_bi, closure_mid)
    p.check_body(closure_body, target.a); target.a.bodies.append(closure_body)
    appended = [{"label": closure_label, "source_method": source_mid, "compiled_method": closure_mid,
                 "kind": "closure", "body_sha256": sha(closure_body[5])}]

    # Reserve all static helper method ids before importing bodies so donor
    # callproperty references can be rewritten to the AuthorState callproperty traits deterministically.
    helper_method_ids = {}
    helper_sources = {}
    for source_label, name, params, ret in RULE_METHODS:
        source_bi, source_mid, target_mid = append_imported_static(
            target, donor, importer, helper_traits, source_label, name, params, ret)
        key = {"authorEquipmentIsCursedSoul": "cursed", "authorEquipmentIsDecaySoul": "decay",
               "authorEquipmentCount": "count", "authorEquipmentTier": "tier",
               "authorEquipmentRule": "rule"}[name]
        helper_method_ids[key] = target_mid; helper_sources[key] = (source_bi, source_mid)

    preload_label = "pinball.common.data.character::BattleCharacterLogic/wfPreloadEquipmentTiers|1"
    source_bi, source_mid, preload_mid = append_imported_static(
        target, donor, importer, helper_traits, preload_label,
        "authorEquipmentPreloadTiers", [32, 32, 32], 1)
    helper_method_ids["preload"] = preload_mid; helper_sources["preload"] = (source_bi, source_mid)

    resolve_closure_label = "pinball.common.data.character::BattleCharacterLogic/resolvePathCollection|1/closure:0"
    resolve_bi = donor.by_label[resolve_closure_label][0]; resolve_source_mid = donor.a.bodies[resolve_bi][0]
    resolve_mid = len(target.a.methods); importer.methods[resolve_source_mid] = resolve_mid
    target.a.methods.append(static_info(1, [32, 32, 32, 32, 32]))
    add_static_trait(target, helper_traits, "authorEquipmentResolveAbilityPaths", resolve_mid)
    helper_method_ids["resolve"] = resolve_mid

    bridge_mid = len(target.a.methods)
    target.a.methods.append(static_info(1, [32, 32, 32, 55, 55]))
    add_static_trait(target, helper_traits, "authorEquipmentPreloadBridge", bridge_mid)
    helper_method_ids["bridge"] = bridge_mid

    # Import and validate the static rule bodies after all helper IDs exist.
    standalone_helpers = []
    for key in ("cursed", "decay", "count", "tier", "rule"):
        bi, _ = helper_sources[key]; mid = helper_method_ids[key]
        body = importer.body(bi, mid); body[0] = mid
        transform_static_rule_body(body, target, helper_method_ids)
        p.check_body(body, target.a)
        target.a.bodies.append(body)
        standalone_helpers.append({"kind": key, "source_method": donor.a.bodies[bi][0], "compiled_method": mid,
                                   "body_sha256": sha(body[5])})
    bi, _ = helper_sources["preload"]
    body = importer.body(bi, preload_mid); body[0] = preload_mid
    transform_preload_body(body, target, helper_method_ids)
    p.check_body(body, target.a)
    target.a.bodies.append(body)
    standalone_helpers.append({"kind": "preload", "source_method": donor.a.bodies[bi][0], "compiled_method": preload_mid,
                               "body_sha256": sha(body[5])})
    resolve_body = importer.body(resolve_bi, resolve_mid); resolve_body[0] = resolve_mid
    transform_resolve_helper(resolve_body, target); p.check_body(resolve_body, target.a)
    target.a.bodies.append(resolve_body)
    standalone_helpers.append({"kind": "resolve_ability_paths", "source_method": resolve_source_mid,
                               "compiled_method": resolve_mid, "body_sha256": sha(resolve_body[5])})
    bridge_body = make_bridge_body(bridge_mid, preload_mid, target); p.check_body(bridge_body, target.a)
    target.a.bodies.append(bridge_body)
    standalone_helpers.append({"kind": "native_preload_bridge", "compiled_method": bridge_mid,
                               "body_sha256": sha(bridge_body[5])})

    # Import the reviewed methods. resolvePathCollection keeps the iOS native
    # entry and is reached through the native AOT bridge added by the linker;
    # the other three equipment call sites use the static rule helper.
    changed_records = []
    for label in CHANGED:
        if IOS_BATTLE_RESOLVE_SAFE and label == "pinball.common.data.character::BattleCharacterLogic/resolvePathCollection|1":
            continue
        target_bi = target.by_label[label][0]; source_bi = donor.by_label[label][0]
        old = copy.deepcopy(target.a.bodies[target_bi]); source = donor.a.bodies[source_bi]
        target_mid = old[0]
        try:
            imported = importer.body(source_bi, target_mid, scope=old[3])
        except AssertionError as exc:
            if "lexical scope index" not in str(exc): raise
            imported = importer.body(source_bi, target_mid, scope=None)
        if label == "pinball.common.data.character::BattleCharacterLogic/getAvailableAbilities|1":
            imported = copy.deepcopy(imported)
            imported_ins = replace_rule_calls(target, p.asm.decode(imported[5]), helper_method_ids)
            encode_body(imported, imported_ins, max_stack=imported[1])
        p.check_body(imported, target.a)
        runtime_activation = activation(view(target_before), old)
        imported_activation = activation(target, imported)
        if runtime_activation != imported_activation:
            raise AssertionError((label, "activation ABI differs", len(runtime_activation), len(imported_activation)))
        target.a.bodies[target_bi] = imported
        hook_mid = len(target.a.methods); target.a.methods.append(copy.deepcopy(target.a.methods[target_mid]))
        hook_body = copy.deepcopy(imported); hook_body[0] = hook_mid; target.a.bodies.append(hook_body)
        add_static_trait(target, helper_traits, f"authorEquipmentHook{target_mid}", hook_mid)
        p.check_body(hook_body, target.a)
        changed_records.append({"label": label, "runtime_method": target_mid, "compiled_method": hook_mid,
                                "strategy": "replace", "source_method": source[0],
                                "activation_runtime": len(runtime_activation), "activation_imported": len(imported_activation),
                                "runtime_body_sha256": sha(imported[5]), "compiled_body_sha256": sha(hook_body[5]),
                                "source_body_sha256": sha(source[5])})
    compiled_helpers = sorted(helper_method_ids.values())
    activation_aliases = []
    added_records = []

    # Structural prefix checks: all existing pools, methods, scripts, classes,
    # and instance traits remain in place. Only the AuthorState static trait
    # tail and the listed existing method bodies may differ.
    for pool in ("ints", "uints", "doubles", "strings", "namespaces", "ns_sets", "multinames"):
        old = getattr(target_before, pool); new = getattr(target.a, pool)
        if p.freeze(old) != p.freeze(new[:len(old)]):
            raise AssertionError(("pool prefix changed", pool))
    if p.freeze(target_before.methods) != p.freeze(target.a.methods[:len(target_before.methods)]):
        raise AssertionError("old method_info prefix changed")
    if p.freeze(target_before.metadata) != p.freeze(target.a.metadata[:len(target_before.metadata)]):
        raise AssertionError("metadata prefix changed")
    if p.freeze(target_before.scripts) != p.freeze(target.a.scripts[:len(target_before.scripts)]):
        raise AssertionError("script prefix changed")
    for ci, old_class in enumerate(target_before.classes):
        new_class = target.a.classes[ci]
        if ci == helper_i:
            if p.freeze(old_class[0]) != p.freeze(new_class[0]) or p.freeze(old_class[1]) != p.freeze(new_class[1][:len(old_class[1])]):
                raise AssertionError(("AuthorState class prefix changed", ci))
        elif p.freeze(old_class) != p.freeze(new_class):
            raise AssertionError(("unrelated class prefix changed", ci))
    for i, old in enumerate(target_before.instances):
        new = target.a.instances[i]
        if p.freeze(old[:-1]) != p.freeze(new[:-1]): raise AssertionError(("instance header changed", i))
        old_traits = old[-1]; new_traits = new[-1]
        if p.freeze(old_traits) != p.freeze(new_traits[:len(old_traits)]):
            raise AssertionError(("unrelated instance traits changed", i))
    expected_changed = {target.by_label[r["label"]][0] for r in changed_records if r["strategy"] == "replace"}
    actual_changed = {i for i,(old,new) in enumerate(zip(target_before.bodies,target.a.bodies)) if p.freeze(old) != p.freeze(new)}
    if actual_changed != expected_changed:
        raise AssertionError(("unexpected existing body changes", sorted(actual_changed), sorted(expected_changed)))
    full = target.a.serialize()
    if abcfmt.ABC(full).serialize() != full: raise AssertionError("full ABC roundtrip failed")
    WORK.mkdir(parents=True, exist_ok=True)
    out_full = WORK / "equipment-ios-full.abc"; out_full.write_bytes(full)
    report = {
        "status": "ios_equipment_standalone_full_abc_prepared_native_link_pending",
        "source_ipa": str(ipa), "source_ipa_sha256": SOURCE_IPA_SHA256,
        "source_full_abc": str(full_path), "source_full_abc_sha256": SOURCE_FULL_ABC_SHA256,
        "source_full_abc_method_count": len(target_before.methods),
        "donor_swf": str(DONOR_SWF), "donor_swf_sha256": DONOR_SWF_SHA256,
        "donor_main_abc_method_count": len(donor.a.methods),
        "full_abc_file": str(out_full), "full_abc_sha256": sha(full), "full_abc_sha1": hashlib.sha1(full).hexdigest(),
        "old_methods": len(target_before.methods), "total_methods": len(target.a.methods),
        "changed_existing": changed_records, "added_equipment": added_records,
        "standalone_equipment_helpers": standalone_helpers,
        "native_repair_contract_v2": {"linking_allowed": False,
                                     "typed_resolver_thunk_required": True,
                                     "reserved_legacy_bridge_method": bridge_mid,
                                     "resolve_method": method_id_for_label(target, "pinball.common.data.character::BattleCharacterLogic/resolvePathCollection|1"),
                                     "preload_method": preload_mid},
        "compiled_helpers": compiled_helpers,
        "activation_aliases": activation_aliases,
        "closures": appended, "helper_class": HELPER,
        "runtime_body_changes": sorted(expected_changed),
        "new_traits": len(helper_traits) - len(helper_traits_before),
        "admission_rotation": "deferred_to_iOS_linker",
        "ipa_built": False, "linked": False, "device_tested": False,
        "ios_battle_resolve_safe": IOS_BATTLE_RESOLVE_SAFE,
        "ios_equipment_rules_safe": IOS_EQUIPMENT_RULES_SAFE,
    }
    dump(WORK / "port.json", report)
    print(json.dumps({k: report[k] for k in ("status","old_methods","total_methods","full_abc_sha256","full_abc_sha1","new_traits","runtime_body_changes")}, ensure_ascii=False, indent=2))

def main():
    raise RuntimeError(
        "Legacy iOS equipment preparation is disabled: its static Object bridge "
        "is incompatible with the typed native resolver ABI. Use repair_current.py "
        "and the reviewed compiler-only resolver thunk; native linking remains a separate step."
    )


if __name__ == "__main__": main()
