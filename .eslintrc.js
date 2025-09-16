module.exports = {
  root: true,
  extends: [
    'eslint:recommended',
    'plugin:@typescript-eslint/recommended',
    'plugin:react/recommended'
  ],
  parser: '@typescript-eslint/parser',
  plugins: ['@typescript-eslint', 'react'],
  env: {
    node: true,
    browser: true,
    es2021: true,
    jest: true
  },
  settings: {
    react: {
      version: 'detect'
    }
  }
};
