#!/usr/bin/env node

'use strict';

const { createInterface, clearScreenDown } = require('readline');
const { spawn } = require('child_process');
const acorn = require('acorn-loose');
const chalk = require('chalk');
const { Session } = require('./inspector');
const { isIdentifier, strEscape, underlineIgnoreANSI } = require('./util');
const highlight = require('./highlight');
const getHistory = require('./history');

const PROMPT = '> ';

async function start(wsUrl) {
  const session = await Session.create(wsUrl);

  session.post('Runtime.enable');
  const [{ context }] = await Session.once(session, 'Runtime.executionContextCreated');
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

  const completeLine = async (line, cutLineStart) => {
    if (line.length === 0) {
      return getGlobalNames();
    }

    const statements = acorn.parse(line, { ecmaVersion: 2020 }).body;
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
            if (cutLineStart) {
              return `${r}]`;
            }
            return r;
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
        keys = keys.filter((k) => k.startsWith(filter));
        if (cutLineStart) {
          keys = keys.map((k) => k.slice(filter.length));
        }
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
          const i = util.inspect(v, {
            colors: false,
            breakLength: Infinity,
            compact: true,
            maxArrayLength: 10,
            depth: 1,
          });
          return i.split('\\n')[0].trim();
        }`,
        [result],
      );
    })
    .then(({ result }) => result.value)
    .catch(() => undefined);

  const rl = createInterface({
    input: process.stdin,
    output: process.stdout,
    prompt: PROMPT,
    completer(line, cb) {
      completeLine(line, false)
        .then((result) => {
          cb(null, [result.completions || [], line]);
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

  let nextCtrlCKills = false;
  rl.on('SIGINT', () => {
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
      process.stdout.write(`\n(To exit, press ^C again)\n${PROMPT}`);
    }
  });

  let completionCache;
  const ttyWrite = rl._ttyWrite.bind(rl);
  rl._ttyWrite = (d, key) => {
    if (!(key.ctrl && key.name === 'c')) {
      nextCtrlCKills = false;
    }

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

  const refreshLine = rl._refreshLine.bind(rl);
  rl._refreshLine = () => {
    completionCache = undefined;
    const inspectedLine = rl.line;

    if (MODE === 'REVERSE') {
      process.stdout.moveCursor(0, -1);
      process.stdout.cursorTo(PROMPT.length);
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

    if (inspectedLine !== '') {
      process.stdout.cursorTo(PROMPT.length + rl.line.length);
      clearScreenDown(process.stdout);
      process.stdout.cursorTo(PROMPT.length + rl.cursor);

      Promise.all([
        completeLine(inspectedLine, true),
        getPreview(inspectedLine),
      ])
        .then(([completion, preview]) => {
          if (rl.line !== inspectedLine) {
            return;
          }
          if (completion && completion.completions.length > 0) {
            if (completion.fillable) {
              ([completionCache] = completion.completions);
            }
            process.stdout.cursorTo(PROMPT.length + rl.line.length);
            process.stdout.write(chalk.grey(completion.completions[0]));
          }
          if (preview) {
            process.stdout.write(`\n${chalk.grey(preview.slice(0, process.stdout.columns - 1))}`);
            process.stdout.moveCursor(0, -1);
          }
          if (completion || preview) {
            process.stdout.cursorTo(PROMPT.length + rl.cursor);
          }
        })
        .catch(() => {});
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
      `function inspect(v) {
        globalThis.${uncaught ? '_err' : '_'} = v;
        return util.inspect(v, {
          colors: true,
          showProxy: true,
        });
      }`,
      [result],
    );

    process.stdout.write(`${uncaught ? 'Uncaught ' : ''}${inspected.value}\n`);

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

const child = spawn(process.execPath, [
  '--inspect-publish-uid=http',
  ...process.execArgv,
  require.resolve('./stub.js'),
  ...process.argv,
], {
  cwd: process.cwd(),
  windowsHide: true,
});

child.stdout.on('data', (data) => {
  process.stdout.write(data);
});

child.stderr.on('data', (data) => {
  const s = data.toString();
  if (s.startsWith('__DEBUGGER_URL__')) {
    start(s.split(' ')[1]);
  } else if (s !== 'Debugger attached.\n') {
    process.stderr.write(data);
  }
});
