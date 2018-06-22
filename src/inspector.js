'use strict';

try {
  require('inspector');
  module.exports = require('./inspector_real.js');
} catch (err) {
  module.exports = require('./inspector_mock.js');
}
