import test from 'node:test';
import assert from 'node:assert/strict';
import { dateInTimeZone, isHttpUrl, isoWeekday, wallTimeInTimeZone } from '../src/utils/http.js';

test('calendar date follows the employee time zone', () => {
  assert.equal(dateInTimeZone(new Date('2026-11-10T20:00:00.000Z'), 'Asia/Kolkata'), '2026-11-11');
});

test('work schedule wall time is converted to the correct server instant', () => {
  assert.equal(wallTimeInTimeZone('2026-11-11', '09:00', 'Asia/Kolkata').toISOString(), '2026-11-11T03:30:00.000Z');
});

test('workdays use ISO weekday numbering', () => {
  assert.equal(isoWeekday('2026-11-11'), 3);
  assert.equal(isoWeekday('2026-11-15'), 7);
});

test('external links accept only http and https', () => {
  assert.equal(isHttpUrl('https://meet.example.com/room'), true);
  assert.equal(isHttpUrl('http://example.com'), true);
  assert.equal(isHttpUrl('javascript:alert(1)'), false);
  assert.equal(isHttpUrl('not a url'), false);
});
