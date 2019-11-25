'use strict';

const { isIdentifierStart, isIdentifierChar } = require('acorn');

function isIdentifier(str) {
  if (str === '') {
    return false;
  }
  const first = str.codePointAt(0);
  if (!isIdentifierStart(first)) {
    return false;
  }
  const firstLen = first > 0xffff ? 2 : 1;
  for (let i = firstLen; i < str.length; i += 1) {
    const cp = str.codePointAt(i);
    if (!isIdentifierChar(cp)) {
      return false;
    }
    if (cp > 0xffff) {
      i += 1;
    }
  }
  return true;
}

// https://github.com/nodejs/node/blob/master/lib/util.js
// https://github.com/nodejs/node/blob/master/LICENSE

/* eslint-disable no-control-regex */
const strEscapeSequencesRegExp = /[\x00-\x1f\x27\x5c]/;
const strEscapeSequencesReplacer = /[\x00-\x1f\x27\x5c]/g;
/* eslint-enable no-control-regex */

// Escaped special characters. Use empty strings to fill up unused entries.
const meta = [
  '\\u0000', '\\u0001', '\\u0002', '\\u0003', '\\u0004',
  '\\u0005', '\\u0006', '\\u0007', '\\b', '\\t',
  '\\n', '\\u000b', '\\f', '\\r', '\\u000e',
  '\\u000f', '\\u0010', '\\u0011', '\\u0012', '\\u0013',
  '\\u0014', '\\u0015', '\\u0016', '\\u0017', '\\u0018',
  '\\u0019', '\\u001a', '\\u001b', '\\u001c', '\\u001d',
  '\\u001e', '\\u001f', '', '', '',
  '', '', '', '', "\\'", '', '', '', '', '',
  '', '', '', '', '', '', '', '', '', '',
  '', '', '', '', '', '', '', '', '', '',
  '', '', '', '', '', '', '', '', '', '',
  '', '', '', '', '', '', '', '', '', '',
  '', '', '', '', '', '', '', '\\\\',
];

const escapeFn = (str) => meta[str.charCodeAt(0)];

const strEscape = (str) => {
  // Some magic numbers that worked out fine while benchmarking with v8 6.0
  if (str.length < 5000 && !strEscapeSequencesRegExp.test(str)) {
    return `'${str}'`;
  }
  if (str.length > 100) {
    return `'${str.replace(strEscapeSequencesReplacer, escapeFn)}'`;
  }
  let result = '';
  let last = 0;
  let i = 0;
  for (; i < str.length; i += 1) {
    const point = str.charCodeAt(i);
    if (point === 39 || point === 92 || point < 32) {
      if (last === i) {
        result += meta[point];
      } else {
        result += `${str.slice(last, i)}${meta[point]}`;
      }
      last = i + 1;
    }
  }
  if (last === 0) {
    result = str;
  } else if (last !== i) {
    result += str.slice(last);
  }
  return `'${result}'`;
};

function isFullWidthCodePoint(code) {
  // Code points are derived from:
  // http://www.unicode.org/Public/UNIDATA/EastAsianWidth.txt
  return Number.isInteger(code) && code >= 0x1100 && (
    code <= 0x115f // Hangul Jamo
      || code === 0x2329 // LEFT-POINTING ANGLE BRACKET
      || code === 0x232a // RIGHT-POINTING ANGLE BRACKET
      // CJK Radicals Supplement .. Enclosed CJK Letters and Months
      || (code >= 0x2e80 && code <= 0x3247 && code !== 0x303f)
      // Enclosed CJK Letters and Months .. CJK Unified Ideographs Extension A
      || (code >= 0x3250 && code <= 0x4dbf)
      // CJK Unified Ideographs .. Yi Radicals
      || (code >= 0x4e00 && code <= 0xa4c6)
      // Hangul Jamo Extended-A
      || (code >= 0xa960 && code <= 0xa97c)
      // Hangul Syllables
      || (code >= 0xac00 && code <= 0xd7a3)
      // CJK Compatibility Ideographs
      || (code >= 0xf900 && code <= 0xfaff)
      // Vertical Forms
      || (code >= 0xfe10 && code <= 0xfe19)
      // CJK Compatibility Forms .. Small Form Variants
      || (code >= 0xfe30 && code <= 0xfe6b)
      // Halfwidth and Fullwidth Forms
      || (code >= 0xff01 && code <= 0xff60)
      || (code >= 0xffe0 && code <= 0xffe6)
      // Kana Supplement
      || (code >= 0x1b000 && code <= 0x1b001)
      // Enclosed Ideographic Supplement
      || (code >= 0x1f200 && code <= 0x1f251)
      // CJK Unified Ideographs Extension B .. Tertiary Ideographic Plane
      || (code >= 0x20000 && code <= 0x3fffd)
  );
}

const kUTF16SurrogateThreshold = 0x10000; // 2 ** 16

// Regex used for ansi escape code splitting
// Adopted from https://github.com/chalk/ansi-regex/blob/master/index.js
// License: MIT, authors: @sindresorhus, Qix-, and arjunmehta
// Matches all ansi escape code sequences in a string
/* eslint-disable no-control-regex */
const ansi = /[\u001b\u009b][[()#;?]*(?:[0-9]{1,4}(?:;[0-9]{0,4})*)?[0-9A-ORZcf-nqry=><]/g;
/* eslint-enable no-control-regex */

/**
 * Tries to remove all VT control characters. Use to estimate displayed
 * string width. May be buggy due to not running a real state machine
 */
function stripVTControlCharacters(str) {
  return str.replace(ansi, '');
}

function getStringWidth(str) {
  if (Number.isInteger(str)) {
    return isFullWidthCodePoint(str) ? 2 : 1;
  }

  let width = 0;

  str = stripVTControlCharacters(String(str));

  for (let i = 0; i < str.length; i += 1) {
    const code = str.codePointAt(i);

    if (code >= kUTF16SurrogateThreshold) { // Surrogates.
      i += 1;
    }

    if (isFullWidthCodePoint(code)) {
      width += 2;
    } else {
      width += 1;
    }
  }

  return width;
}

module.exports = {
  isIdentifier,
  strEscape,
  getStringWidth,
};
