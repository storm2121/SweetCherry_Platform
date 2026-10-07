import test from 'node:test';
import assert from 'node:assert/strict';
import { isPlausiblePhone, isValidNewPhone, normalizePhone, phoneToEmail } from '../src/utils/phone.js';

test('maps Moroccan numbers to the same login as before', () => {
  for (const input of ['0612345678', '06 12 34 56 78', '612345678', '212612345678', '+212 6 12 34 56 78', '+212-612-345-678']) {
    assert.equal(normalizePhone(input), '+212612345678', input);
  }
  assert.equal(phoneToEmail(normalizePhone('0612345678')), '212612345678@sweetcherry.ma');
});

test('keeps foreign numbers as typed, with + or 00', () => {
  assert.equal(normalizePhone('+966 5 1234 5678'), '+966512345678');
  assert.equal(normalizePhone('966512345678'), '+966512345678');
  assert.equal(normalizePhone('00966512345678'), '+966512345678');
  assert.equal(normalizePhone('0033612345678'), '+33612345678');
  assert.equal(phoneToEmail('+966512345678'), '966512345678@sweetcherry.ma');
});

test('sign-in never rejects a number an existing account could have', () => {
  for (const input of ['0612345678', '+966512345678', '+212512345678', '+212123456789', '+33612345678', '+1 (555) 0100-200']) {
    assert.equal(isPlausiblePhone(input), true, input);
  }
  for (const input of ['', 'abc', '12345', '+966 51234 567890123', '06-12-ab-56-78']) {
    assert.equal(isPlausiblePhone(input), false, input);
  }
});

test('registration takes Moroccan numbers and numbers with a country code', () => {
  for (const input of ['0612345678', '0712345678', '0512345678', '+212612345678', '+966512345678', '00966512345678', '+33612345678']) {
    assert.equal(isValidNewPhone(input), true, input);
  }
  for (const input of ['+212123456789', '06123', '0812345678', '+2126123456789', 'phone']) {
    assert.equal(isValidNewPhone(input), false, input);
  }
});
