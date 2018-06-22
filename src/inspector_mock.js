'use strict';

const { Script, runInThisContext } = require('vm');

let objectIdCounter = 0;
const objectMap = new Map();
const registerObject = (O) => {
  objectIdCounter += 1;
  const objectId = `{"objectId":${objectIdCounter}}`;
  objectMap.set(objectId, O);
  return {
    objectId,
  };
};

module.exports = {
  Runtime: {
    async evaluate({ expression, awaitPromise }) {
      try {
        const script = new Script(expression, { filename: 'repl' });
        let res = script.runInThisContext({ breakOnSigint: true });
        if (awaitPromise) {
          res = await res;
        }
        const remote = registerObject(res);
        return { result: remote };
      } catch (err) {
        const remote = registerObject(err);
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
    callFunctionOn: ({ functionDeclaration, arguments: args }) => {
      args = args.map(({ objectId }) => objectMap.get(objectId));
      const fn = runInThisContext(functionDeclaration);
      const result = registerObject(fn(...args));
      return { result };
    },
  },
};
