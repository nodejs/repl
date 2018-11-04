'use strict';

const { emitKeys, CSI, cursorTo } = require('./tty');
const loadHistory = require('./history');

/* eslint-disable no-await-in-loop */

class IO {
  constructor(stdout, stdin, onLine, onAutocomplete, transformBuffer, heading) {
    this.stdin = stdin;
    this.stdout = stdout;

    this._buffer = '';
    this._cursor = 0;
    this._prefix = '';
    this._suffix = '';
    this.multilineBuffer = '';

    this._paused = false;
    this.transformBuffer = transformBuffer;
    this.completionList = undefined;

    this.onAutocomplete = onAutocomplete;

    this.history = [];
    this.historyIndex = -1;

    let closeOnThisOne = false;

    stdin.cork();
    this.clear();
    stdout.write(`${heading}\n`);

    const decoder = emitKeys(async (s, key) => {
      if (key.ctrl) {
        switch (key.name) {
          case 'h':
            break;
          case 'u':
            await this.update(this.buffer.slice(this.cursor, this.buffer.length), 0);
            break;
          case 'k': {
            const b = this.buffer.slice(0, this.cursor);
            await this.update(b, b.length);
            break;
          }
          case 'a':
            await this.moveCursor(-Infinity);
            break;
          case 'e':
            await this.moveCursor(Infinity);
            break;
          case 'b':
            await this.moveCursor(-1);
            break;
          case 'f':
            await this.moveCursor(1);
            break;
          case 'l':
            cursorTo(stdout, 0, 0);
            stdout.write(CSI.kClearScreenDown);
            await this.flip();
            break;
          case 'n':
            await this.nextHistory();
            break;
          case 'p':
            await this.previousHistory();
            break;
          case 'c':
            if (closeOnThisOne) {
              return -1;
            }
            this.stdout.write('\n(To exit, press ^C again or call exit)\n');
            await this.update('', 0);
            closeOnThisOne = true;
            break;
          case 'z':
          case 'd':
            return -1;
          case 'left':
            if (this.cursor > 0) {
              const leading = this.buffer.slice(0, this.cursor);
              const match = leading.match(/(?:[^\w\s]+|\w+|)\s*$/);
              await this.moveCursor(-match[0].length);
            }
            break;
          case 'right':
            if (this.cursor < this.buffer.length) {
              const trailing = this.buffer.slice(this.cursor);
              const match = trailing.match(/^(?:\s+|\W+|\w+)\s*/);
              await this.moveCursor(match[0].length);
            }
            break;
          default:
            break;
        }
        return undefined;
      }

      switch (key.name) {
        case 'up':
          await this.previousHistory();
          break;
        case 'down':
          await this.nextHistory();
          break;
        case 'left':
          await this.moveCursor(-1);
          break;
        case 'right':
          if (this.cursor === this.buffer.length) {
            if (this._suffix && typeof this.completionList !== 'string') {
              this.completionList = undefined;
              await this.update(this.buffer + this._suffix, this.cursor + this._suffix.length);
            }
            break;
          }
          await this.moveCursor(1);
          break;
        case 'delete':
        case 'backspace': {
          if (this.cursor === 0) {
            break;
          }
          const b = this.buffer.slice(0, this.cursor - 1) +
            this.buffer.slice(this.cursor, this.buffer.length);
          await this.update(b, this.cursor - 1);
          break;
        }
        case 'tab': {
          await this.autocomplete();
          break;
        }
        default:
          if (s) {
            this.historyIndex = -1;
            const lines = s.split(/\r\n|\n|\r/);
            for (let i = 0; i < lines.length; i += 1) {
              if (i > 0) {
                if (this.buffer) {
                  this.pause();
                  this.stdout.write('\n');
                  const b = this.buffer;
                  await this.update('', 0);
                  this.history.unshift(b);
                  await this.writeHistory();
                  const result = await onLine(this.multilineBuffer + b);
                  if (result === IO.kNeedsAnotherLine) {
                    this.multilineBuffer += b;
                    await this.setPrefix('... ');
                  } else {
                    this.multilineBuffer = '';
                    this.stdout.write(`${result}\n`);
                    await this.setPrefix('> ');
                  }
                  this.unpause();
                } else {
                  this.stdout.write('\n');
                }
              }
              await this.appendToBuffer(lines[i]);
            }
          }
          break;
      }
      return undefined;
    });

    decoder.next('');

    stdin.setEncoding('utf8');
    stdout.setEncoding('utf8');

    if (stdin.setRawMode) {
      stdin.setRawMode(true);
    }

    this.unpause();

    (async () => {
      const { history, writeHistory } = await loadHistory();
      this.history = history;
      this.writeHistory = () => writeHistory(this.history);
      for await (const chunk of stdin) {
        for (let i = 0; i < chunk.length; i += 1) {
          const { value } = await decoder.next(chunk[i]);
          if (value === -1) {
            process.exit(0);
          }
        }
      }
    })().catch((e) => {
      console.error(e); // eslint-disable-line no-console
      process.exit(1);
    });
  }

