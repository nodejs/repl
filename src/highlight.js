'use strict';

const emphasize = require('emphasize');
const util = require('util');

function makeStyled([start, end]) {
  return (s) => `\x1b[${start}m${s}\x1b[${end}m`;
}

const sheet = {
  'comment': makeStyled(util.inspect.colors.grey),
  'quote': makeStyled(util.inspect.colors.grey),

  'keyword': makeStyled(util.inspect.colors.green),
  'addition': makeStyled(util.inspect.colors.green),

  'number': makeStyled(util.inspect.colors.yellow),
  'string': makeStyled(util.inspect.colors.green),
  'meta meta-string': makeStyled(util.inspect.colors.cyan),
  'literal': makeStyled(util.inspect.colors.cyan),
  'doctag': makeStyled(util.inspect.colors.cyan),
  'regexp': makeStyled(util.inspect.colors.cyan),

  'attribute': undefined,
  'attr': undefined,
  'variable': makeStyled(util.inspect.colors.yellow),
  'template-variable': makeStyled(util.inspect.colors.yellow),
  'class title': makeStyled(util.inspect.colors.yellow),
  'type': makeStyled(util.inspect.colors.yellow),

  'symbol': makeStyled(util.inspect.colors.magenta),
  'bullet': makeStyled(util.inspect.colors.magenta),
  'subst': makeStyled(util.inspect.colors.magenta),
  'meta': makeStyled(util.inspect.colors.magenta),
  'meta keyword': makeStyled(util.inspect.colors.magenta),
  'link': makeStyled(util.inspect.colors.magenta),

  'built_in': makeStyled(util.inspect.colors.cyan),
  'deletion': makeStyled(util.inspect.colors.red),

  'emphasis': makeStyled(util.inspect.colors.italic),
  'strong': makeStyled(util.inspect.colors.bold),
  'formula': makeStyled(util.inspect.colors.inverse),
};

module.exports = (s) =>
  emphasize.highlight('js', s, sheet).value;
