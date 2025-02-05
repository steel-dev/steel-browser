const path = require('path');

module.exports = {
  mode: 'production',
  entry: {
    inject: './src/inject.js',
    background: './src/background.js'
  },
  output: {
    filename: '[name].js',
    path: path.resolve(__dirname, 'dist'),
  },
  optimization: {
    minimize: false // To keep code readable
  }
};
