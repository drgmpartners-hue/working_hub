export interface DesiredPlanData {
  monthly_desired_amount: number;
  retirement_period_years: number;
  target_total_fund?: number;
  required_lump_sum?: number;
  required_annual_savings?: number;
  assumed_return_rate?: number;
}

export interface DesiredPlanResponse {
  id: number;
  profile_id: string;
  monthly_desired_amount: number;
  retirement_period_years: number;
  target_total_fund: number;
  required_lump_sum: number;
  required_annual_savings: number;
  assumed_return_rate?: number;
  calculation_params?: Record<string, unknown> | null;
  created_at?: string;
  updated_at?: string;
}

export interface GrowthDataPoint {
  age: number;
  amount: number;
}

export type RetirementTab =
  | 'desired-plan'
  | 'investment-flow'
  | 'retirement-plan'
  | 'interactive-calc'
  | 'pension-plan';

/* ------------------------------------------------------------------ */
/*  은퇴플랜 (3번탭) 타입                                               */
/* ------------------------------------------------------------------ */

export interface YearlyProjection {
  year: number;
  year_num: number;
  age: number;
  lump_sum: number;
  annual_savings: number;
  total_contribution: number;
  annual_return: number;
  evaluation: number;
}

export interface SimulationCalculateRequest {
  current_age: number;
  lump_sum_amount: number;
  annual_savings: number;
  saving_period_years: number;
  inflation_rate: number;
  annual_return_rate: number;
  target_retirement_fund: number;
  target_pension_amount: number;
  desired_retirement_age: number;
  possible_retirement_age: number;
  inheritance_consideration: boolean;
}

export interface SimulationCalculateResponse {
  yearly_projections: YearlyProjection[];
}

export interface RetirementPlanData {
  id?: number;
  customer_id: number;
  current_age: number;
  lump_sum_amount: number;
  annual_savings: number;
  saving_period_years: number;
  inflation_rate: number;
  annual_return_rate: number;
  target_retirement_fund: number;
  target_pension_amount: number;
  desired_retirement_age: number;
  possible_retirement_age: number;
  inheritance_consideration: boolean;
  yearly_projections?: YearlyProjection[] | null;
  created_at?: string;
  updated_at?: string;
}
