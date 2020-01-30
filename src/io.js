'use strict';

const { emitKeys } = require('./tty');
const loadHistory = require('./history');
const { getStringWidth } = require('./util');

/* eslint-disable no-await-in-loop */

const MODE_NORMAL = 0;
const MODE_REVERSE_I_SEARCH = 1;

class IO {
  constructor(stdout, stdin, {
    onLine, onAutocomplete, eagerEval,
    transformBuffer, heading,
  } = {}) {
    this.stdin = stdin;
    this.stdout = stdout;

    this.mode = MODE_NORMAL;

    this._buffer = '';
    this._cursor = 0;
    this._prefix = '';
    this._suffix = '';
    this._suffixOnNewLine = false;
    this.multilineBuffer = '';

    this._paused = false;
    this.transformBuffer = transformBuffer;
    this.completionList = undefined;
    this.partialCompletionIndex = -1;

    this.onAutocomplete = onAutocomplete;
    this.eagerEval = eagerEval;

    this.history = [];
    this.historyIndex = -1;

    let closeOnThisOne = false;

    stdin.cork();
    this.clear();
    if (heading) {
      stdout.write(`${heading}\n`);
    }

    const decoder = emitKeys(async (s, key) => {
      if (key.name !== 'c' || !key.ctrl) {
        closeOnThisOne = false;
      }

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
            if (this.mode === MODE_NORMAL) {
              this.stdout.cursorTo(0, 0);
              this.stdout.clearScreenDown();
              await this.flip();
            }
            break;
          case 'n':
            if (this.mode === MODE_NORMAL) {
              await this.nextHistory();
            }
            break;
          case 'p':
            if (this.mode === MODE_NORMAL) {
              await this.previousHistory();
            }
            break;
          case 'c':
            if (this.mode === MODE_REVERSE_I_SEARCH) {
              this.mode = MODE_NORMAL;
              await this.update('', 0);
              break;
            }
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
          case 'w':
            if (this.cursor > 0) {
              const leading = this.buffer.slice(0, this.cursor);
              const match = leading.match(/(?:[^\w\s]+|\w+|)\s*$/);
              const b = this.buffer.slice(0, this.buffer.length - match[0].length);
              await this.update(b, b.length);
            }
            break;
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
          case 'r':
            if (this.mode === MODE_NORMAL) {
              this.mode = MODE_REVERSE_I_SEARCH;
              this.stdout.write('\n');
              await this.update('', 0);
            }
            break;
          default:
            break;
        }
        return undefined;
      }

      switch (key.name) {
        case 'up':
          if (this.mode === MODE_NORMAL) {
            await this.previousHistory();
          }
          break;
        case 'down':
          if (this.mode === MODE_NORMAL) {
            await this.nextHistory();
          }
          break;
        case 'left':
          await this.moveCursor(-1);
          break;
        case 'right':
          if (this.cursor === this.buffer.length && this.mode === MODE_NORMAL) {
            if (this._suffix && Array.isArray(this.completionList)) {
              this.completionList = undefined;
              await this.update(this.buffer + this._suffix, this.cursor + this._suffix.length);
            }
            break;
          }
          await this.moveCursor(1);
          break;
        case 'home':
          await this.moveCursor(-this.buffer.length);
          break;
        case 'end':
          await this.moveCursor(this.buffer.length);
          break;
        case 'delete': {
          if (this.cursor === this.buffer.length) {
            break;
          }
          const b = this.buffer.slice(0, this.cursor)
            + this.buffer.slice(this.cursor + 1, this.buffer.length);
          await this.update(b, this.cursor);
          break;
        }
        case 'backspace': {
          if (this.cursor === 0) {
            break;
          }
          const b = this.buffer.slice(0, this.cursor - 1)
            + this.buffer.slice(this.cursor, this.buffer.length);
          await this.update(b, this.cursor - 1);
          break;
        }
        case 'tab':
          if (this.mode === MODE_NORMAL) {
            await this.fullAutocomplete();
          }
          break;
        default:
          if (this.mode === MODE_REVERSE_I_SEARCH && key.name === 'return') {
            this.mode = MODE_NORMAL;
            const match = this.history.find((h) => h.includes(this.buffer));
            this.stdout.moveCursor(0, -1);
            this.stdout.cursorTo(0);
            this.stdout.clearScreenDown();
            await this.update(match || '', match ? match.length : 0);
            break;
          }

          if (s) {
            this.historyIndex = -1;
            const lines = s.split(/\r\n|\n|\r/);
            for (let i = 0; i < lines.length; i += 1) {
              if (i > 0) {
                if (this.buffer) {
                  let unpaused = false;
                  if (this.paused) {
                    this.unpause();
                    unpaused = true;
                  }
                  this.setSuffix('');
                  await this.flip();
                  if (unpaused) {
                    this.pause();
                  }
                  this.stdout.write('\n');
                  const result = await onLine(this.multilineBuffer + this.buffer);
                  if (result === IO.kNeedsAnotherLine) {
                    this.multilineBuffer += `${this.buffer}\n`;
                    await this.setPrefix('... ');
                  } else {
                    this.stdout.write(`${result}\n`);
                    await this.setPrefix('> ');
                    this.history.unshift((this.multilineBuffer + this.buffer).replace(/\n/g, ' '));
                    this.multilineBuffer = '';
                    await this.writeHistory();
                  }
                  await this.update('', 0);
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
        const maybePaste = chunk.length > 1;
        if (maybePaste) {
          this.pause();
        }
        for (let i = 0; i < chunk.length; i += 1) {
          const { value } = await decoder.next(chunk[i]);
          if (value === -1) {
            process.exit(0);
          }
        }
        if (maybePaste) {
          this.unpause();
          await this.flip();
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
    this.setSuffix('');
    this.completionList = undefined;
    this.partialCompletionIndex = 0;
    if (this.mode === MODE_NORMAL) {
      await this.partialAutocomplete();
    }
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

  async updateCompletions() {
    if (this.completionList) {
      return true;
    }
    try {
      const c = await this.onAutocomplete(this.multilineBuffer + this.buffer);
      if (c) {
        this.completionList = c;
        return true;
      }
    } catch {
      // nothing
    }
    return false;
  }

  async partialAutocomplete() {
    if (!this.onAutocomplete || !this.buffer || !await this.updateCompletions()) {
      return;
    }
    if (this.partialCompletionIndex >= this.completionList.length) {
      this.partialCompletionIndex = 0;
      this.completionList = undefined;
      this.setSuffix('');
    } else {
      const next = this.completionList[this.partialCompletionIndex];
      this.partialCompletionIndex += 1;
      this.setSuffix(next);
    }
  }

  async fullAutocomplete() {
    if (!this.onAutocomplete || !this.buffer || !await this.updateCompletions()) {
      return;
    }
    if (this.completionList.length === 1) {
      await this.update(
        this.buffer + this.completionList[0],
        this.cursor + this.completionList[0].length,
      );
      this.completionList = undefined;
    } else if (this.completionList.length > 1) {
      const completionsWidth = [];
      const completions = this.completionList.map((completion) => {
        const s = this.buffer + completion;
        completionsWidth.push(getStringWidth(s));
        return s;
      });
      const width = Math.max(...completionsWidth) + 2;
      let maxColumns = Math.floor(this.stdout.columns / width) || 1;
      if (maxColumns === Infinity) {
        maxColumns = 1;
      }
      let output = '\n';
      let lineIndex = 0;
      let whitespace = 0;
      completions.forEach((completion, i) => {
        if (lineIndex === maxColumns) {
          output += '\n';
          lineIndex = 0;
          whitespace = 0;
        } else {
          output += ' '.repeat(whitespace);
        }
        output += completion;
        whitespace = width - completionsWidth[i];
        lineIndex += 1;
      });
      if (lineIndex !== 0) {
        output += '\n\n';
      }
      this.stdout.write(output);
      this.completionList = undefined;
      await this.flip();
    }
  }

  async setPrefix(s = '') {
    this._prefix = s;
    await this.flip();
  }

  setSuffix(s = '', suffixOnNewLine = false) {
    this._suffix = s;
    this._suffixOnNewLine = suffixOnNewLine;
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
    this.stdout.cursorTo(0);
    this.stdout.clearScreenDown();
  }

  async flip() {
    if (this.paused) {
      return;
    }

    if (this.mode === MODE_REVERSE_I_SEARCH) {
      this.stdout.moveCursor(0, -1);
      this.stdout.cursorTo(0);
      this.stdout.clearScreenDown();
      let match;
      if (this.buffer) {
        match = this.history.find((h) => h.includes(this.buffer));
      }
      if (match) {
        if (this.transformBuffer) {
          match = await this.transformBuffer(match);
        }
        match = match.replace(this.buffer, `\u001b[4m${this.buffer}\u001b[24m`);
      }
      this.stdout.write(`${this._prefix}${match || ''}\nreverse-i-search: ${this.buffer}`);
      return;
    }

    this.clear();

    const b = this.transformBuffer ? await this.transformBuffer(this.buffer) : this.buffer;

    if (!this._suffix && this.buffer && this.eagerEval) {
      const r = await this.eagerEval(this.multilineBuffer + this.buffer);
      if (r) {
        this.setSuffix(r, true);
      }
    }

    this.stdout.write(`${this._prefix}${b}`);

    if (this._suffix) {
      const s = `\u001b[90m${this._suffix.slice(0, this.stdout.columns)}\u001b[39m`;
      if (this._suffixOnNewLine) {
        this.stdout.write(`\n${s}`);
        this.stdout.moveCursor(0, -1);
      } else {
        this.stdout.write(s);
      }
    }

    this.stdout.cursorTo(this.cursor + this._prefix.length);
  }
}

// Symbol to notify that IO needs an another line
IO.kNeedsAnotherLine = Symbol('IO.kNeedsAnotherLine');

module.exports = IO;
