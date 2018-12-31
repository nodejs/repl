'use strict';

const { Script, runInThisContext } = require('vm');

let objectIdCounter = 0;
const groupMap = new Map();
const objectMap = new Map();
const registerObject = (O, group) => {
  objectIdCounter += 1;
  const objectId = `{"objectId":${objectIdCounter}}`;
  objectMap.set(objectId, O);
  if (group) {
    let entry;
    if (groupMap.has(group)) {
      entry = groupMap.get(group);
    } else {
      entry = [];
      groupMap.set(group, entry);
    }
    entry.push(objectId);
  }
  return {
    objectId,
  };
};

module.exports = {
  Runtime: {
    async evaluate({ expression, awaitPromise, objectGroup }) {
      try {
        const script = new Script(expression, { filename: 'repl' });
        let res = script.runInThisContext({ breakOnSigint: true });
        if (awaitPromise) {
          res = await res;
        }
        const remote = registerObject(res, objectGroup);
        return { result: remote };
      } catch (err) {
        const remote = registerObject(err, objectGroup);
        return { exceptionDetails: {
          exception: remote,
        } };
      }
    },
    globalLexicalScopeNames: () => Promise.reject(),
    getProperties: ({ objectId }) => {
      const properties = Object.getOwnPropertyDescriptors(objectMap.get(objectId));
      return {
        result: properties,
      };
    },
    callFunctionOn: ({ functionDeclaration, arguments: args, objectGroup }) => {
      args = args.map(({ objectId }) => objectMap.get(objectId));
      const fn = runInThisContext(functionDeclaration);
      const result = registerObject(fn(...args), objectGroup);
      return { result };
    },
    releaseObjectGroup({ objectGroup }) {
      const entry = groupMap.get(objectGroup);
      if (entry) {
        entry.forEach((objectId) => {
          objectMap.delete(objectId);
        });
      }
    },
  },
};
