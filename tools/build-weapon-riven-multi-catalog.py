"""只读核对实际启用资源链，生成与 C22 同算法的服务端 P2 catalog 候选。"""
import argparse
import hashlib
import json
from pathlib import Path
import sys
import zipfile

sys.dont_write_bytecode = True
TABLES = (
    "master/ability/ability_soul.orderedmap", "master/item/equipment.orderedmap",
    "master/item/item.orderedmap", "master/string/custom_ability_string.orderedmap",
)
SALT = "K6R9T9Hz22OpeIGEWB0ui6c6PYFQnJGy"


def sha(raw):
    return hashlib.sha256(raw).hexdigest()


def save(path, value):
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps(value, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")


def build(manifest_path, generator, client_catalog, destination):
    manifest_raw = manifest_path.read_bytes()
    manifest = json.loads(manifest_raw)
    wanted = {}
    for logical in TABLES:
        key = hashlib.sha1((logical + SALT).encode()).hexdigest()
        wanted["production/upload/" + key[:2] + "/" + key[2:]] = logical
    latest, scanned = {}, []
    for entry in manifest["patches"]:
        if not entry.get("enabled", True):
            continue
        expected = {row["name"]: row for row in entry.get("archive_integrity", [])}
        for name in entry.get("chain") or [entry["archive"]]:
            if Path(name).name != name:
                raise ValueError("Archive path escapes active chain")
            archive = next((p for p in (manifest_path.parent / "active" / name,
                                       manifest_path.parent / name) if p.is_file()), None)
            if archive is None:
                raise FileNotFoundError(name)
            scanned.append(name)
            with zipfile.ZipFile(archive) as source:
                for member in sorted(wanted.keys() & set(source.namelist())):
                    if source.namelist().count(member) != 1:
                        raise ValueError("Duplicate archive resource: " + member)
                    raw = source.read(member)
                    digest = sha(archive.read_bytes())
                    info = expected.get(name)
                    if info and (info["size"] != archive.stat().st_size or info["sha256"] != digest):
                        raise ValueError("Archive integrity mismatch: " + name)
                    latest[wanted[member]] = (raw, {"archive": str(archive.resolve()),
                        "archive_sha256": digest, "member": member, "version": entry["version"],
                        "manifest_integrity_verified": bool(info)})
    if set(latest) != set(TABLES):
        raise ValueError("Missing actual client resources: " + str(set(TABLES) - latest.keys()))
    sys.path.insert(0, str(generator.resolve()))
    from riven_sources import flat_table
    souls = flat_table(latest[TABLES[0]][0])
    weapons = flat_table(latest[TABLES[1]][0])
    delta_path = generator / "out/client_master_delta.json"
    delta = json.loads(delta_path.read_bytes())["flat"][TABLES[0]]
    if len(delta) != 96 or any(souls.get(key) != rows for key, rows in delta.items()):
        raise ValueError("Current 96 generator affixes do not equal actual resource rows")
    carriers = sorted(int(key) for key in souls if key.isdigit() and 16000001 <= int(key) <= 16000999
                      and int(key) != 16000900)
    if carriers != list(range(16000001, 16000201)):
        raise ValueError("Unexpected published carrier key set")
    evidence, resources = [], []
    for logical in TABLES:
        raw, source = latest[logical]
        relative = "weapon-riven-multi-resources/" + logical
        path = destination / relative
        path.parent.mkdir(parents=True, exist_ok=True)
        path.write_bytes(raw)
        resources.append({"logical": logical, "path": relative, "sha256": sha(raw)})
        evidence.append({"logical": logical, "sha256": sha(raw), "bytes": len(raw), **source})
    canonical = "".join(row["logical"] + "\t" + row["sha256"] + "\n"
                        for row in sorted(resources, key=lambda row: row["logical"]))
    catalog_id = "riven-multi-v1-" + sha(canonical.encode())[:32]
    client = json.loads(client_catalog.read_bytes())
    if client["catalog_id"] != catalog_id or client["canonical"] != canonical:
        raise ValueError("Resource catalog differs from the C22 client build")
    for row in client["resources"]:
        if latest[row["logical"]][0] != (client_catalog.parent / "catalog-resources" / row["logical"]).read_bytes():
            raise ValueError("C22 frozen raw resource bytes differ: " + row["logical"])
    result = {"version": 1, "resources": resources,
        "soulKeys": sorted(int(key) for key in souls if key.isdigit() and int(key) > 0),
        "weaponIds": sorted(int(key) for key in weapons if key.isdigit() and int(key) > 0)}
    save(destination / "weapon_riven_multi_catalog.json", result)
    report = {"status": "passed", "catalog_id": catalog_id, "canonical": canonical,
        "manifest": str(manifest_path.resolve()), "manifest_sha256": sha(manifest_raw),
        "cdn_version": manifest["cdn_version"], "archives_scanned": len(scanned),
        "resources": evidence, "soul_key_count": len(result["soulKeys"]),
        "weapon_id_count": len(result["weaponIds"]), "carrier_count": len(carriers),
        "affixes_checked": len(delta), "generator_delta_sha256": sha(delta_path.read_bytes()),
        "client_catalog": str(client_catalog.resolve()), "client_catalog_sha256": sha(client_catalog.read_bytes()),
        "client_raw_resources_identical": True, "device_loaded_resources_verified": False}
    save(destination / "weapon_riven_multi_catalog_evidence.json", report)
    print(json.dumps({key: report[key] for key in ("status", "catalog_id", "cdn_version", "archives_scanned",
        "soul_key_count", "weapon_id_count", "carrier_count", "affixes_checked")}, ensure_ascii=False))


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--manifest", type=Path, required=True)
    parser.add_argument("--generator", type=Path, required=True)
    parser.add_argument("--client-catalog", type=Path, required=True)
    parser.add_argument("--destination", type=Path, required=True)
    args = parser.parse_args()
    build(args.manifest, args.generator, args.client_catalog, args.destination)
