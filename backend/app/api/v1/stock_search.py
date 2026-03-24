"""Stock/ETF search API — search by name, get code and price."""
from fastapi import APIRouter, Depends, Query
from app.core.deps import get_current_user
from app.services.stock_search_service import search_stocks, get_stock_price

router = APIRouter(prefix="/stock-search", tags=["stock-search"])


@router.get("")
async def search(
    q: str = Query("", description="Search query (product name or code)"),
    limit: int = Query(20, ge=1, le=100),
    current_user=Depends(get_current_user),
):
    """Search ETF/stocks by name (fuzzy match). Returns code, name, NAV, price."""
    results = await search_stocks(q, limit)
    return {"results": results, "total": len(results)}


@router.get("/price/{code}")
async def price(
    code: str,
    current_user=Depends(get_current_user),
):
    """Get current price/NAV for a specific stock code."""
    result = await get_stock_price(code)
    if not result:
        return {"found": False, "code": code}
    return {"found": True, **result}
