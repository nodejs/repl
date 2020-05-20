'use strict';

const fs = require('fs');
const path = require('path');
const Module = require('module');
const acorn = require('acorn');
const annotationMap = require('./annotation_map.js');

function generateAnnotationForJsFunction(method) {
  const description = method.toString();
  if (description.includes('{ [native function] }')) {
    return false;
  }
  let expr = null;
  try {
    // Try to parse as a function, anonymous function, or arrow function.
    expr = acorn.parse(`(${description})`, { ecmaVersion: 2020 }).body[0].expression;
  } catch {
    try {
      // Try to parse as a method.
      expr = acorn.parse(`({${description}})`, { ecmaVersion: 2020 }).body[0].expression;
    } catch {} // eslint-disable-line no-empty
  }
  if (!expr) {
    return false;
  }
  let params;
  switch (expr.type) {
    case 'ClassExpression': {
      if (!expr.body.body) {
        break;
      }
      const constructor = expr.body.body.find((m) => m.kind === 'constructor');
      if (constructor) {
        ({ params } = constructor.value);
      }
      break;
    }
    case 'ObjectExpression':
      if (!expr.properties[0] || !expr.properties[0].value) {
        break;
      }
      ({ params } = expr.properties[0].value);
      break;
    case 'FunctionExpression':
    case 'ArrowFunctionExpression':
      ({ params } = expr);
      break;
    default:
      break;
  }
  if (!params) {
    return false;
  }
  params = params.map(function paramName(param) {
    switch (param.type) {
      case 'Identifier':
        return param.name;
      case 'AssignmentPattern':
        return `?${paramName(param.left)}`;
      case 'ObjectPattern': {
        const list = param.properties.map((p) => {
          const k = paramName(p.key);
          const v = paramName(p.value);
          if (k === v) {
            return k;
          }
          if (`?${k}` === v) {
            return `?${k}`;
          }
          return `${k}: ${v}`;
        }).join(', ');
        return `{ ${list} }`;
      }
      case 'ArrayPattern': {
        const list = param.elements.map(paramName).join(', ');
        return `[ ${list} ]`;
      }
      case 'RestElement':
        return `...${paramName(param.argument)}`;
      default:
        return '?';
    }
  });
  annotationMap.set(method, { call: [params], construct: [params] });
  return true;
}

function gracefulOperation(fn, args, alternative) {
  try {
    return fn(...args);
  } catch {
    return alternative;
  }
}

function completeCall(method, expression, buffer) {
  if (method === globalThis.require) {
    if (expression.arguments.length > 1) {
      return ')';
    }
    if (expression.arguments.length === 1) {
      const a = expression.arguments[0];
      if (a.type !== 'Literal' || typeof a.value !== 'string'
          || /['"]$/.test(a.value)) {
        return undefined;
      }
    }

    const extensions = Object.keys(require.extensions);
    const indexes = extensions.map((extension) => `index${extension}`);
    indexes.push('package.json', 'index');
    const versionedFileNamesRe = /-\d+\.\d+/;

    const completeOn = expression.arguments[0].value;
    const subdir = /([\w@./-]+\/)?(?:[\w@./-]*)/m.exec(completeOn)[1] || '';
    let group = [];
    let paths = [];

    if (completeOn === '.') {
      group = ['./', '../'];
    } else if (completeOn === '..') {
      group = ['../'];
    } else if (/^\.\.?\//.test(completeOn)) {
      paths = [process.cwd()];
    } else {
      paths = module.paths.concat(Module.globalPaths);
    }

    paths.forEach((dir) => {
      dir = path.resolve(dir, subdir);
      gracefulOperation(
        fs.readdirSync,
        [dir, { withFileTypes: true }],
        [],
      ).forEach((dirent) => {
        if (versionedFileNamesRe.test(dirent.name) || dirent.name === '.npm') {
          // Exclude versioned names that 'npm' installs.
          return;
        }
        const extension = path.extname(dirent.name);
        const base = dirent.name.slice(0, -extension.length);
        if (!dirent.isDirectory()) {
          if (extensions.includes(extension) && (!subdir || base !== 'index')) {
            group.push(`${subdir}${base}`);
          }
          return;
        }
        group.push(`${subdir}${dirent.name}/`);
        const absolute = path.resolve(dir, dirent.name);
        const subfiles = gracefulOperation(fs.readdirSync, [absolute], []);
        for (const subfile of subfiles) {
          if (indexes.includes(subfile)) {
            group.push(`${subdir}${dirent.name}`);
            break;
          }
        }
      });
    });

    for (const g of group) {
      if (g.startsWith(completeOn)) {
        return g.slice(completeOn.length);
      }
    }

    return undefined;
  }

  if (!annotationMap.has(method)) {
    if (!generateAnnotationForJsFunction(method)) {
      return undefined;
    }
  }

  const entry = annotationMap.get(method)[{
    CallExpression: 'call',
    NewExpression: 'construct',
  }[expression.type]].slice(0);
  const target = expression.arguments.length;
  let params = entry.sort((a, b) => {
    // find the completion with the closest number of args
    // to the given expression
    const Da = Math.abs(target - a.length);
    const Db = Math.abs(target - b.length);
    // if the delta is equal, prefer the longer one
    if (Da === Db) {
      return b.length - a.length;
    }
    return Da - Db;
  })[0];
  if (target >= params.length) {
    if (params[params.length - 1].startsWith('...')) {
      return `, ${params[params.length - 1]}`;
    }
    return ')';
  }
  params = params.slice(target).join(', ');
  if (target > 0) {
    if (buffer.trim().endsWith(',')) {
      const spaces = buffer.length - (buffer.lastIndexOf(',') + 1);
      if (spaces > 0) {
        return params;
      }
      return ` ${params}`;
    }
    return `, ${params}`;
  }
  return params;
}

module.exports = { completeCall };
