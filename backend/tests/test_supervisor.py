"""Supervisor lifecycle tests with a fake OS child; no user processes touched."""
import asyncio
import sys
import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
from bellekpad.supervisor import EngineProfile, Supervisor


class Child:
    def __init__(self):
        self.pid=4142
        self.returncode=None
        self.stopped=False

    def terminate(self):
        self.stopped=True
        self.returncode=0

    def kill(self):
        self.stopped=True
        self.returncode=-9

    async def wait(self):
        return self.returncode


class SupervisorTests(unittest.TestCase):
    def test_start_ready_stop(self):
        async def scenario():
            with tempfile.TemporaryDirectory() as root:
                executable=Path(root)/"python.exe"
                script=Path(root)/"main.py"
                executable.write_text("dummy")
                script.write_text("dummy")
                profile=EngineProfile(str(executable),str(script),root)
                child=Child()
                count=0
                async def probe():
                    nonlocal count
                    count += 1
                    return count >= 2

                async def spawn(*args, **kwargs):
                    self.assertEqual(args[0],str(executable))
                    self.assertEqual(args[1],str(script))
                    self.assertEqual(kwargs["cwd"],root)
                    return child

                sup=Supervisor(probe,profile)
                with patch("bellekpad.supervisor.asyncio.create_subprocess_exec",side_effect=spawn):
                    self.assertEqual((await sup.start())["state"],"starting")
                    await asyncio.sleep(0.02)
                    self.assertEqual(sup.status()["state"],"ready")
                    self.assertEqual((await sup.stop())["state"],"stopped")
                    self.assertTrue(child.stopped)
        asyncio.run(scenario())

    def test_existing_server_cannot_pass_as_managed_worker(self):
        async def scenario():
            with tempfile.TemporaryDirectory() as root:
                executable=Path(root)/"python.exe"
                script=Path(root)/"main.py"
                executable.touch()
                script.touch()
                profile=EngineProfile(str(executable),str(script),root)
                async def already_listening():
                    return True

                sup=Supervisor(already_listening,profile)
                with self.assertRaisesRegex(ValueError,"ENGINE_PORT_OCCUPIED"):
                    await sup.start()
                self.assertEqual(sup.status()["state"],"stopped")
        asyncio.run(scenario())

    def test_stop_during_loading(self):
        async def scenario():
            with tempfile.TemporaryDirectory() as root:
                executable=Path(root)/"python.exe"
                script=Path(root)/"main.py"
                executable.touch()
                script.touch()
                child=Child()
                async def not_ready():
                    return False

                async def spawn(*args,**kwargs):
                    return child

                sup=Supervisor(not_ready,EngineProfile(str(executable),str(script),root))
                with patch("bellekpad.supervisor.asyncio.create_subprocess_exec",side_effect=spawn):
                    await sup.start()
                    self.assertEqual((await sup.stop())["state"],"stopped")
                    await asyncio.sleep(0)
                    self.assertTrue(child.stopped)
        asyncio.run(scenario())


if __name__=="__main__":
    unittest.main()
