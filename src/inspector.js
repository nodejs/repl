'use strict';

const { EventEmitter } = require('events');
const inspector = require('inspector');

const events = [
  'inspectorNotification',
  'Runtime.executionContextCreated',
  'Runtime.executionContextDestroyed',
  'Runtime.executionContextsCleared',
  'Runtime.exceptionThrown',
  'Runtime.exceptionRevoked',
  'Runtime.consoleAPICalled',
  'Runtime.inspectRequested',
  'Debugger.scriptParsed',
  'Debugger.scriptFailedToParse',
  'Debugger.breakpointResolved',
  'Debugger.paused',
  'Debugger.resumed',
  'Console.messageAdded',
  'Profiler.consoleProfileStarted',
  'Profiler.consoleProfileFinished',
  'HeapProfiler.addHeapSnapshotChunk',
  'HeapProfiler.resetProfiles',
  'HeapProfiler.reportHeapSnapshotProgress',
  'HeapProfiler.lastSeenObjectId',
  'HeapProfiler.heapStatsUpdate',
  'NodeTracing.dataCollected',
  'NodeTracing.tracingComplete',
  'NodeWorker.attachedToWorker',
  'NodeWorker.detachedFromWorker',
  'NodeWorker.receivedMessageFromWorker',
  'NodeRuntime.waitingForDisconnect'
];

class Session extends EventEmitter {
  constructor(url) {
    super();

    this.session = new inspector.Session();
    this.session.connect();

    for (const event of events) {
      this.session.on(event, this.onMessage.bind(this));
    }
  }

  static create(url) {
    return new Session(url);
  }

  onMessage(d) {
    const { method, params } = d;
    if (method) {
      this.emit(method, params);
    }
  }

  post(method, params) {
    return new Promise((resolve, reject) => {
      this.session.post(method, params, (err, result) => {
        if (err) {
          reject(err);
        } else {
          resolve(result);
        }
      });
    });
  }
}

module.exports = { Session };