  get buffer() {
    return this._buffer;
  }

  get cursor() {
    return this._cursor;
  }

  get paused() {
    return this._paused;
  }

  pause() {
    this._paused = true;
    this.stdin.cork();
  }

  unpause() {
    this.stdin.uncork();
    this._paused = false;
  }

  async update(buffer, cursor) {
    this._buffer = buffer;
    this._cursor = cursor;
    this._suffix = '';
    this.completionList = undefined;
    await this.autocomplete();
    await this.flip();
  }

  async nextHistory() {
    if (this.historyIndex < 0) {
      await this.update('', 0);
      return;
    }
    this.historyIndex -= 1;
    const h = this.history[this.historyIndex] || '';
    await this.update(h, h.length);
  }

  async previousHistory() {
    if (this.historyIndex >= this.history.length - 1) {
      return;
    }

    this.historyIndex += 1;
    const h = this.history[this.historyIndex];
    await this.update(h, h.length);
  }

  async autocomplete() {
    if (!this.onAutocomplete || !this.buffer) {
      return;
    }
    if (typeof this.completionList === 'string') {
      this.setSuffix(this.completionList);
    } else if (this.completionList && this.completionList.length) {
      const next = this.completionList.shift();
      this.setSuffix(next);
    } else if (this.completionList) {
      this.completionList = undefined;
      this.setSuffix();
    } else {
      try {
        const c = await this.onAutocomplete(this.buffer);
        if (c) {
          this.completionList = c;
          await this.autocomplete();
        }
      } catch {} // eslint-disable-line no-empty
      return;
    }
    await this.flip();
  }

  async setPrefix(s = '') {
    this._prefix = s;
    await this.flip();
  }

  setSuffix(s = '') {
    this._suffix = s;
  }

  async appendToBuffer(s) {
    let b = this.buffer;
    if (this.cursor < this.buffer.length) {
      const beg = this.buffer.slice(0, this.cursor);
      const end = this.buffer.slice(this.cursor, this.buffer.length);
      b = beg + s + end;
    } else {
      b += s;
    }

    await this.update(b, this.cursor + s.length);
  }

  async moveCursor(n) {
    const c = this.cursor + n;
    if (c < 0) {
      this._cursor = 0;
    } else if (c > this.buffer.length) {
      this._cursor = this.buffer.length;
    } else {
      this._cursor = c;
    }
    await this.flip();
  }

  clear() {
    cursorTo(this.stdout, 0);
    this.stdout.write(CSI.kClearScreenDown);
  }

  async flip() {
    if (this.paused) {
      return;
    }

    this.clear();

    const b = this.transformBuffer ? await this.transformBuffer(this.buffer) : this.buffer;

    const s = `${this._prefix}${b}\u001b[90m${this._suffix}\u001b[39m`;

    this.stdout.write(s.length < this.stdout.columns ?
      s : `${s.slice(0, this.stdout.columns - 3)}...\u001b[39m`);

    cursorTo(this.stdout, this.cursor + this._prefix.length);
  }
}

// Symbol to notify that IO needs an another line
IO.kNeedsAnotherLine = Symbol('IO.kNeedsAnotherLine');

module.exports = IO;
