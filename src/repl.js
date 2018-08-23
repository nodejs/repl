'use strict';

const util = require('util');
const IO = require('./io');
const highlight = require('./highlight');
const { processTopLevelAwait } = require('./await');
const { Runtime, mainContextIdPromise } = require('./inspector');
const { strEscape, isIdentifier } = require('./util');
const isRecoverableError = require('./recoverable');

// TODO(devsnek): make more robust
Error.prepareStackTrace = (err, frames) => {
  const cut = frames.findIndex((f) =>
    !f.getFileName() && !f.getFunctionName()) + 1;

  frames = frames.slice(0, cut);

  if (frames.length === 0) {
    return `${err}`;
  }

  return `${err}\n    at ${frames.join('\n    at ')}`;
};

const inspect = (v) => util.inspect(v, { colors: true, showProxy: 2 });

// https://cs.chromium.org/chromium/src/third_party/blink/renderer/devtools/front_end/sdk/RuntimeModel.js?l=60-78&rcl=faa083eea5586885cc907ae28928dd766e47b6fa
function wrapObjectLiteralExpressionIfNeeded(code) {
  // Only parenthesize what appears to be an object literal.
  if (!(/^\s*\{/.test(code) && /\}\s*$/.test(code))) {
    return code;
  }

  const parse = (async () => 0).constructor;
  try {
    // Check if the code can be interpreted as an expression.
    parse(`return ${code};`);

    // No syntax error! Does it work parenthesized?
    const wrappedCode = `(${code})`;
    parse(wrappedCode);

    return wrappedCode;
  } catch (e) {
    return code;
  }
}

async function collectGlobalNames() {
  const keys = Object.getOwnPropertyNames(global);
  try {
    keys.unshift(...(await Runtime.globalLexicalScopeNames()).names);
  } catch (e) {} // eslint-disable-line no-empty
  return keys;
}

const engines = [
  'V8',
  'ChakraCore',
];

let engine = engines.find((e) => process.versions[e.toLowerCase()] !== undefined);
if (engine !== undefined) {
  engine = `(${engine} ${process.versions[engine.toLowerCase()]})`;
}

class REPL {
  constructor(stdout, stdin) {
    this.io = new IO(
      stdout, stdin,
      this.onLine.bind(this),
      this.onAutocomplete.bind(this),
      (s) => highlight(s),
      `Node.js ${process.version} ${engine || '(Unknown Engine)'}
Prototype REPL - https://github.com/nodejs/repl`,
    );

    this.io.setPrefix('> ');
  }

  async eval(code, awaitPromise = false, bestEffort = false) {
    const expression = wrapObjectLiteralExpressionIfNeeded(code);
    return Runtime.evaluate({
      expression,
      generatePreview: true,
      awaitPromise,
      silent: bestEffort,
      throwOnSideEffect: bestEffort,
      timeout: bestEffort ? 500 : undefined,
      executionContextId: await mainContextIdPromise,
    });
  }

  async callFunctionOn(func, remoteObject) {
    return Runtime.callFunctionOn({
      functionDeclaration: func.toString(),
      arguments: [remoteObject],
      executionContextId: await mainContextIdPromise,
    });
  }

  async onLine(line) {
    let awaited = false;
    if (line.includes('await')) {
      const processed = processTopLevelAwait(line);
      if (processed !== null) {
        line = processed;
        awaited = true;
      }
    }

    const evaluateResult = await this.eval(line, awaited);

    if (evaluateResult.exceptionDetails) {
      const expression = wrapObjectLiteralExpressionIfNeeded(line);
      if (isRecoverableError(expression)) {
        return IO.kNeedsAnotherLine;
      }

      await this.callFunctionOn(
        (err) => {
          global.REPL.lastError = err;
        },
        evaluateResult.exceptionDetails.exception,
      );

      return inspect(global.REPL.lastError);
    }

    await this.callFunctionOn(
      (result) => {
        global.REPL.last = result;
      },
      evaluateResult.result,
    );
    return inspect(global.REPL.last);
  }

  async onAutocomplete(buffer) {
    let keys;
    let filter;
    if (buffer.length === 0) {
      keys = await collectGlobalNames();
    } else {
      let expr;
      let computed = false;
      let leadingQuote = false;

      let index = buffer.lastIndexOf('.');
      if (index !== -1) {
        expr = buffer.slice(0, index);
        filter = buffer.slice(index + 1, buffer.length);
      }

      if (!expr) {
        index = buffer.lastIndexOf('[\'');
        if (index !== -1) {
          expr = buffer.slice(0, index);
          filter = buffer.slice(index + 2, buffer.length);
          computed = true;
          leadingQuote = true;
        }
      }

      if (!expr) {
        index = buffer.lastIndexOf('[');
        if (index !== -1) {
          expr = buffer.slice(0, index);
          filter = buffer.slice(index + 1, buffer.length);
          computed = true;
        }
      }

      if (expr) {
        const evaluateResult = await this.eval(expr, false, true);
        if (evaluateResult.exceptionDetails) {
          return undefined;
        }

        const own = [];
        const inherited = [];

        (await Runtime.getProperties({
          objectId: evaluateResult.result.objectId,
          generatePreview: true,
        }))
          .result
          .filter(({ symbol }) => !symbol)
          .forEach(({ isOwn, name }) => {
            if (isOwn) {
              own.push(name);
            } else {
              inherited.push(name);
            }
          });
        const k = [...own, ...inherited];

        if (computed) {
          keys = k.map((key) => {
            let r;
            if (!leadingQuote && `${+key}` === key) {
              r = `${key}]`;
            } else {
              r = `${strEscape(key)}]`;
            }
            if (leadingQuote) {
              return r.slice(1);
            }
            return r;
          });
        } else {
          keys = k.filter(isIdentifier);
        }
      }
    }

    if (keys) {
      if (filter) {
        return keys
          .filter((k) => k.startsWith(filter))
          .map((k) => k.slice(filter.length));
      }
      return keys;
    }
    return undefined;
  }
}

module.exports = REPL;
