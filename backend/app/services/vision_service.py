"""Vision service for extracting portfolio data from images using Gemini Vision."""
import json
import logging
from app.services.ai_service import _get_client
from google.genai import types

logger = logging.getLogger(__name__)

EXTRACTION_PROMPT = """당신은 증권사 포트폴리오 캡처 이미지에서 데이터를 추출하는 전문 OCR 시스템입니다.
이 이미지는 한국 증권사(NH투자증권, 키움증권, 삼성증권, 한국투자증권, 하나증권, 미래에셋증권 등)의
IRP, 퇴직연금, 또는 연금저축 포트폴리오 조회 화면 캡처입니다.

## 추출 규칙

### 1. 날짜 (snapshot_date) — 가장 중요
- 화면 상단의 "기준일", "조회일", "기준일자", "평가일", 날짜 표시를 찾으세요
- "2025.09.01", "2025-09-01", "2025/09/01", "25.09.01" 등 다양한 형식 가능
- 반드시 YYYY-MM-DD 형식으로 변환 (예: "2025.09.01" → "2025-09-01")
- 날짜를 절대 생략하지 마세요. 이미지 어디에도 날짜가 없으면 null

### 2. 요약 정보
- 예수금, 외화예수금, 총자산, 매입금액 합계, 평가금액 합계, 평가손익, 총수익률을 추출
- 숫자의 쉼표(,) 제거 후 float 변환
- 수익률은 % 기호 제거 후 숫자만 (예: "+7.80%" → 7.8)

### 3. 보유 종목 (holdings)
각 종목에서 다음을 추출:
- product_name: 상품의 전체 이름을 정확히 추출. 줄이 바뀌어도 전체를 연결하세요
  - 예: "TIGER 미국배당다우존스타겟커버드콜1호" (축약하지 말 것)
  - 예: "한국투자글로벌AI&반도체TOP10증권자투자신탁H(주식)C-Re" (전체를 그대로)
  - 예: "미래에셋인도중소형포커스증권자투자신탁1(주식)CPe" (전체를 그대로)
- product_code: 종목코드가 보이면 추출 (6자리 숫자, A+숫자, NAH225 등)
- product_type: 상품유형 (ETF, 수익증권, 펀드, MMF 등 이미지에 표시된 그대로)
- quantity: 잔고수량/보유수량/좌수 (정수 또는 소수)
- purchase_price: 매입가/매입단가
- current_price: 현재가/기준가/평가단가
- purchase_amount: 매입금액/투자원금
- evaluation_amount: 평가금액
- total_deposit: 총입금액/입금누계 (IRP/퇴직연금에 표시됨, 없으면 null)
- total_withdrawal: 총출금액/출금누계 (IRP/퇴직연금에 표시됨, 없으면 null)
- return_amount: 평가손익 (양수/음수 구분 주의. 마이너스(-) 부호 확인)

### 4. 주의사항
- "예수금", "자동운용상품(고유계정대)", "CMA", "RP" 등 현금성 항목도 holdings에 포함
- "합계", "소계", "총계" 행은 제외
- 이미지에서 보이는 종목 순서대로 seq를 1부터 부여
- 금액에서 음수는 반드시 마이너스(-) 부호 포함
- 소수점이 있는 숫자는 그대로 유지 (예: 3,053.52 → 3053.52)
- return_rate, risk_level, region, weight, reference_price는 추출하지 않음

## 출력 형식 (JSON만 반환, 다른 텍스트 없이)
{
  "snapshot_date": "YYYY-MM-DD 또는 null",
  "deposit_amount": float 또는 null,
  "foreign_deposit_amount": float 또는 null,
  "total_assets": float 또는 null,
  "total_purchase": float,
  "total_evaluation": float,
  "total_return": float 또는 null,
  "total_return_rate": float 또는 null,
  "holdings": [
    {
      "seq": 1,
      "product_name": "정확한 전체 상품명",
      "product_code": "종목코드 또는 null",
      "product_type": "상품유형 또는 null",
      "quantity": float 또는 null,
      "purchase_price": float 또는 null,
      "current_price": float 또는 null,
      "purchase_amount": float,
      "evaluation_amount": float,
      "total_deposit": float 또는 null,
      "total_withdrawal": float 또는 null,
      "return_amount": float 또는 null
    }
  ]
}"""


async def extract_portfolio_from_image(
    image_bytes: bytes,
    mime_type: str = "image/png",
    known_product_names: list[str] | None = None,
) -> dict:
    """Extract portfolio data from a brokerage screenshot using Gemini Vision."""
    import asyncio
    text = ""

    # Build prompt with optional product name reference list
    prompt = EXTRACTION_PROMPT
    if known_product_names:
        ref_list = "\n".join(f"- {name}" for name in known_product_names)
        prompt += f"""

## 참고: 등록된 상품 목록
아래는 기존에 등록된 상품명 목록입니다. 이미지에서 인식한 상품명이 아래 목록과 유사하다면,
목록의 정확한 상품명으로 매칭하여 출력하세요. 목록에 없는 신규 상품은 이미지에서 읽은 그대로 출력하세요.
{ref_list}"""

    try:
        client = _get_client()

        def _call():
            return client.models.generate_content(
                model="gemini-2.5-flash",
                contents=[
                    types.Part.from_bytes(data=image_bytes, mime_type=mime_type),
                    prompt,
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
