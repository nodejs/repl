'use strict';

const IO = require('./io');
const highlight = require('./highlight');
const { Runtime, mainContextIdPromise } = require('./inspector');
const { strEscape } = require('./util');
const util = require('util');

const simpleExpressionRE = /(?:[a-zA-Z_$](?:\w|\$)*\.)*[a-zA-Z_$](?:\w|\$)*[.[]?$/;
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

  eval(code) {
    const expression = wrapObjectLiteralExpressionIfNeeded(code);
    return Runtime.evaluate({
      expression,
      generatePreview: true,
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
    const evaluateResult = await this.eval(line);
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
    try {
      let filter;
      let keys;
      let computed = false;
      if (/\w|[.[]|\$/.test(buffer)) {
        let expr;
        const match = simpleExpressionRE.exec(buffer);
        if (buffer.length === 0) {
          filter = '';
          expr = '';
        } else if (buffer[buffer.length - 1] === '.') {
          filter = '';
          expr = match[0].slice(0, match[0].length - 1);
        } else if (buffer[buffer.length - 1] === '[') {
          filter = '';
          computed = true;
          expr = match[0].slice(0, match[0].length - 1);
        } else {
          const bits = match[0].split('.');
          filter = bits.pop();
          expr = bits.join('.');
        }

        if (expr === '') {
          keys = await collectGlobalNames();
        } else {
          // TODO: figure out throwOnSideEffect
          const k = (await Runtime.evaluate({
            expression: `Object.keys(Object.getOwnPropertyDescriptors(${expr}))`,
            // throwOnSideEffect: true,
            generatePreview: true,
          })).result.preview.properties;

          if (computed) {
            keys = k.map(({ value }) => `${strEscape(value)}]`);
          } else {
            keys = k
              .filter(({ value }) => !/[\x00-\x1f\x27\x5c ]/.test(value)) // eslint-disable-line no-control-regex
              .map(({ value }) => value);
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
