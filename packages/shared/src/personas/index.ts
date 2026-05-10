import type { PersonaConfig } from '../types.js';
import { household } from './household.js';
import { grocery } from './grocery.js';
import { finance } from './finance.js';

export const personas: Record<string, PersonaConfig> = {
  household,
  grocery,
  finance,
};

export type PersonaName = keyof typeof personas;
export { household, grocery, finance };
