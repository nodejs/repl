'use strict';

const IO = require('./io');
const highlight = require('./highlight');

class REPL {
  constructor(stdout, stdin) {
    this.io = new IO(
      stdout, stdin,
      this.onLine.bind(this),
      this.onAutocomplete.bind(this),
      (s) => highlight(s),
    );

    this.io.setPrefix('> ');
  }

  async onLine(line) {
    return `${eval(line)}`;
  }

  async onAutocomplete(buffer) {
    return ['1', '2', '3', '4', `${buffer.length}`];
  }
}

module.exports = REPL;
