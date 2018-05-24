'use strict';

const IO = require('./io');
const highlight = require('./highlight');
const util = require('util');
const vm = require('vm');
const sendInspectorCommand = require('./inspector');

const inspect = (v) => util.inspect(v, { colors: true, depth: 2 });

const simpleExpressionRE = /(?:[a-zA-Z_$](?:\w|\$)*\.)*[a-zA-Z_$](?:\w|\$)*\.?$/;

const evil = (code) =>
  new vm.Script(code, {
    filename: 'repl',
  }).runInThisContext({
    displayErrors: true,
    breakOnSigint: true,
  });

const getGlobalLexicalScopeNames = (contextId) =>
  sendInspectorCommand((session) => {
    let names = [];
    session.post('Runtime.globalLexicalScopeNames', {
      executionContextId: contextId,
    }, (error, result) => {
      if (!error) {
        ({ names } = result);
      }
    });
    return names;
  });

const collectGlobalNames = async () => {
  const keys = Object.getOwnPropertyNames(global);
  try {
    keys.unshift(...await getGlobalLexicalScopeNames());
  } catch (e) {} // eslint-disable-line no-empty
  return keys;
};

let _;
let _err;
Object.defineProperties(global, {
  _: {
    enumerable: false,
    configurable: true,
    get: () => _,
    set: (v) => {
      delete global._;
      global._ = v;
    },
  },
  _err: {
    enumerable: false,
    configurable: true,
    get: () => _err,
    set: (v) => {
      delete global._err;
      global._err = v;
    },
  },
});

class REPL {
  constructor(stdout, stdin) {
    this.io = new IO(
      stdout, stdin,
      this.onLine.bind(this),
      this.onAutocomplete.bind(this),
      (s) => highlight(s),
    );

    stdout.write(`Node.js ${process.version} (V8 ${process.versions.v8})\n`);

    this.io.setPrefix('> ');
  }

  eval(code) {
    const wrap = /^\s*\{.*?\}\s*$/.test(code);
    try {
      return evil(wrap ? `(${code})` : code);
    } catch (err) {
      if (wrap && err instanceof SyntaxError) {
        return evil(code);
      }
      throw err;
    }
  }

  async onLine(line) {
    try {
      _ = this.eval(line);
      return inspect(_);
    } catch (err) {
      _err = err;
      return inspect(err, {});
    }
  }

  async onAutocomplete(buffer) {
    try {
      let filter;
      let keys;
      if (/\w|\.|\$/.test(buffer)) {
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

        if (expr === '') {
          keys = await collectGlobalNames();
        } else {
          const o = this.eval(`try { ${expr} } catch (e) {}`);

          if (o) {
            keys = Object.getOwnPropertyNames(o);
          }
        }
      } else if (buffer.length === 0) {
        keys = await collectGlobalNames();
      }

      if (keys) {
        if (filter) {
          return keys
            .filter((k) => k.startsWith(filter))
            .map((k) => k.slice(filter.length));
        }
        return keys;
      }
    } catch (e) {} // eslint-disable-line no-empty
    return undefined;
  }
}

module.exports = REPL;
