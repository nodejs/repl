'use strict';

const emphasize = require('emphasize/lib/core');
const js = require('highlight.js/lib/languages/javascript');

emphasize.registerLanguage('javascript', js);

module.exports = (s) =>
  emphasize.highlight('js', s).value;
