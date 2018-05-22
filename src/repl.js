'use strict';

const IO = require('./io');
const highlight = require('./highlight');
const util = require('util');

const inspect = (v) => util.inspect(v, { colors: true });

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
    return ['1', '2', '3', '4', `${buffer.length}`];
  }
}

module.exports = REPL;
