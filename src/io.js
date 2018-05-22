'use strict';

const { emitKeys, CSI, cursorTo } = require('./tty');

/* eslint-disable no-await-in-loop */

class IO {
  constructor(stdout, stdin, onLine, onAutocomplete, transformBuffer) {
    this.stdin = stdin;
    this.stdout = stdout;

    this.buffer = '';
    this.cursor = 0;
    this.prefix = '';
    this.suffix = '';

    this.paused = false;
    this.transformBuffer = transformBuffer;

    let completionList;
    let closeOnThisOne = false;

    const decoder = emitKeys(async (s, key) => {
      if (key.ctrl || key.meta) {
        if (key.name === 'c' || key.name === 'd') {
          if (closeOnThisOne) {
            return -1;
          }
          this.stdout.write(`\n(To exit, press ^${key.name.toUpperCase()} again or call exit)\n`);
          this.buffer = '';
          this.cursor = 0;
          closeOnThisOne = true;
          return undefined;
        }
      }

      closeOnThisOne = false;

      switch (key.name) {
        case 'left':
          await this.moveCursor(-1);
          break;
        case 'right':
          if (this.cursor === this.buffer.length) {
            if (this.suffix) {
              this.buffer += this.suffix;
              this.cursor += this.suffix.length;
              this.refresh();
            }
            break;
          }
          await this.moveCursor(1);
          break;
        case 'delete':
        case 'backspace':
          if (this.cursor === 0) {
            break;
          }
          this.buffer = this.buffer.slice(0, this.cursor - 1) +
            this.buffer.slice(this.cursor, this.buffer.length);
          await this.moveCursor(-1);
          break;
        case 'tab': {
          if (completionList && completionList.length) {
            const next = completionList.shift();
            await this.addSuffix(next);
          } else if (completionList) {
            completionList = undefined;
            this.refresh();
          } else {
            const c = await onAutocomplete(this.buffer);
            if (c) {
              completionList = c;
            }
          }
          break;
        }
        default:
          completionList = undefined;
          if (s) {
            const lines = s.split(/\r\n|\n|\r/);
            for (let i = 0; i < lines.length; i += 1) {
              if (i > 0) {
                this.paused = true;
                this.stdout.write('\n');
                const b = this.buffer;
                this.buffer = '';
                this.cursor = 0;
                this.stdout.write(`${await onLine(b)}\n`);
                this.paused = false;
                await this.refresh();
              }
              await this.appendToBuffer(lines[i]);
            }
          }
          break;
      }
      return undefined;
    });

    decoder.next('');

    stdout.setEncoding('utf8');

    (async () => {
      stdin.setRawMode(true);
      stdin.setEncoding('utf8');
      const handle = async (data) => {
        for (let i = 0; i < data.length; i += 1) {
          const { value } = await decoder.next(data[i]);
          if (value === -1) {
            process.exit(0);
          }
        }
        stdin.once('data', handle);
      };
      stdin.once('data', handle);
    })();
  }

  async setPrefix(s) {
    if (!s) {
      this.prefix = '';
    }
    this.prefix = s;
    await this.refresh();
  }

  async addSuffix(s = '') {
    if (this.paused || this.cursor !== this.buffer.length) {
      return;
    }
    this.suffix = `${s}`;
    this.stdout.write(CSI.kClearScreenDown);
    this.stdout.write(this.suffix);
    cursorTo(this.stdout, this.cursor + this.prefix.length);
  }

  async appendToBuffer(s) {
    if (this.cursor < this.buffer.length) {
      const beg = this.buffer.slice(0, this.cursor);
      const end = this.buffer.slice(this.cursor, this.buffer.length);
      this.buffer = beg + s + end;
    } else {
      this.buffer += s;
    }

    this.cursor += s.length;
    await this.refresh();
  }

  async moveCursor(n) {
    if ((this.cursor + n < 0) || (this.cursor + n > this.buffer.length)) {
      return;
    }
    this.cursor += n;
    await this.refresh();
  }

  async refresh() {
    if (this.paused) {
      return;
    }
    this.suffix = '';
    cursorTo(this.stdout, 0);
    this.stdout.write(CSI.kClearScreenDown);
    const b = this.transformBuffer ? await this.transformBuffer(this.buffer) : this.buffer;
    this.stdout.write(this.prefix + b);
    cursorTo(this.stdout, this.cursor + this.prefix.length);
  }
}

module.exports = IO;
