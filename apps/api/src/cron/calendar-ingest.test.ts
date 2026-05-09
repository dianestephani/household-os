import { describe, it, expect } from 'vitest';
import { classifyEventTitle } from './calendar-ingest.js';

describe('classifyEventTitle', () => {
  it('matches Airbnb checkin variants', () => {
    expect(classifyEventTitle('Airbnb check-in')).toBe('airbnb_checkin');
    expect(classifyEventTitle('Airbnb arrival — guest A')).toBe('airbnb_checkin');
    expect(classifyEventTitle('AIRBNB CHECKIN')).toBe('airbnb_checkin');
  });

  it('matches Airbnb checkout', () => {
    expect(classifyEventTitle('Airbnb checkout')).toBe('airbnb_checkout');
    expect(classifyEventTitle('Airbnb departure')).toBe('airbnb_checkout');
  });

  it('matches dogsit arrival/departure', () => {
    expect(classifyEventTitle('Dogsit arrival')).toBe('dogsit_arrival');
    expect(classifyEventTitle('Dogsit drop-off')).toBe('dogsit_arrival');
    expect(classifyEventTitle('Dogsit departure')).toBe('dogsit_departure');
    expect(classifyEventTitle('Dogsit pickup')).toBe('dogsit_departure');
  });

  it('matches landscaper / yard service', () => {
    expect(classifyEventTitle('Landscaper')).toBe('landscaper');
    expect(classifyEventTitle('Lawn service')).toBe('landscaper');
    expect(classifyEventTitle('yard service')).toBe('landscaper');
  });

  it('matches cleaner visit', () => {
    expect(classifyEventTitle('Housecleaner')).toBe('cleaner_visit');
    expect(classifyEventTitle('Cleaner visit')).toBe('cleaner_visit');
  });

  it('returns null for non-matching titles', () => {
    expect(classifyEventTitle('Lunch with mom')).toBeNull();
    expect(classifyEventTitle('Catering: wedding')).toBeNull();
    expect(classifyEventTitle('')).toBeNull();
    expect(classifyEventTitle(null)).toBeNull();
    expect(classifyEventTitle(undefined)).toBeNull();
  });
});
