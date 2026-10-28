"""Local ComfyUI API adapter. All requests are fixed-path loopback calls."""
from __future__ import annotations
import uuid
import httpx

class EngineOffline(RuntimeError):
    pass


class ComfyClient:
    def __init__(self, base_url="http://127.0.0.1:8188"):
        if base_url != "http://127.0.0.1:8188":
            raise ValueError("COMFY_LOOPBACK_ONLY")
        self.base_url = base_url

    async def _request(self, method: str, path: str, payload=None):
        try:
            async with httpx.AsyncClient(base_url=self.base_url,
                                         timeout=20, follow_redirects=False) as client:
                response = await client.request(method, path, json=payload)
                response.raise_for_status()
                return response.json()
        except (httpx.HTTPError, ValueError) as exc:
            raise EngineOffline("COMFY_REQUEST_FAILED") from exc

    async def ready(self) -> bool:
        try:
            result = await self._request("GET", "/system_stats")
            return isinstance(result, dict) and "system" in result
        except EngineOffline:
            return False

    async def node_registry(self) -> dict:
        result = await self._request("GET", "/object_info")
        if not isinstance(result, dict):
            raise EngineOffline("COMFY_BAD_REGISTRY")
        return result

    async def submit(self, prompt: dict) -> dict:
        result = await self._request("POST", "/prompt",
                                     {"prompt": prompt, "client_id": str(uuid.uuid4())})
        if not isinstance(result, dict) or not isinstance(result.get("prompt_id"), str):
            raise EngineOffline("COMFY_BAD_RESPONSE")
        return {"job_id": result["prompt_id"], "queue_number": result.get("number")}

    async def history(self, job_id: str) -> dict:
        uuid.UUID(job_id)
        result = await self._request("GET", f"/history/{job_id}")
        if not isinstance(result, dict):
            raise EngineOffline("COMFY_BAD_RESPONSE")
        return result.get(job_id, {})

    async def cancel(self, job_id: str) -> bool:
        # Recent Comfy supports targeted cancellation; do NOT use a global
        # /interrupt that could stop someone else's job.
        uuid.UUID(job_id)
        result = await self._request("POST", f"/api/jobs/{job_id}/cancel")
        if not isinstance(result, dict) or type(result.get("cancelled")) is not bool:
            raise EngineOffline("COMFY_CANCEL_UNSUPPORTED")
        return result["cancelled"]
