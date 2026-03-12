"""Vision service for extracting portfolio data from images using Gemini Vision."""
import json
import logging
from app.services.ai_service import _get_client
from google.genai import types

logger = logging.getLogger(__name__)

EXTRACTION_PROMPT = """이 이미지는 증권사의 IRP 또는 연금저축 포트폴리오 화면입니다.
이미지에서 다음 정보를 JSON 형식으로 추출해주세요:

{
  "deposit_amount": 예수금(float, 없으면 null),
  "total_purchase": 납입원금 또는 매입금액 합계(float),
  "total_evaluation": 평가금액 합계(float),
  "total_return": 수익금액 합계(float, 없으면 null),
  "total_return_rate": 누적수익률(float, % 제외한 숫자만, 예: 42.0),
  "holdings": [
    {
      "seq": 순서(int),
      "product_name": "상품명(string)",
      "product_code": "상품코드(string, 없으면 null)",
      "product_type": "상품유형(string, 예: ETF, 없으면 null)",
      "risk_level": "위험도(string, 예: 절대안정형, 성장형, 없으면 null)",
      "region": "지역(string, 예: 국내, 미국, 글로벌, 베트남, 없으면 null)",
      "purchase_amount": 매입금액(float),
      "evaluation_amount": 평가금액(float),
      "return_amount": 평가손익(float, 없으면 null),
      "return_rate": 수익률(float, % 제외 숫자만),
      "weight": 비중(float, % 제외 숫자만, 없으면 null),
      "reference_price": 기준가(float, 없으면 null)
    }
  ]
}

주의사항:
- 숫자에서 쉼표(,) 제거하고 float으로 변환
- 수익률, 비중은 % 기호 제외한 숫자만
- 예수금 행은 holdings에 포함하지 말 것
- 합계 행도 holdings에 포함하지 말 것
- JSON만 반환, 다른 텍스트 없이"""


async def extract_portfolio_from_image(image_bytes: bytes, mime_type: str = "image/png") -> dict:
    """Extract portfolio data from a brokerage screenshot using Gemini Vision."""
    text = ""
    try:
        client = _get_client()
        response = client.models.generate_content(
            model="gemini-2.5-flash",
            contents=[
                types.Part.from_bytes(data=image_bytes, mime_type=mime_type),
                EXTRACTION_PROMPT,
            ],
        )
        text = response.text.strip()
        # JSON 블록 추출 (```json ... ``` 포함 처리)
        if "```json" in text:
            text = text.split("```json")[1].split("```")[0].strip()
        elif "```" in text:
            text = text.split("```")[1].split("```")[0].strip()
        return json.loads(text)
    except json.JSONDecodeError as e:
        logger.error("Gemini Vision JSON parse error: %s | raw: %s", e, text[:500])
        return {"error": str(e), "holdings": []}
    except Exception as e:
        logger.error("Gemini Vision API error: %s", e)
        return {"error": str(e), "holdings": []}
