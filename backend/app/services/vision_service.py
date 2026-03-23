"""Vision service for extracting portfolio data from images using Gemini Vision."""
import json
import logging
from app.services.ai_service import _get_client
from google.genai import types

logger = logging.getLogger(__name__)

EXTRACTION_PROMPT = """이 이미지는 증권사의 IRP 또는 연금저축 포트폴리오 화면입니다.
이미지에서 다음 정보를 JSON 형식으로 추출해주세요:

{
  "snapshot_date": "조회일자 또는 기준일(string, YYYY-MM-DD 형식, 예: 2026-03-19. 반드시 추출할 것)",
  "deposit_amount": 예수금(float, 없으면 null),
  "foreign_deposit_amount": 외화예수금 원화환산 금액(float, 없으면 null),
  "total_assets": 총자산(float, 없으면 null),
  "total_purchase": 매입금액 합계(float),
  "total_evaluation": 평가금액 합계(float),
  "total_return": 평가손익 합계(float, 없으면 null),
  "total_return_rate": 총수익률(float, % 제외한 숫자만, 예: 13.2),
  "holdings": [
    {
      "seq": 순서(int),
      "product_name": "상품명(string, 정확하게 전체 이름을 추출할 것)",
      "product_code": "종목코드(string, 예: A314250, A445290, NAH225-016 등. 반드시 추출할 것. 없으면 null)",
      "product_type": "상품유형(string, 예: ETF, 주식형펀드, 없으면 null)",
      "quantity": 잔고수량(float, 없으면 null),
      "purchase_price": 매입가(float, 없으면 null),
      "current_price": 현재가(float, 없으면 null),
      "purchase_amount": 매입금액(float),
      "evaluation_amount": 평가금액(float),
      "return_amount": 평가손익(float, 없으면 null)
    }
  ]
}

주의사항:
- 숫자에서 쉼표(,) 제거하고 float으로 변환
- 종목코드는 이미지에 보이는 코드를 정확히 추출 (A로 시작하는 숫자, NAH 등)
- 수익률은 추출하지 마세요 (프론트엔드에서 계산합니다)
- risk_level, region, weight, reference_price, return_rate는 추출하지 않습니다
- 예수금 행은 holdings에 포함하지 말 것
- 합계/소계 행도 holdings에 포함하지 말 것
- 반드시 이미지에 나타난 종목 순서대로 seq를 1부터 부여하고, 그 순서를 유지할 것
- 평가손익(return_amount)은 반드시 추출할 것. 이미지에 없으면 평가금액 - 매입금액으로 계산
- JSON만 반환, 다른 텍스트 없이"""


async def extract_portfolio_from_image(image_bytes: bytes, mime_type: str = "image/png") -> dict:
    """Extract portfolio data from a brokerage screenshot using Gemini Vision."""
    import asyncio
    text = ""
    try:
        client = _get_client()

        def _call():
            return client.models.generate_content(
                model="gemini-2.5-flash",
                contents=[
                    types.Part.from_bytes(data=image_bytes, mime_type=mime_type),
                    EXTRACTION_PROMPT,
                ],
            )

        response = await asyncio.to_thread(_call)
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
