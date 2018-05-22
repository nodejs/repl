'use strict';

const IO = require('./io');
const highlight = require('./highlight');
const util = require('util');

const inspect = (v) => util.inspect(v, { colors: true });

const simpleExpressionRE =
    /(?:[a-zA-Z_$](?:\w|\$)*\.)*[a-zA-Z_$](?:\w|\$)*\.?$/;

class REPL {
  constructor(stdout, stdin) {
    this.io = new IO(
      stdout, stdin,
      this.onLine.bind(this),
      this.onAutocomplete.bind(this),
      (s) => highlight(s),
    );

    this.io.setPrefix('> ');

    global._ = undefined;
  }

  async onLine(line) {
    try {
      global._ = eval(line);
      return inspect(global._);
    } catch (err) {
      global._err = err;
      return inspect(err, {});
    }
  }

  async onAutocomplete(buffer) {
    try {
      if (!/\w|\.|\$/.test(buffer)) {
        return undefined;
      }

      let filter;
      let expr;
      const match = simpleExpressionRE.exec(buffer);
      if (buffer.length === 0) {
        filter = '';
        expr = '';
      } else if (buffer[buffer.length - 1] === '.') {
        filter = '';
        expr = match[0].slice(0, match[0].length - 1);
      } else {
        const bits = match[0].split('.');
        filter = bits.pop();
        expr = bits.join('.');
      }

      const o = eval(`try { ${expr} }catch (e) {}`);

      if (o) {
        const keys = Object.getOwnPropertyNames(o);
        if (filter) {
          return keys
            .filter((k) => k.startsWith(filter))
            .map((k) => k.slice(filter.length));
        }
        return keys;
      }
    } catch (err) {
      console.error('auticomplete error', err);
    }
    return undefined;
  }
}

module.exports = REPL;
