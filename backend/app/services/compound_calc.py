"""복리 역산 계산 서비스 - 엑셀 PV/FV 함수 기반.

엑셀 재무 함수를 Python으로 구현하여 은퇴플랜 계산에 사용.
모든 계산은 월복리(rate/12, nper*12) 기준이며 기초납 방식(type=1).
"""
from __future__ import annotations

from typing import Optional


class CompoundCalcService:
    """엑셀 PV/FV 기반 은퇴플랜 계산 서비스 (정적 메서드 모음)."""

    DEFAULT_ANNUAL_RATE: float = 0.07
    DEFAULT_INFLATION_RATE: float = 0.021
    DEFAULT_PENSION_RETURN_RATE: float = 0.05

    # ------------------------------------------------------------------
    # 엑셀 재무 함수 Python 구현
    # ------------------------------------------------------------------

    @staticmethod
    def excel_pv(rate: float, nper: int, pmt: float, fv: float = 0.0, type: int = 0) -> float:
        """엑셀 PV 함수와 동일한 현재가치 계산.

        Args:
            rate: 기간 이자율 (월율: annual_rate / 12)
            nper: 납입 횟수 (월수)
            pmt: 정기 납입액 (납입이면 음수, 수령이면 양수)
            fv: 미래가치 (기본 0)
            type: 0=기말납, 1=기초납

        Returns:
            현재가치 (양수 = 투자 필요 금액)
        """
        if rate == 0:
            return -(fv + pmt * nper)
        pvif = (1 + rate) ** nper
        pv_val = (-fv - pmt * (pvif - 1) / rate * (1 + rate * type)) / pvif
        return pv_val

    @staticmethod
    def excel_fv(rate: float, nper: int, pmt: float, pv: float = 0.0, type: int = 0) -> float:
        """엑셀 FV 함수와 동일한 미래가치 계산.

        Args:
            rate: 기간 이자율 (월율: annual_rate / 12)
            nper: 납입 횟수 (월수)
            pmt: 정기 납입액 (납입이면 음수)
            pv: 현재가치 (초기 투자금이면 음수)
            type: 0=기말납, 1=기초납

        Returns:
            미래가치 (양수 = 수령 금액)
        """
        if rate == 0:
            return -(pv + pmt * nper)
        pvif = (1 + rate) ** nper
        fv_val = -pv * pvif - pmt * (pvif - 1) / rate * (1 + rate * type)
        return fv_val

    # ------------------------------------------------------------------
    # 은퇴플랜 개별 계산 메서드
    # ------------------------------------------------------------------

    @classmethod
    def calculate_future_monthly(
        cls,
        monthly_desired: int,
        inflation_rate: float,
        years: int,
    ) -> float:
        """은퇴 시점 희망 월수령액 (물가상승 반영 미래가치).

        Excel FV(inflation_rate, years, 0, -monthly_desired)

        Args:
            monthly_desired: 현재가치 기준 희망 월수령액 (원)
            inflation_rate: 연 물가상승률 (예: 0.021)
            years: 은퇴까지 남은 연수 (investment_years)

        Returns:
            은퇴 시점의 실질 월수령액 (원)
        """
        return monthly_desired * (1 + inflation_rate) ** years

    @classmethod
    def calculate_target_fund(
        cls,
        future_monthly: float,
        pension_return_rate: float,
        inflation_rate: float,
        retirement_period_years: int,
        with_inflation: bool = False,
    ) -> float:
        """목표 은퇴자금 계산 (PV 함수, 월복리, 기초납).

        Args:
            future_monthly: 은퇴 시점 희망 월수령액 (원)
            pension_return_rate: 연금 운용 수익률 (예: 0.05)
            inflation_rate: 연 물가상승률 (예: 0.021)
            retirement_period_years: 연금 수령 기간 (년)
            with_inflation: True=물가상승 반영, False=미반영

        Returns:
            목표 은퇴자금 (원, 양수)
        """
        nper = retirement_period_years * 12

        if with_inflation:
            # 물가반영: 실질수익률 = (1+r_pension)/(1+r_inflation) - 1
            real_rate = (1 + pension_return_rate) / (1 + inflation_rate) - 1
            monthly_rate = real_rate / 12
        else:
            monthly_rate = pension_return_rate / 12

        return -cls.excel_pv(
            rate=monthly_rate,
            nper=nper,
            pmt=future_monthly,  # 수령(양수)
            fv=0,
            type=1,  # 기초납 (매월 초 수령)
        )

    @classmethod
    def calculate_required_holding(
        cls,
        target_fund: float,
        expected_return_rate: float,
        savings_period: int,
        holding_period: int,
        annual_savings: int,
    ) -> float:
        """필요 거치금액 역산 (2단계).

        Step 1: 거치기간 시작 시점 필요 금액
            inner_pv = PV(r/12, holding_period*12, 0, -target_fund)

        Step 2: 적립 시작 시점 필요 원금 (거치 초기에 한번만 납입)
            required = -PV(r/12, savings_period*12, -annual_savings/12, inner_pv)

        Args:
            target_fund: 목표 은퇴자금 (양수, 원)
            expected_return_rate: 연 예상수익률 (예: 0.07)
            savings_period: 적립 기간 (년)
            holding_period: 거치 기간 (investment_years - savings_period, 년)
            annual_savings: 연 적립 금액 (원)

        Returns:
            적립 시작 시점에 필요한 거치 원금 (원, 양수)
        """
        monthly_rate = expected_return_rate / 12

        # Step 1: 거치기간 시작점 필요 금액 (target_fund를 fv로 역산)
        inner_pv = cls.excel_pv(
            rate=monthly_rate,
            nper=holding_period * 12,
            pmt=0,
            fv=-target_fund,  # 목표금액(양수)을 수령 방향으로
        )

        # Step 2: 월 적립 + 초기 거치금 역산
        required = -cls.excel_pv(
            rate=monthly_rate,
            nper=savings_period * 12,
            pmt=-annual_savings / 12,  # 월납 (납입=음수)
            fv=inner_pv,
        )
        return required

    @classmethod
    def build_simulation_table(
        cls,
        current_age: int,
        investment_years: int,
        savings_period: int,
        annual_savings: int,
        required_holding: float,
        expected_return_rate: float,
    ) -> list[dict]:
        """연차별 시뮬레이션 테이블 생성.

        Args:
            current_age: 현재 나이
            investment_years: 적립 총 기간 (은퇴 - 현재나이, 년)
            savings_period: 월 납입 기간 (년)
            annual_savings: 연 적립 금액 (원)
            required_holding: 1년차 초기 거치금 (원)
            expected_return_rate: 연 예상수익률

        Returns:
            연차별 dict 리스트:
            [{"year": 1, "age": 46, "evaluation": int, "cumulative_principal": int, "investment_return": int}, ...]
        """
        monthly_rate = expected_return_rate / 12
        rows = []
        cumulative_principal = 0.0
        prev_evaluation = 0.0

        for year in range(1, investment_years + 1):
            if year <= savings_period:
                monthly_payment = annual_savings / 12
                additional = required_holding if year == 1 else 0.0
            else:
                monthly_payment = 0.0
                additional = 0.0

            evaluation = cls.excel_fv(
                rate=monthly_rate,
                nper=12,
                pmt=-monthly_payment,
                pv=-(prev_evaluation + additional),
            )
            cumulative_principal += monthly_payment * 12 + additional
            investment_return = evaluation - cumulative_principal

            rows.append({
                "year": year,
                "age": current_age + year,
                "monthly_payment": round(monthly_payment),
                "additional": round(additional),
                "evaluation": round(evaluation),
                "cumulative_principal": round(cumulative_principal),
                "investment_return": round(investment_return),
            })
            prev_evaluation = evaluation

        return rows

    @classmethod
    def calculate_required_annual_savings(
        cls,
        target_fund: float,
        expected_return_rate: float,
        savings_period: int,
        holding_period: int,
    ) -> float:
        """거치금 0일 때 목표 달성에 필요한 연적립금액 역산."""
        monthly_rate = expected_return_rate / 12

        if holding_period > 0:
            pv_at_holding = target_fund / ((1 + monthly_rate) ** (holding_period * 12))
        else:
            pv_at_holding = target_fund

        nper = savings_period * 12
        if monthly_rate == 0:
            return pv_at_holding / savings_period if savings_period > 0 else 0
        pvif = (1 + monthly_rate) ** nper
        monthly_pmt = pv_at_holding * monthly_rate / (pvif - 1)
        return monthly_pmt * 12

    # ------------------------------------------------------------------
    # 통합 계산 메서드
    # ------------------------------------------------------------------

    @classmethod
    def calculate_all(
        cls,
        monthly_desired_amount: int,
        retirement_age: int,
        current_age: int,
        retirement_period_years: int,
        savings_period: int,
        annual_savings: int,
        inflation_rate: float = DEFAULT_INFLATION_RATE,
        pension_return_rate: float = DEFAULT_PENSION_RETURN_RATE,
        expected_return_rate: float = DEFAULT_ANNUAL_RATE,
        with_inflation: bool = False,
        plan_start_age: Optional[int] = None,
        # 하위 호환용 (무시됨 - **kwargs로 수신)
        annual_rate: Optional[float] = None,
        **kwargs,
    ) -> dict:
        """희망 은퇴플랜 전체 계산.

        plan_start_age가 주어지면:
          - 투자기간 = retirement_age - plan_start_age (시뮬레이션/거치금 계산)
          - 물가조정기간 = retirement_age - current_age (은퇴당시 수령액 계산)
        plan_start_age가 없으면 current_age 기준으로 모두 계산 (하위 호환).
        """
        # annual_rate 하위 호환: annual_rate가 있으면 expected_return_rate로 사용
        if annual_rate is not None:
            expected_return_rate = annual_rate

        # 투자기간: plan_start_age 기준 (없으면 current_age)
        sim_start_age = plan_start_age if plan_start_age is not None else current_age
        investment_years = retirement_age - sim_start_age
        holding_period = investment_years - savings_period

        if investment_years <= 0:
            raise ValueError(f"retirement_age({retirement_age}) must be greater than start_age({sim_start_age})")
        if holding_period < 0:
            raise ValueError(f"savings_period({savings_period}) must be less than investment_years({investment_years})")
        # 1. 은퇴 시점 희망 월수령액
        #    tog1(물가반영)은 프론트에서 처리하여 전달됨
        #    monthly_desired_amount = 이미 은퇴당시 기준 금액
        future_monthly = monthly_desired_amount

        # 2. 목표 은퇴자금 (물가O/물가X 각각)
        target_fund_inflation = cls.calculate_target_fund(
            future_monthly=future_monthly,
            pension_return_rate=pension_return_rate,
            inflation_rate=inflation_rate,
            retirement_period_years=retirement_period_years,
            with_inflation=True,
        )
        target_fund_no_inflation = cls.calculate_target_fund(
            future_monthly=future_monthly,
            pension_return_rate=pension_return_rate,
            inflation_rate=inflation_rate,
            retirement_period_years=retirement_period_years,
            with_inflation=False,
        )
        target_fund = target_fund_inflation if with_inflation else target_fund_no_inflation

        # 3. 필요 거치금액 (물가O/물가X 각각)
        required_holding_inflation = cls.calculate_required_holding(
            target_fund=target_fund_inflation,
            expected_return_rate=expected_return_rate,
            savings_period=savings_period,
            holding_period=holding_period,
            annual_savings=annual_savings,
        )
        required_holding_no_inflation = cls.calculate_required_holding(
            target_fund=target_fund_no_inflation,
            expected_return_rate=expected_return_rate,
            savings_period=savings_period,
            holding_period=holding_period,
            annual_savings=annual_savings,
        )
        required_holding = required_holding_inflation if with_inflation else required_holding_no_inflation

        # 3-1. 거치금이 마이너스면 적립만으로 충분 → 적립금 역산
        sim_annual_savings = annual_savings
        savings_adjusted = False
        if required_holding < 0:
            required_holding = 0
            if with_inflation:
                required_holding_inflation = 0
            else:
                required_holding_no_inflation = 0
            sim_annual_savings = round(cls.calculate_required_annual_savings(
                target_fund=target_fund,
                expected_return_rate=expected_return_rate,
                savings_period=savings_period,
                holding_period=holding_period,
            ))
            savings_adjusted = True

        # 4. 시뮬레이션 테이블 (플랜시작나이 기준, 목표금액에 맞춘 적립금 사용)
        simulation_table = cls.build_simulation_table(
            current_age=sim_start_age,
            investment_years=investment_years,
            savings_period=savings_period,
            annual_savings=sim_annual_savings,
            required_holding=required_holding,
            expected_return_rate=expected_return_rate,
        )

        result = {
            "investment_years": investment_years,
            "holding_period": holding_period,
            "future_monthly_amount": round(future_monthly),
            "target_fund_inflation": round(target_fund_inflation),
            "target_fund_no_inflation": round(target_fund_no_inflation),
            "target_fund": round(target_fund),
            "required_holding": round(required_holding),
            "required_holding_inflation": round(required_holding_inflation),
            "required_holding_no_inflation": round(required_holding_no_inflation),
            "simulation_table": simulation_table,
            "savings_adjusted": savings_adjusted,
            "adjusted_annual_savings": sim_annual_savings,
            # 하위 호환 필드 (구 API 연동)
            "target_total_fund": round(target_fund),
            "required_lump_sum": round(required_holding),
            "required_annual_savings": sim_annual_savings,
            "calculation_params": {
                "monthly_desired_amount": monthly_desired_amount,
                "retirement_age": retirement_age,
                "current_age": current_age,
                "retirement_period_years": retirement_period_years,
                "savings_period": savings_period,
                "annual_savings": sim_annual_savings,
                "inflation_rate": inflation_rate,
                "pension_return_rate": pension_return_rate,
                "expected_return_rate": expected_return_rate,
                "with_inflation": with_inflation,
                "investment_years": investment_years,
                "holding_period": holding_period,
                "savings_adjusted": savings_adjusted,
                "original_annual_savings": annual_savings,
            },
        }
        return result
