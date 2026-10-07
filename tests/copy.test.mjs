import test from 'node:test';
import assert from 'node:assert/strict';
import { COPY } from '../src/pages/Landing/copy.js';
import { AUTH_COPY } from '../src/i18n/authCopy.js';

// The key structure of a copy object, with arrays kept positional.
const shape = (value) => {
  if (Array.isArray(value)) return value.map(shape);
  if (value && typeof value === 'object') {
    return Object.fromEntries(Object.keys(value).sort().map((key) => [key, shape(value[key])]));
  }
  return typeof value;
};

const strings = (value, out = []) => {
  if (typeof value === 'string') out.push(value);
  else if (typeof value === 'function') out.push(value('A', 'B', 'C'));
  else if (value && typeof value === 'object') Object.values(value).forEach((item) => strings(item, out));
  return out;
};

for (const [name, copy] of [['landing page', COPY], ['sign-in pages', AUTH_COPY]]) {
  test(`${name}: every text exists in French, English and Arabic`, () => {
    assert.deepEqual(Object.keys(copy).sort(), ['ar', 'en', 'fr']);
    assert.deepEqual(shape(copy.en), shape(copy.fr));
    assert.deepEqual(shape(copy.ar), shape(copy.fr));
    for (const lang of ['fr', 'en', 'ar']) {
      for (const text of strings(copy[lang])) assert.ok(text.trim().length > 0, `${lang}: empty text`);
    }
  });

  test(`${name}: French has a no-break space before ? ! : and ;`, () => {
    for (const text of strings(copy.fr)) {
      assert.doesNotMatch(text, / [?!:;]/, text);
      assert.doesNotMatch(text, /[^\s \d/][?!;]/, text);
    }
  });
}
