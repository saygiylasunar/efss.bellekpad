"""Regression: SQLite context manager is NOT a connection-close manager.

Without explicit close(), WinError 32 occurs when backup verification tries
to delete the temporary SQLite database on Windows.
"""
import sqlite3
import sys
import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
from bellekpad import workspace_backup
from bellekpad.storage import Workspace


class TrackingConnection(sqlite3.Connection):
    did_close = False
    def close(self):
        self.did_close = True
        super().close()


class SQLiteHandleTests(unittest.TestCase):
    def test_all_read_only_verification_and_snapshot_connections_close(self):
        with tempfile.TemporaryDirectory() as parent:
            workspace=Workspace(Path(parent)/"working")
            workspace.new_note("Not", "Kalıcı\n")
            original=sqlite3.connect
            opened=[]
            def tracking_connect(*args,**kwargs):
                kwargs["factory"]=TrackingConnection
                connection=original(*args,**kwargs)
                opened.append(connection)
                return connection
            # Patch the module function rather than replacing a shared
            # sqlite3 module; the original function remains callable.
            with patch("sqlite3.connect",side_effect=tracking_connect):
                created=workspace_backup.create_backup(workspace)
                archive=workspace.root/"backups"/created["name"]
                checked=workspace_backup.verify_backup(archive)
                restored=workspace_backup.restore_backup(
                    archive,Path(parent)/"restored")
                self.assertTrue(checked["valid"])
                self.assertTrue(restored["restored"])
            self.assertGreaterEqual(len(opened),5)
            self.assertEqual([c.did_close for c in opened],[True]*len(opened))


if __name__=="__main__":
    unittest.main()
