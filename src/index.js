#!/usr/bin/env node

'use strict';

const Module = require('module');
const util = require('util');
const REPL = require('./repl');

const builtinLibs = Module.builtinModules.filter((x) => !/^_|\//.test(x));

builtinLibs.forEach((name) => {
  const setReal = (val) => {
    delete global[name];
    global[name] = val;
  };

  Object.defineProperty(global, name, {
    get: () => {
      const lib = require(name);
      delete global[name];
      Object.defineProperty(global, name, {
        get: () => lib,
        set: setReal,
        configurable: true,
        enumerable: false,
      });

      return lib;
    },
    set: setReal,
    configurable: true,
    enumerable: false,
  });
});

global.require = require;
global.module = module;

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

// TODO: scope this
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

new REPL(process.stdout, process.stdin); // eslint-disable-line no-new
