'use strict';

const { EventEmitter } = require('events');
const WebSocket = require('ws');

class Session extends EventEmitter {
  constructor(url) {
    super();

    this.ws = new WebSocket(url);
    this.ws.on('message', (d) => {
      this.onMessage(d);
    });
    this.ws.on('open', () => {
      this.emit('open');
    });

    this.messageCounter = 0;
    this.messages = new Map();
  }

  static create(url) {
    return new Promise((resolve) => {
      const s = new Session(url);
      s.once('open', () => resolve(s));
    });
  }

  onMessage(d) {
    const { id, method, params, result, error } = JSON.parse(d);
    if (method) {
      this.emit(method, params);
    } else {
      const { resolve, reject } = this.messages.get(id);
      this.messages.delete(id);
      if (error) {
        const e = new Error(error.message);
        e.code = error.code;
        reject(e);
      } else {
        resolve(result);
      }
    }
  }

  post(method, params) {
    return new Promise((resolve, reject) => {
      const id = this.messageCounter;
      this.messageCounter += 1;
      const message = {
        method,
        params,
        id,
      };
      this.messages.set(id, { resolve, reject });
      this.ws.send(JSON.stringify(message));
    });
  }
}

module.exports = { Session };
