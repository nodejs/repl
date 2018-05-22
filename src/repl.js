'use strict';

const IO = require('./io');

class REPL {
  constructor(stdout, stdin) {
    this.io = new IO(
      stdout, stdin,
      this.onLine.bind(this),
      this.onAutocomplete.bind(this),
    );

    this.io.setPrefix('> ');
  }

  async onLine(line) {
    console.log('LINE!', line);
  }

  async onAutocomplete(buffer) {
    return [];
  }
}

module.exports = REPL;
