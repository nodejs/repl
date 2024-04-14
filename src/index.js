#!/usr/bin/env node

'use strict';

const { createInterface, clearScreenDown } = require('readline');
const acorn = require('acorn-loose');
const { Session } = require('./inspector');
const { isIdentifier, strEscape, underlineIgnoreANSI } = require('./util');
const highlight = require('./highlight');
const getHistory = require('./history');
const util = require('util');

require('./stub.js')

function stripAnsi(text) {
  const ansiEscape = /\x1B(?:[@-Z\\-_]|\[[0-?]*[ -/]*[@-~])/g;
  return text.replace(ansiEscape, '');
}

function makePrompt(i) {
  return util.styleText('green', `In [${util.styleText('bold', '' + i)}]: `);
}

function makePromptOut(inspected, i) {
  if (/[\r\n\u2028\u2029]/u.test(inspected)) {
    return '';
  }
  return util.styleText('red', `Out[${util.styleText('bold', '' + i)}]: `);
}

function promptLength(i) {
  return `In [${i}]: `.length;
}

async function start() {
  const session = await Session.create();

  const { context } = await new Promise((resolve) => {
    session.once('Runtime.executionContextCreated', resolve);
    session.post('Runtime.enable');
  });

  const { result: remoteGlobal } = await session.post('Runtime.evaluate', {
    expression: 'globalThis',
  });

  const getGlobalNames = () => Promise.all([
    session.post('Runtime.globalLexicalScopeNames')
      .then((r) => r.names),
    session.post('Runtime.getProperties', {
      objectId: remoteGlobal.objectId,
    }).then((r) => r.result.map((p) => p.name)),
  ]).then((r) => r.flat());

  const evaluate = (source, throwOnSideEffect) => {
    const wrapped = /^\s*{/.test(source) && !/;\s*$/.test(source)
      ? `(${source})`
      : source;
    return session.post('Runtime.evaluate', {
      expression: wrapped,
      throwOnSideEffect,
      replMode: true,
      timeout: throwOnSideEffect ? 200 : undefined,
      objectGroup: 'OBJECT_GROUP',
    });
  };

  const callFunctionOn = (f, args) => session.post('Runtime.callFunctionOn', {
    executionContextId: context.id,
    functionDeclaration: f,
    arguments: args,
    objectGroup: 'OBJECT_GROUP',
  });

  const completeLine = async (line) => {
    if (line.length === 0) {
      return getGlobalNames();
    }

    const statements = acorn.parse(line, { ecmaVersion: 2021 }).body;
    const statement = statements[statements.length - 1];
    if (!statement || statement.type !== 'ExpressionStatement') {
      return undefined;
    }
    let { expression } = statement;
    if (expression.operator === 'void') {
      expression = expression.argument;
    }

    let keys;
    let filter;
    if (expression.type === 'Identifier') {
      keys = await getGlobalNames();
      filter = expression.name;

      if (keys.includes(filter)) {
        return undefined;
      }
    } else if (expression.type === 'MemberExpression') {
      const expr = line.slice(expression.object.start, expression.object.end);
      if (expression.computed && expression.property.type === 'Literal') {
        filter = expression.property.raw;
      } else if (expression.property.type === 'Identifier') {
        if (expression.property.name === '✖') {
          filter = undefined;
        } else {
          filter = expression.property.name;
          if (expression.computed) {
            keys = await getGlobalNames();
          }
        }
      } else {
        return undefined;
      }

      if (!keys) {
        let evaluateResult = await evaluate(expr, true);
        if (evaluateResult.exceptionDetails) {
          return undefined;
        }

        // Convert inspection target to object.
        if (evaluateResult.result.type !== 'object'
          && evaluateResult.result.type !== 'undefined'
          && evaluateResult.result.subtype !== 'null') {
          evaluateResult = await evaluate(`Object(${expr})`, true);
          if (evaluateResult.exceptionDetails) {
            return undefined;
          }
        }

        const own = [];
        const inherited = [];
        (await session.post('Runtime.getProperties', {
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
        if (keys.length === 0) {
          return undefined;
        }

        if (expression.computed) {
          if (line.endsWith(']')) {
            return undefined;
          }

          keys = keys.map((key) => {
            let r;
            if (`${+key}` === key) {
              r = key;
            } else {
              r = strEscape(key);
            }
            return `${r}]`;
          });
        } else {
          keys = keys.filter(isIdentifier);
        }
      }
    } else if (expression.type === 'CallExpression' || expression.type === 'NewExpression') {
      if (line[expression.end - 1] === ')') {
        return undefined;
      }
      if (!line.slice(expression.callee.end).includes('(')) {
        return undefined;
      }
      const callee = line.slice(expression.callee.start, expression.callee.end);
      const { result, exceptionDetails } = await evaluate(callee, true);
      if (exceptionDetails) {
        return undefined;
      }
      const { result: annotation } = await callFunctionOn(
        `function complete(fn, expression, line) {
          const { completeCall } = require('${require.resolve('./annotations')}');
          const a = completeCall(fn, expression, line);
          return a;
        }`,
        [result, { value: expression }, { value: line }],
      );
      if (annotation.type === 'string') {
        return { fillable: false, completions: [annotation.value] };
      }
      return undefined;
    }

    if (keys) {
      if (filter) {
        keys = keys
          .filter((k) => k.startsWith(filter) && k !== filter)
          .map((k) => k.slice(filter.length));
      }
      return { fillable: true, completions: keys };
    }

    return undefined;
  };

  const getPreview = (line) => evaluate(line, true)
    .then(({ result, exceptionDetails }) => {
      if (exceptionDetails) {
        throw new Error();
      }
      return callFunctionOn(
        `function inspect(v) {
          let i = util.inspect(v, {
            colors: false,
            breakLength: Infinity,
            compact: true,
            maxArrayLength: 10,
            depth: 1,
          });
          return i;
        }`,
        [result],
      );
    })
    .then(({ result }) => {
      let val = result.value;
      let noAnsi = stripAnsi(val);
      let length = process.stdout.columns - promptLength(promptIndex) - 2;
      if (noAnsi.length > length) {
        noAnsi = noAnsi.slice(0, length - 3) + '...';
      }

      return noAnsi;
    })
    .catch(() => undefined);

  const rl = createInterface({
    input: process.stdin,
    output: process.stdout,
    prompt: makePrompt(1),
    completer(line, cb) {
      completeLine(line)
        .then((result) => {
          if (result.fillable) {
            cb(null, [(result.completions || []).map((l) => line + l), line]);
          } else {
            cb(null, [[], line]);
          }
        })
        .catch(() => {
          cb(null, [[], line]);
        });
    },
    postprocessor(line) {
      return highlight(line);
    },
  });
  rl.pause();

  // if node doesn't support postprocessor, force _refreshLine
  if (rl.postprocessor === undefined) {
    rl._insertString = (c) => {
      const beg = rl.line.slice(0, rl.cursor);
      const end = rl.line.slice(rl.cursor, rl.line.length);
      rl.line = beg + c + end;
      rl.cursor += c.length;
      rl._refreshLine();
    };
  }

  const history = await getHistory();
  rl.history = history.history;

  let MODE = 'NORMAL';

  let promptIndex = 1;

  let nextCtrlCKills = false;
  let nextCtrlDKills = false;
  rl.on('SIGINT', () => {
    nextCtrlDKills = false;
    if (MODE === 'REVERSE') {
      MODE = 'NORMAL';
      process.stdout.moveCursor(0, -1);
      process.stdout.cursorTo(0);
      rl._refreshLine();
    } else if (rl.line.length) {
      rl.line = '';
      rl.cursor = 0;
      rl._refreshLine();
    } else if (nextCtrlCKills) {
      process.exit();
    } else {
      nextCtrlCKills = true;
      process.stdout.write(`\n(To exit, press ^C again)\n${rl.getPrompt()}`);
    }
  });

  let completionCache;
  const ttyWrite = rl._ttyWrite.bind(rl);
  rl._ttyWrite = (d, key) => {
    if (!(key.ctrl && key.name === 'c')) {
      nextCtrlCKills = false;
    }

    if (key.ctrl && key.name === 'd') {
      if (nextCtrlDKills) {
        process.exit();
      }
      nextCtrlDKills = true;
      process.stdout.write(`\n(To exit, press ^D again)\n${rl.getPrompt()}`);
      return;
    }
    nextCtrlDKills = false;

    if (key.ctrl && key.name === 'r' && MODE === 'NORMAL') {
      MODE = 'REVERSE';
      process.stdout.write('\n');
      rl._refreshLine();
      return;
    }

    if (key.name === 'return' && MODE === 'REVERSE') {
      MODE = 'NORMAL';
      const match = rl.history.find((h) => h.includes(rl.line));
      process.stdout.moveCursor(0, -1);
      process.stdout.cursorTo(0);
      process.stdout.clearScreenDown();
      rl.cursor = match.indexOf(rl.line) + rl.line.length;
      rl.line = match;
      rl._refreshLine();
      return;
    }

    ttyWrite(d, key);

    if (key.name === 'right' && rl.cursor === rl.line.length) {
      if (completionCache) {
        rl._insertString(completionCache);
      }
    }
  };

  const countLines = (line) => {
    let count = 0;
    line.split(/\r?\n/).forEach((inner) => {
      inner = stripAnsi(inner);
      count += 1;
      if (inner.length > process.stdout.columns) {
        count += Math.floor(inner.length / process.stdout.columns);
      }
    });
    return count;
  };

  const refreshLine = rl._refreshLine.bind(rl);
  rl._refreshLine = () => {
    completionCache = undefined;
    const inspectedLine = rl.line;

    if (MODE === 'REVERSE') {
      process.stdout.moveCursor(0, -1);
      process.stdout.cursorTo(promptLength(promptIndex));
      clearScreenDown(process.stdout);
      let match;
      if (inspectedLine) {
        match = rl.history.find((h) => h.includes(inspectedLine));
      }
      if (match) {
        match = highlight(match);
        match = underlineIgnoreANSI(match, inspectedLine);
      }
      process.stdout.write(`${match || ''}\n(reverse-i-search): ${inspectedLine}`);
      process.stdout.cursorTo('(reverse-i-search): '.length + rl.cursor);
      return;
    }

    if (rl.postprocessor === undefined) {
      rl.line = highlight(inspectedLine);
    }
    refreshLine();
    rl.line = inspectedLine;

    // fix cursor offset because of ansi codes
    process.stdout.cursorTo(promptLength(promptIndex) + rl.cursor);

    if (inspectedLine !== '') {
      completeLine(inspectedLine)
        .then(async(completion) => [completion, await getPreview(inspectedLine + (completion?.completions[0] || ''))])
        .then(([completion, preview]) => {
          if (rl.line !== inspectedLine) {
            return;
          }

          let rows = 0;
          if (completion && completion.completions.length > 0) {
            if (completion.fillable) {
              ([completionCache] = completion.completions);
            }
            process.stdout.cursorTo(promptLength(promptIndex) + rl.line.length);
            process.stdout.write(util.styleText('grey', completion.completions[0]));
            rows += countLines(completion.completions[0]) - 1;
          }
          if (preview) {
            process.stdout.write(util.styleText('grey', `\nOut[${promptIndex}]: ${preview}\n`));
            rows += countLines(preview) + 1;
          }

          process.stdout.cursorTo(promptLength(promptIndex) + rl.cursor);
          process.stdout.moveCursor(0, -rows);
        })
        .catch(() => { });
    }
  };

  process.stdout.write(`\
Node.js ${process.versions.node} (V8 ${process.versions.v8})
Prototype REPL - https://github.com/nodejs/repl

`);

  rl.resume();
  rl.prompt();
  for await (const line of rl) {
    rl.pause();
    clearScreenDown(process.stdout);

    const { result, exceptionDetails } = await evaluate(line, false);
    const uncaught = !!exceptionDetails;

    const { result: inspected } = await callFunctionOn(
      'function inspect(uncaught, line, value) { return globalThis[Symbol.for("nodejs.repl.updateInspect")](uncaught, line, value); }',
      [{ value: uncaught }, { value: promptIndex }, result],
    );
    process.stdout.write(`${makePromptOut(inspected.value, promptIndex)}${uncaught ? 'Uncaught ' : ''}${inspected.value}\n\n`);

    promptIndex += 1;
    rl.setPrompt(makePrompt(promptIndex));

    await Promise.all([
      session.post('Runtime.releaseObjectGroup', {
        objectGroup: 'OBJECT_GROUP',
      }),
      history.writeHistory(rl.history),
    ]);

    rl.resume();
    rl.prompt();
  }
}

start();