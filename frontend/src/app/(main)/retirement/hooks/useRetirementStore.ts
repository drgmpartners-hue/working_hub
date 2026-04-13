'use client';

import { create } from 'zustand';
import type { RetirementTab } from '../types/retirement';

export type { RetirementTab };

export interface RetirementCustomer {
  name: string;
  id: string;
  targetFund: number;
  retirementAge: number;
  currentAge: number;
  birthDate: string | null;
}

interface RetirementStore {
  selectedCustomerId: string | null;
  selectedCustomer: RetirementCustomer | null;
  activeTab: RetirementTab;

  setCustomer: (customer: RetirementCustomer | null) => void;
  setTab: (tab: RetirementTab) => void;
}

export const useRetirementStore = create<RetirementStore>()((set) => ({
  selectedCustomerId: null,
  selectedCustomer: null,
  activeTab: 'desired-plan',

  setCustomer: (customer) =>
    set({
      selectedCustomer: customer,
      selectedCustomerId: customer?.id ?? null,
    }),

  setTab: (tab) => set({ activeTab: tab }),
}));
