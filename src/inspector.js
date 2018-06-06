'use strict';

const hasInspector = process.config.variables.v8_enable_inspector === 1;
const inspector = hasInspector ? require('inspector') : undefined;


if (!hasInspector) {
  throw new Error('no inspector');
}

const session = new inspector.Session();
session.connect();

const makeProxy = (name) => new Proxy({}, {
  get: (target, method) => {
    const n = `${name}.${method}`;
    return (params = {}) => {
      let r;
      session.post(n, params, (err, result) => {
        if (err) {
          throw new Error(err.message);
        }
        r = result;
      });
      return r;
    };
  },
});

module.exports = {
  Runtime: makeProxy('Runtime'),
};
