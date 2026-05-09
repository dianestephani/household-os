import type { PersonaConfig } from '../types.js';
import { household } from './household.js';
import { nutrition } from './nutrition.js';
import { finance } from './finance.js';

export const personas: Record<string, PersonaConfig> = {
  household,
  nutrition,
  finance,
};

export type PersonaName = keyof typeof personas;
export { household, nutrition, finance };
