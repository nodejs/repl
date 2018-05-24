'use strict';

module.exports = {
  extends: 'airbnb',
  parser: 'babel-eslint',
  parserOptions: {
    ecmaVersion: 2018,
    sourceType: 'script',
    ecmaFeatures: {
      experimentalObjectRestSpread: true,
    },
  },
  env: {
    es6: true,
    node: true,
  },
  rules: {
    'strict': ['error', 'global'],
    'no-bitwise': 'off',
    'no-iterator': 'off',
    'global-require': 'off',
    'quote-props': ['error', 'consistent-as-needed'],
    'brace-style': ['error', '1tbs', { allowSingleLine: false }],
    'curly': ['error', 'all'],
    'no-param-reassign': 'off',
    'arrow-parens': ['error', 'always'],
    'no-multi-assign': 'off',
    'no-underscore-dangle': 'off',
    'no-restricted-syntax': 'off',
    'object-curly-newline': 'off',
    'prefer-const': ['error', { destructuring: 'all' }],
    'class-methods-use-this': 'off',
    'import/no-dynamic-require': 'off',
    'import/no-extraneous-dependencies': ['error', {
      devDependencies: true,
    }],
    'import/extensions': 'off',
  },
};
