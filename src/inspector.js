'use strict';

const hasInspector = process.config.variables.v8_enable_inspector === 1;
const inspector = hasInspector ? require('inspector') : undefined;

let session;

function sendInspectorCommand(cb) {
  return new Promise((resolve, reject) => {
    if (!hasInspector) {
      reject(new Error('no inspector'));
      return;
    }
    if (session === undefined) {
      session = new inspector.Session();
    }
    try {
      session.connect();
      try {
        resolve(cb(session));
      } finally {
        session.disconnect();
      }
    } catch (e) {
      reject(e);
    }
  });
}

module.exports = sendInspectorCommand;
