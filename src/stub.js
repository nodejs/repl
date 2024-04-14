'use strict';

const Module = require('module');
const path = require('path');
const util = require('util');

Module.builtinModules
  .filter((x) => !/^_|\//.test(x))
  .forEach((name) => {
    if (name === 'domain' || name === 'repl' || name === 'sys') {
      return;
    }
    Object.defineProperty(globalThis, name, {
      value: require(name),
      writable: true,
      enumerable: false,
      configurable: true,
    });
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

  Object.defineProperty(globalThis, 'module', {
    writable: true,
    enumerable: false,
    configurable: true,
    value: module,
  });

  Object.defineProperty(globalThis, 'require', {
    writable: true,
    enumerable: false,
    configurable: true,
    value: module.exports,
  });
}

['_', '__', '___', '_err'].forEach((prop) => {
  Object.defineProperty(globalThis, prop, {
    value: undefined,
    writable: true,
    enumerable: false,
    configurable: true,
  });
});

process.on('uncaughtException', (e) => {
  process.stdout.write(`Uncaught ${util.inspect(e)}\n`);
});

process.on('unhandledRejection', (reason) => {
  process.stdout.write(`Unhandled ${util.inspect(reason)}\n`);
});

globalThis[Symbol.for('nodejs.repl.updateInspect')] = (uncaught, line, value) => {
  if (uncaught) {
    globalThis._err = value;
  } else {
    globalThis.___ = globalThis.__;
    globalThis.__ = globalThis._;
    globalThis._ = value;
    Object.defineProperty(globalThis, `_${line}`, {
      value,
      writable: true,
      enumerable: false,
      configurable: true,
    });
  }
  return util.inspect(value, {
    colors: true,
    showProxy: true,
  });
};