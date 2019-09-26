#!/usr/bin/env node

'use strict';

const Module = require('module');
const util = require('util');
const path = require('path');
const { parse_dammit: parseDammit } = require('acorn/dist/acorn_loose');
const IO = require('./io');
const highlight = require('./highlight');
const { processTopLevelAwait } = require('./await');
const { Runtime, mainContextIdPromise } = require('./inspector');
const { strEscape, isIdentifier } = require('./util');
const isRecoverableError = require('./recoverable');
const { completeCall } = require('./annotations');

util.inspect.defaultOptions.depth = 2;
if (process.platform !== 'win32') {
  util.inspect.styles.number = 'blue';
  util.inspect.styles.bigint = 'blue';
}

const builtinLibs = Module.builtinModules.filter((x) => !/^_|\//.test(x));

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

async function performEval(code, awaitPromise = false, bestEffort = false, objectGroup) {
  const expression = wrapObjectLiteralExpressionIfNeeded(code);
  return Runtime.evaluate({
    expression,
    objectGroup,
    generatePreview: true,
    awaitPromise,
    silent: bestEffort,
    throwOnSideEffect: bestEffort,
    timeout: bestEffort ? 500 : undefined,
    executionContextId: await mainContextIdPromise,
  });
}

async function callFunctionOn(func, remoteObject) {
  return Runtime.callFunctionOn({
    functionDeclaration: func.toString(),
    arguments: [remoteObject],
    executionContextId: await mainContextIdPromise,
  });
}

async function onLine(line) {
  let awaited = false;
  if (line.includes('await')) {
    const processed = processTopLevelAwait(line);
    if (processed !== null) {
      line = processed;
      awaited = true;
    }
  }

  const evaluateResult = await performEval(line, awaited);

  if (evaluateResult.exceptionDetails) {
    const expression = wrapObjectLiteralExpressionIfNeeded(line);
    if (isRecoverableError(expression)) {
      return IO.kNeedsAnotherLine;
    }

    await callFunctionOn(
      (err) => {
        global.REPL.lastError = err;
      },
      evaluateResult.exceptionDetails.exception,
    );

    return inspect(global.REPL.lastError);
  }

  await callFunctionOn(
    (result) => {
      global.REPL.last = result;
    },
    evaluateResult.result,
  );
  return inspect(global.REPL.last);
}

const errorToString = Error.prototype.toString;
const AUTOCOMPLETE_OBJECT_GROUP = 'AUTOCOMPLETE_OBJECT_GROUP';

async function oneLineEval(source) {
  const { result, exceptionDetails } = await performEval(
    wrapObjectLiteralExpressionIfNeeded(source),
    false,
    true,
    AUTOCOMPLETE_OBJECT_GROUP,
  );
  if (exceptionDetails) {
    return undefined;
  }

  if (result.objectId) {
    await Runtime.callFunctionOn({
      functionDeclaration: `${(v) => {
        global.REPL._inspectTarget = v;
      }}`,
      objectGroup: AUTOCOMPLETE_OBJECT_GROUP,
      arguments: [result],
      executionContextId: await mainContextIdPromise,
    });
    if (util.types.isNativeError(global.REPL._inspectTarget)) {
      return ` // ${errorToString.call(global.REPL._inspectTarget)}`;
    }
    const s = util.inspect(global.REPL._inspectTarget, {
      breakLength: Infinity,
      compact: true,
      maxArrayLength: 10,
      depth: 1,
    }).trim();

    Runtime.releaseObjectGroup({ objectGroup: AUTOCOMPLETE_OBJECT_GROUP });

    return ` // ${s}`;
  }

  Runtime.releaseObjectGroup({ objectGroup: AUTOCOMPLETE_OBJECT_GROUP });

  return ` // ${util.inspect(result.value)}`;
}

async function onAutocomplete(buffer) {
  if (buffer.length === 0) {
    return collectGlobalNames();
  }

  const statement = parseDammit(buffer).body[0];
  if (statement.type !== 'ExpressionStatement') {
    return undefined;
  }
  const { expression } = statement;

  let keys;
  let filter;
  if (expression.type === 'Identifier') {
    keys = await collectGlobalNames();
    filter = expression.name;

    if (keys.includes(filter)) {
      return undefined;
    }
  }

  if ((expression.type === 'CallExpression' || expression.type === 'NewExpression') && !buffer.trim().endsWith(')')) {
    const callee = buffer.slice(expression.callee.start, expression.callee.end);
    const { result, exceptionDetails } = await performEval(callee, false, true);
    if (!exceptionDetails) {
      await Runtime.callFunctionOn({
        functionDeclaration: `${(v) => {
          global.REPL._inspectTarget = v;
        }}`,
        arguments: [result],
        executionContextId: await mainContextIdPromise,
      });
      const fn = global.REPL._inspectTarget;
      const a = completeCall(fn, expression, buffer);
      if (a !== undefined) {
        return a;
      }
    }
  } else if (expression.type === 'MemberExpression') {
    const expr = buffer.slice(expression.object.start, expression.object.end);
    let leadingQuote = false;
    if (expression.computed && expression.property.type === 'Literal') {
      filter = expression.property.value;
      leadingQuote = expression.property.raw.startsWith('\'');
    } else if (!expression.computed && expression.property.type === 'Identifier') {
      filter = expression.property.name === '✖' ? undefined : expression.property.name;
    }

    let evaluateResult = await performEval(expr, false, true);
    if (evaluateResult.exceptionDetails) {
      return undefined;
    }

    if (evaluateResult.result.type !== 'object'
        && evaluateResult.result.type !== 'undefined'
        && evaluateResult.result.subtype !== 'null') {
      evaluateResult = await performEval(`Object(${wrapObjectLiteralExpressionIfNeeded(expr)})`, false, true);
      if (evaluateResult.exceptionDetails) {
        return undefined;
      }
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

    keys = [...own, ...inherited];

    if (keys.includes(filter)) {
      return undefined;
    }

    if (expression.computed) {
      keys = keys.map((key) => {
        let r;
        if (!leadingQuote && `${+key}` === key) {
          r = key;
        } else {
          r = strEscape(key);
          if (leadingQuote) {
            r = r.slice(1);
          }
        }
        return [`${r}]`];
      });
    } else {
      keys = keys.filter(isIdentifier);
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

builtinLibs.forEach((name) => {
  if (name === 'domain' || name === 'repl' || name === 'sys') {
    return;
  }
  global[name] = require(name);
});

try {
  // Hack for require.resolve("./relative") to work properly.
  module.filename = path.resolve('repl');
} catch (e) {
  // path.resolve('repl') fails when the current working directory has been
  // deleted.  Fall back to the directory name of the (absolute) executable
  // path.  It's not really correct but what are the alternatives?
  const dirname = path.dirname(process.execPath);
  module.filename = path.resolve(dirname, 'repl');
}

// Hack for repl require to work properly with node_modules folders
module.paths = Module._nodeModulePaths(module.filename);

const parentModule = module;

{
  const module = new Module('<repl>');
  module.paths = Module._resolveLookupPaths('<repl>', parentModule, true) || [];
  module._compile('module.exports = require;', '<repl>');

  Object.defineProperty(global, 'module', {
    configurable: true,
    writable: true,
    value: module,
  });

  Object.defineProperty(global, 'require', {
    configurable: true,
    writable: true,
    value: module.exports,
  });
}

global.REPL = {
  time: (fn) => {
    const { Suite } = require('benchmark');
    let r;
    new Suite().add(fn.name, fn)
      .on('cycle', (event) => {
        r = event.target;
        r[util.inspect.custom] = () => String(r);
      })
      .run();
    return r;
  },
  last: undefined,
  lastError: undefined,
};

Object.defineProperties(global, {
  _: {
    enumerable: false,
    configurable: true,
    get: () => global.REPL.last,
    set: (v) => {
      delete global._;
      global._ = v;
    },
  },
  _err: {
    enumerable: false,
    configurable: true,
    get: () => global.REPL.lastError,
    set: (v) => {
      delete global._err;
      global._err = v;
    },
  },
});

const engines = [
  'V8',
  'ChakraCore',
];

let engine = engines.find((e) => process.versions[e.toLowerCase()] !== undefined);
if (engine !== undefined) {
  engine = `(${engine} ${process.versions[engine.toLowerCase()]})`;
}

const io = new IO(
  process.stdout, process.stdin,
  {
    onLine,
    onAutocomplete,
    eagerEval: (source) => {
      try {
        return oneLineEval(source);
      } catch {
        return undefined;
      }
    },
    transformBuffer: (s) => highlight(s),
    heading: `Node.js ${process.version} ${engine || '(Unknown Engine)'}
Prototype REPL - https://github.com/nodejs/repl`,
  },
);

io.setPrefix('> ');

process.setUncaughtExceptionCaptureCallback((e) => {
  process.stdout.write(`${inspect(e)}\n> `);
});
