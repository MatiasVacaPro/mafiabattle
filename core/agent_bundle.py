"""Assemble the page factory from the same manifest used by DOM tests."""

import json
from pathlib import Path


def load_agent_source(scripts=None):
    root = (
        Path(scripts)
        if scripts is not None
        else Path(__file__).resolve().parents[1] / "scripts"
    )
    manifest = json.loads((root / "agent-manifest.json").read_text(encoding="utf-8"))
    dependencies = "\n".join(
        (root / name).read_text(encoding="utf-8") for name in manifest["dependencies"]
    )
    entry = (root / manifest["entry"]).read_text(encoding="utf-8")
    return f"function(config) {{\n{dependencies}\nreturn ({entry})(config);\n}}"
