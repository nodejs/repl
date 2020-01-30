// Copyright Node.js contributors. All rights reserved.
//
// Permission is hereby granted, free of charge, to any person obtaining a copy
// of this software and associated documentation files (the "Software"), to
// deal in the Software without restriction, including without limitation the
// rights to use, copy, modify, merge, publish, distribute, sublicense, and/or
// sell copies of the Software, and to permit persons to whom the Software is
// furnished to do so, subject to the following conditions:
//
// The above copyright notice and this permission notice shall be included in
// all copies or substantial portions of the Software.
//
// THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
// IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
// FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
// AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
// LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING
// FROM, OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS
// IN THE SOFTWARE.
//
// https://github.com/nodejs/node/blob/master/lib/internal/util/inspect.js
// https://github.com/nodejs/node/blob/master/lib/util.js

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

/* eslint-disable no-control-regex */
const strEscapeSequencesRegExp = /[\x00-\x1f\x27\x5c]/;
const strEscapeSequencesReplacer = /[\x00-\x1f\x27\x5c]/g;

const ansi = /[\u001B\u009B][[\]()#;?]*(?:(?:(?:[a-zA-Z\d]*(?:;[-a-zA-Z\d/#&.:=?%@~_]*)*)?\u0007)|(?:(?:\d{1,4}(?:;\d{0,4})*)?[\dA-PR-TZcf-ntqry=><~]))/g;
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

const stripVTControlCharacters = (str) => str.replace(ansi, '');

const isFullWidthCodePoint = (code) =>
// Code points are partially derived from:
// http://www.unicode.org/Public/UNIDATA/EastAsianWidth.txt
  code >= 0x1100 && (
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
      // Miscellaneous Symbols and Pictographs 0x1f300 - 0x1f5ff
      // Emoticons 0x1f600 - 0x1f64f
      || (code >= 0x1f300 && code <= 0x1f64f)
      // CJK Unified Ideographs Extension B .. Tertiary Ideographic Plane
      || (code >= 0x20000 && code <= 0x3fffd)
  );

const isZeroWidthCodePoint = (code) =>
  code <= 0x1F // C0 control codes
      || (code > 0x7F && code <= 0x9F) // C1 control codes
      || (code >= 0x300 && code <= 0x36F) // Combining Diacritical Marks
      || (code >= 0x200B && code <= 0x200F) // Modifying Invisible Characters
      || (code >= 0xFE00 && code <= 0xFE0F) // Variation Selectors
      || (code >= 0xFE20 && code <= 0xFE2F) // Combining Half Marks
      || (code >= 0xE0100 && code <= 0xE01EF); // Variation Selectors

const getStringWidth = (str, removeControlChars = true) => {
  let width = 0;

  if (removeControlChars) {
    str = stripVTControlCharacters(str);
  }

  for (const char of str) {
    const code = char.codePointAt(0);
    if (isFullWidthCodePoint(code)) {
      width += 2;
    } else if (!isZeroWidthCodePoint(code)) {
      width += 1;
    }
  }

  return width;
};

const underlineIgnoreANSI = (str, needle) => {
  let start = -1;
  outer: // eslint-disable-line no-labels
  while (true) { // eslint-disable-line no-constant-condition
    start = str.indexOf(needle[0], start + 1);
    if (start === -1) {
      return str;
    }
    let strIndex = start;
    for (let i = 0; i < needle.length; i += 1) {
      if (needle[i] !== str[strIndex]) {
        // eslint-disable-next-line no-continue
        continue outer; // eslint-disable-line no-labels
      }
      strIndex += 1;
      if (str[strIndex] === '\u001b') {
        // assumes this ansi escape is a mode override (m)
        strIndex = str.indexOf('m', strIndex) + 1;
      }
    }
    const u = `\u001b[4m${str.slice(start, strIndex)}\u001b[24m`;
    return str.slice(0, start) + u + str.slice(strIndex);
  }
};

module.exports = {
  isIdentifier,
  strEscape,
  getStringWidth,
  underlineIgnoreANSI,
};
