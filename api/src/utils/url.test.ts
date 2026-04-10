import { describe, it, expect } from 'vitest';
import { normalizeUrl } from './url.js';
import { isSafeUrl } from './url.js';

describe('url utils', () => {
  describe('normalizeUrl', () => {
    it('normalizes URLs correctly', () => {
      expect(normalizeUrl('example.com')).toBe('https://example.com');
      expect(normalizeUrl('http://example.com')).toBe('http://example.com');
    });
  });

  describe('isSafeUrl', () => {
    it('blocks private IP URLs', async () => {
      expect(await isSafeUrl('http://127.0.0.1')).toBe(false);
      expect(await isSafeUrl('http://169.254.169.254')).toBe(false);
      expect(await isSafeUrl('http://[::1]')).toBe(false);
      expect(await isSafeUrl('http://localhost')).toBe(false);
    });

    it('allows public URLs', async () => {
      expect(await isSafeUrl('http://example.com')).toBe(true);
      expect(await isSafeUrl('http://8.8.8.8')).toBe(true);
    });
  });
});
