'use strict';

const IO = require('./io');
const highlight = require('./highlight');
const { processTopLevelAwait } = require('./await');
const { Runtime, mainContextIdPromise } = require('./inspector');
const { strEscape } = require('./util');
const util = require('util');

const inspect = (v) => util.inspect(v, { colors: true, depth: 2 });

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
    keys.unshift(...await Runtime.globalLexicalScopeNames().names);
  } catch (e) {} // eslint-disable-line no-empty
  return keys;
}

class REPL {
  constructor(stdout, stdin) {
    this.io = new IO(
      stdout, stdin,
      this.onLine.bind(this),
      this.onAutocomplete.bind(this),
      (s) => highlight(s),
      `Node.js ${process.version} (V8 ${process.versions.v8})`,
    );

    this.io.setPrefix('> ');
  }

  async eval(code, awaitPromise = false, throwOnSideEffect = false) {
    const expression = wrapObjectLiteralExpressionIfNeeded(code);
    return Runtime.evaluate({
      expression,
      generatePreview: true,
      awaitPromise,
      throwOnSideEffect,
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
      if (/\['$/.test(buffer)) {
        ([expr, filter] = buffer.split(/\['/));
        computed = true;
      }

      if (/\.$/.test(buffer)) {
        ([expr, filter] = buffer.split(/\.$/));
        computed = false;
      }

      if (expr) {
        const evaluateResult = await this.eval(expr, false, true);
        if (evaluateResult.exceptionDetails) {
          return undefined;
        }

        const k = (await Runtime.getProperties({
          objectId: evaluateResult.result.objectId,
          ownProperties: true,
          generatePreview: true,
        })).result.map(({ name }) => name);

        if (computed) {
          keys = k.map((key) => `${strEscape(key)}]`);
        } else {
          keys = k.filter((key) => !/[\x00-\x1f\x27\x5c ]|^\d/.test(key)); // eslint-disable-line no-control-regex
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
