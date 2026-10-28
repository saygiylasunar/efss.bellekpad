"""Comfy HTTP wire-contract tests, exercising httpx transport without a GPU."""
import asyncio
import json
import sys
import unittest
import uuid
from pathlib import Path
from unittest.mock import patch
import httpx

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
from bellekpad.comfy import ComfyClient, EngineOffline


class ComfyWireTests(unittest.TestCase):
    def setUp(self):
        self.jid=str(uuid.uuid4())

    def test_real_httpx_client_contract(self):
        sent=[]
        jid=self.jid

        def handle(request:httpx.Request):
            sent.append((request.method,request.url.path,dict(request.url.params)))
            if request.url.path=="/system_stats":
                return httpx.Response(200,json={"system":{"comfyui_version":"test"}})
            if request.url.path=="/object_info":
                return httpx.Response(200,json={"Text":{"input":{"required":{}},"output":[]}})
            if request.url.path=="/prompt" and request.method=="POST":
                body=json.loads(request.content)
                self.assertIn("client_id",body)
                self.assertIn("prompt",body)
                return httpx.Response(200,json={"prompt_id":jid,"number":3})
            if request.url.path==f"/api/jobs/{jid}":
                return httpx.Response(200,json={"id":jid,"status":"completed"})
            if request.url.path==f"/history/{jid}":
                return httpx.Response(200,json={jid:{
                    "status":{"status_str":"success","completed":True},
                    "outputs":{"3":{"images":[{"filename":"saved.png","subfolder":"gen","type":"output"}]}}
                }})
            if request.url.path=="/view":
                self.assertEqual(request.url.params["filename"],"saved.png")
                self.assertEqual(request.url.params["subfolder"],"gen")
                return httpx.Response(200,content=b"\x89PNG\r\n\x1a\nimage",
                                      headers={"content-type":"image/png"})
            if request.url.path==f"/api/jobs/{jid}/cancel":
                return httpx.Response(200,json={"cancelled":True})
            return httpx.Response(404,json={})

        original=httpx.AsyncClient
        transport=httpx.MockTransport(handle)
        def factory(**kwargs):
            return original(transport=transport,**kwargs)
        async def scenario():
            client=ComfyClient()
            self.assertTrue(await client.ready())
            self.assertIn("Text",await client.node_registry())
            submitted=await client.submit({"1":{"class_type":"Text","inputs":{}}})
            self.assertEqual(submitted["job_id"],jid)
            self.assertEqual(submitted["queue_number"],3)
            self.assertEqual((await client.job_status(jid))["status"],"completed")
            self.assertTrue((await client.history(jid))["status"]["completed"])
            content,mime=await client.image("saved.png","gen","output")
            self.assertTrue(content.startswith(b"\x89PNG"))
            self.assertEqual(mime,"image/png")
            self.assertTrue(await client.cancel(jid))
        with patch("bellekpad.comfy.httpx.AsyncClient",side_effect=factory):
            asyncio.run(scenario())
        self.assertEqual([x[1] for x in sent],[
            "/system_stats","/object_info","/prompt",f"/api/jobs/{jid}",
            f"/history/{jid}","/view",f"/api/jobs/{jid}/cancel"
        ])

    def test_fallback_only_confirms_terminal_history(self):
        jid=self.jid
        saw_history=False

        def handle(request:httpx.Request):
            nonlocal saw_history
            if request.url.path==f"/api/jobs/{jid}":
                return httpx.Response(404,json={"error":"legacy"})
            if request.url.path==f"/history/{jid}":
                saw_history=True
                return httpx.Response(200,json={jid:{
                    "status":{"status_str":"success","completed":True}}})
            return httpx.Response(404)

        original=httpx.AsyncClient
        transport=httpx.MockTransport(handle)
        async def scenario():
            client=ComfyClient()
            self.assertEqual((await client.job_status(jid))["status"],"completed")
        with patch("bellekpad.comfy.httpx.AsyncClient",
                   side_effect=lambda **kwargs:original(transport=transport,**kwargs)):
            asyncio.run(scenario())
        self.assertTrue(saw_history)

    def test_non_image_response_is_not_forwarded_as_gallery(self):
        def handle(request:httpx.Request):
            if request.url.path=="/view":
                return httpx.Response(200,content=b"<script>invalid</script>",
                                      headers={"content-type":"text/html"})
            return httpx.Response(404)
        original=httpx.AsyncClient
        transport=httpx.MockTransport(handle)
        async def scenario():
            with self.assertRaisesRegex(EngineOffline,"COMFY_NON_IMAGE_OUTPUT"):
                await ComfyClient().image("x.png","","output")
        with patch("bellekpad.comfy.httpx.AsyncClient",
                   side_effect=lambda **kwargs:original(transport=transport,**kwargs)):
            asyncio.run(scenario())


if __name__=="__main__":
    unittest.main()
