"""Validate a locally installed ComfyUI runtime without copying any models.

Only a fixed ComfyUI main.py entry point and loopback flags are permitted.
The browser cannot set argv, network host or working directory separately.
"""
from __future__ import annotations
import os
import re
from pathlib import Path
from .supervisor import EngineProfile


class RuntimeConfigError(ValueError):
    def __init__(self, code: str):
        super().__init__(code)
        self.code = code


def _python_name(path: Path) -> bool:
    name = path.name.casefold()
    return bool(re.fullmatch(r"python(?:3(?:\.\d+)?)?(?:\.exe)?", name))


def candidate_pythons(root: Path) -> list[Path]:
    # This is intentionally a tiny list of known *installation-local* paths,
    # not a recursive model/python scan across the user's disks.
    parent = root.parent
    return [
        root / ".venv" / "Scripts" / "python.exe",
        root / "venv" / "Scripts" / "python.exe",
        root / ".venv" / "bin" / "python",
        root / "venv" / "bin" / "python",
        parent / "python_embeded" / "python.exe",
        parent / "python_embedded" / "python.exe",
        parent / ".venv" / "Scripts" / "python.exe",
    ]


def build_comfy_profile(comfy_root: str, python_executable: str | None = None) -> EngineProfile:
    if not isinstance(comfy_root, str) or not comfy_root.strip():
        raise RuntimeConfigError("COMFY_ROOT_REQUIRED")
    provided = Path(comfy_root).expanduser()
    if not provided.is_absolute():
        raise RuntimeConfigError("COMFY_ROOT_MUST_BE_ABSOLUTE")
    root = provided.resolve()
    if not root.is_dir() or not (root / "main.py").is_file():
        raise RuntimeConfigError("COMFY_INSTALLATION_NOT_FOUND")
    # Validate a second Comfy-specific source file; reject an arbitrary main.py
    # supplied as an execution target in an unrelated directory.
    if not (root / "folder_paths.py").is_file():
        raise RuntimeConfigError("COMFY_INSTALLATION_NOT_RECOGNIZED")

    if python_executable is None or not python_executable.strip():
        python = next((c for c in candidate_pythons(root) if c.is_file()), None)
        if python is None:
            raise RuntimeConfigError("COMFY_PYTHON_REQUIRED")
    else:
        provided_python = Path(python_executable).expanduser()
        if not provided_python.is_absolute():
            raise RuntimeConfigError("COMFY_PYTHON_MUST_BE_ABSOLUTE")
        python = provided_python
    if not python.is_file() or not _python_name(python):
        raise RuntimeConfigError("COMFY_PYTHON_INVALID")
    script = (root / "main.py").resolve()
    result = EngineProfile(executable=str(python.resolve()),
                           main_script=str(script), cwd=str(root))
    try:
        result.validate()
    except ValueError as exc:
        raise RuntimeConfigError(str(exc)) from exc
    return result


def profile_info(profile: EngineProfile | None) -> dict:
    if profile is None:
        return {"configured": False, "comfy_root": None,
                "python_executable": None, "port": 8188}
    return {"configured": True, "comfy_root": profile.cwd,
            "python_executable": profile.executable, "port": 8188}
