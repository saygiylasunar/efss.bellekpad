"""Managed runtime lifecycle with no web-controlled commands or shell strings."""
from __future__ import annotations
import asyncio
from collections import deque
from dataclasses import dataclass
from pathlib import Path
from typing import Callable, Awaitable


@dataclass(frozen=True)
class EngineProfile:
    executable: str
    main_script: str
    cwd: str
    args: tuple[str, ...] = ("--listen", "127.0.0.1", "--port", "8188")

    def validate(self):
        if not Path(self.executable).is_file() or not Path(self.main_script).is_file():
            raise ValueError("ENGINE_FILES_MISSING")
        if not Path(self.cwd).is_dir():
            raise ValueError("ENGINE_CWD_MISSING")
        if self.args != ("--listen", "127.0.0.1", "--port", "8188"):
            raise ValueError("ENGINE_ARGS_NOT_ALLOWED")


class Supervisor:
    """A single owned Comfy process. Explicit start/stop, truthful readiness.

    Start returns STARTING; background health check promotes it to READY.
    Stop is valid during STARTING. Failed engine never reports READY.
    """
    def __init__(self, ready_probe: Callable[[], Awaitable[bool]],
                 profile: EngineProfile | None = None):
        self.profile = profile
        self.ready_probe = ready_probe
        self.state = "stopped"
        self.failure = None
        self.proc = None
        self._lock = asyncio.Lock()
        self._watcher = None
        self._stream_task = None
        self._logs = deque(maxlen=120)
        self._generation = 0

    def status(self):
        if self.proc is not None and self.proc.returncode is not None and self.state in ("starting", "ready"):
            self.state = "failed"
            self.failure = "ENGINE_EXITED"
        return {"state": "unconfigured" if self.profile is None else self.state,
                "failure": self.failure, "pid": self.proc.pid if self.proc and self.proc.returncode is None else None}

    def logs(self) -> list[str]:
        return list(self._logs)

    async def _drain_output(self, stream):
        try:
            while line := await stream.readline():
                # Local diagnostics, capped to avoid unbounded model/runtime logs.
                self._logs.append(line.decode("utf-8", errors="replace").rstrip()[-400:])
        except (OSError, ValueError):
            pass

    async def configure(self, profile: EngineProfile,
                        persist: Callable[[EngineProfile], object] | None = None):
        """Commit profile only while inactive, including durable write under lock.

        A rejected/failed persistence attempt cannot silently replace the
        previously configured runtime; the caller must not manage argv.
        """
        async with self._lock:
            if self.state in ("starting", "ready", "stopping") or (
                    self.proc is not None and self.proc.returncode is None):
                raise ValueError("ENGINE_BUSY")
            profile.validate()
            if persist is not None:
                persist(profile)
            self.profile = profile
            self.state = "stopped"
            self.failure = None
            return self.status()

    async def start(self):
        async with self._lock:
            if self.profile is None:
                raise ValueError("ENGINE_NOT_CONFIGURED")
            if self.state in ("starting", "ready", "stopping"):
                raise ValueError("ENGINE_BUSY")
            self.profile.validate()
            # An already-running listener could otherwise fool the readiness
            # probe into claiming *our* newly spawned worker is READY.
            if await self.ready_probe():
                raise ValueError("ENGINE_PORT_OCCUPIED")
            self._generation += 1
            gen = self._generation
            self.failure = None
            self._logs.clear()
            self.state = "starting"
            try:
                self.proc = await asyncio.create_subprocess_exec(
                    self.profile.executable, self.profile.main_script,
                    *self.profile.args, cwd=self.profile.cwd,
                    stdin=asyncio.subprocess.DEVNULL,
                    stdout=asyncio.subprocess.PIPE,
                    stderr=asyncio.subprocess.STDOUT
                )
            except (OSError, ValueError) as exc:
                self.state = "failed"
                self.failure = "ENGINE_START_FAILED"
                raise ValueError("ENGINE_START_FAILED") from exc
            stream = getattr(self.proc, "stdout", None)
            if stream is not None:
                self._stream_task = asyncio.create_task(self._drain_output(stream))
            self._watcher = asyncio.create_task(self._observe(gen))
            return self.status()

    async def _observe(self, gen: int):
        for _ in range(120):
            if gen != self._generation:
                return
            if self.proc is None or self.proc.returncode is not None:
                self.state, self.failure = "failed", "ENGINE_EXITED"
                return
            try:
                healthy = await self.ready_probe()
            except Exception:
                healthy = False
            if healthy:
                if gen == self._generation and self.state == "starting":
                    self.state = "ready"
                return
            await asyncio.sleep(0.5)
        if gen == self._generation:
            self.failure = "ENGINE_READY_TIMEOUT"
            await self.stop(preserve_error=True)

    async def stop(self, preserve_error=False):
        async with self._lock:
            self._generation += 1
            proc = self.proc
            self.proc = None
            self.state = "stopping"
            if proc is not None and proc.returncode is None:
                proc.terminate()
                try:
                    await asyncio.wait_for(proc.wait(), timeout=8)
                except asyncio.TimeoutError:
                    proc.kill()
                    await proc.wait()
            self.state = "failed" if preserve_error else "stopped"
            if not preserve_error:
                self.failure = None
            return self.status()

    async def close(self):
        await self.stop()
