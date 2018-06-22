'use strict';

let inspector;

try {
  inspector = require('inspector');
} catch (err) {
  module.exports = {};
  return;
}

const session = new inspector.Session();
session.connect();

const mainContextIdPromise = new Promise((resolve) => {
  session.once('Runtime.executionContextCreated', ({ params: { context } }) => {
    resolve(context.id);
    session.post('Runtime.disable');
  });
  session.post('Runtime.enable');
});

function makeProxy(name) {
  return new Proxy({ cache: new Map() }, {
    get({ cache }, method) {
      const n = `${name}.${method}`;
      if (cache.has(n)) {
        return cache.get(n);
      }
      const func = (params = {}) => new Promise((resolve, reject) => {
        session.post(n, params, (err, result) => {
          if (err) {
            reject(err);
            return;
          }
          resolve(result);
        });
      });
      cache.set(n, func);
      return func;
    },
  });
}

module.exports = {
  Runtime: makeProxy('Runtime'),
  mainContextIdPromise,
};
