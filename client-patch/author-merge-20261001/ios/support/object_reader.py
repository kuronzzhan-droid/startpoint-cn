"""Pinned equipment object-boundary reader; relocation support is shared."""
from __future__ import annotations
import re
from aot_helpers import FunctionRecord, text, parse_relocations

def parse_object_functions(binary, wanted: list[int]) -> tuple[object, list, list[FunctionRecord]]:
    symbols = list(binary.symbols)
    text_section = next(section for section in binary.sections if section.name == "__text")
    all_starts = sorted(
        symbol.value
        for symbol in symbols
        if re.search(r":\d+:", text(symbol.name))
        and text_section.virtual_address <= symbol.value < text_section.virtual_address + text_section.size
    )
    boundaries = sorted(set(all_starts + [text_section.virtual_address + text_section.size]))
    records: list[FunctionRecord] = []
    for method_id in wanted:
        candidates = []
        for symbol in symbols:
            name = text(symbol.name)
            match = re.search(r":(\d+):", name)
            if match and int(match.group(1)) == method_id:
                candidates.append(symbol)
        if len(candidates) != 1:
            raise ValueError(f"method {method_id} has {len(candidates)} object symbols")
        symbol = candidates[0]
        end = next(value for value in boundaries if value > symbol.value)
        records.append(FunctionRecord(method_id, text(symbol.name), symbol.value, end))
    return text_section, symbols, records
