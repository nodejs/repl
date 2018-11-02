'use strict';

const acorn = require('acorn');
const annotationMap = require('./annotation_map.js');

function generateAnnotationForJsFunction(method) {
  const description = method.toString();
  if (description.includes('{ [native function] }')) {
    return false;
  }
  let parsed = null;
  try {
    // Try to parse as a function, anonymous function, or arrow function.
    parsed = acorn.parse(`(${description})`, { ecmaVersion: 2019 });
  } catch {} // eslint-disable-line no-empty
  if (!parsed) {
    try {
      // Try to parse as a method.
      parsed = acorn.parse(`({${description}})`, { ecmaVersion: 2019 });
    } catch {} // eslint-disable-line no-empty
  }
  if (parsed && parsed.body && parsed.body[0] && parsed.body[0].expression) {
    const expr = parsed.body[0].expression;
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
    if (params) {
      params = params.map(function paramName(param) {
        switch (param.type) {
          case 'Identifier':
            return param.name;
          case 'AssignmentPattern':
            return `?${paramName(param.left)}`;
          case 'ObjectPattern': {
            const list = param.properties.map((p) => paramName(p.value)).join(', ');
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
      annotationMap.set(method, [params]);
      return true;
    }
  }
  return false;
}

function completeCall(method, expression, buffer) {
  if (!annotationMap.has(method)) {
    if (!generateAnnotationForJsFunction(method)) {
      return undefined;
    }
  }
  let [params] = annotationMap.get(method);
  params = params.slice(expression.arguments.length).join(', ');
  if (expression.arguments.length > 0) {
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
