"""AI 답(JSON) 읽기 — 사소한 형식 오류는 고쳐 읽고, 잘린 답은 한도를 늘려 다시 요청한다(2026-10-08)."""
import pytest

from app.services import llm_client


def test_parse_json_repairs_unescaped_quotes_and_missing_comma():
    broken = '{"sections": [{"no": 7, "blocks": [{"type": "para", "items": [{"text": "회사는 "글로벌 확장"을 밝혔다.", "source_ids": ["A1"]}]}]}]}'
    d = llm_client.parse_json(broken)
    assert d["sections"][0]["no"] == 7 and "글로벌 확장" in d["sections"][0]["blocks"][0]["items"][0]["text"]
    d2 = llm_client.parse_json('```json\n{"a": 1 "b": 2}\n```')
    assert d2 == {"a": 1, "b": 2}
    assert llm_client.parse_json('{"ok": true}') == {"ok": True}
    with pytest.raises(llm_client.LLMError):
        llm_client.parse_json("JSON 이 아닌 그냥 문장")


async def test_claude_json_retries_with_more_tokens_when_truncated(monkeypatch):
    calls = []

    async def fake_text(key, prompt, **kw):
        calls.append(kw.get("max_tokens"))
        if len(calls) == 1:
            return llm_client.LLMResult(text='{"summary": {"three_lines": [{"text": "중간에 잘', stop_reason="max_tokens")
        return llm_client.LLMResult(text='{"summary": {"three_lines": []}}', stop_reason="end_turn")

    monkeypatch.setattr(llm_client, "claude_text", fake_text)
    r = await llm_client.claude_json("k", "p", max_tokens=16000)
    assert r.data == {"summary": {"three_lines": []}} and calls == [16000, 32000]
