import { expect, it } from 'vitest';
import { mountLogScanner } from '../src/react/mountLogScanner.js';

it('returns an inert standalone handle without browser globals', () => {
  const originalLog = console.log;
  const scanner = mountLogScanner({ visible: true, serverUrl: '/logs' });
  expect(() => {
    scanner.update({ visible: false });
    scanner.update({ visible: true });
    scanner.dispose();
    scanner.dispose();
    scanner.update({ visible: true });
  }).not.toThrow();
  expect(console.log).toBe(originalLog);
});
