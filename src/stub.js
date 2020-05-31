'use strict';

const Module = require('module');
const path = require('path');
const inspector = require('inspector');
const util = require('util');

inspector.open(true);
process.stderr.write(`__DEBUGGER_URL__ ${inspector.url()}`);

if (process.platform !== 'win32') {
  util.inspect.styles.number = 'blue';
  util.inspect.styles.bigint = 'blue';
}

Module.builtinModules
  .filter((x) => !/^_|\//.test(x))
  .forEach((name) => {
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

globalThis._ = undefined;
globalThis._err = undefined;

// keep process alive using stdin
process.stdin.on('data', () => {});
