const TerserPlugin = require("terser-webpack-plugin");
const webpack = require("webpack");

const path = require('path');

const mode = process.env.NODE_ENV || "development";
const isProd = mode === "production";

// https://github.com/wtetsu/webextensions-webpack-boilerplate/blob/master/webpack.config.common.js

const baseConfig = {
  module: {
    rules: [{
      test: /\.tsx?$/i,
      use: [{ loader: "ts-loader", },],
      exclude: /node_modules/
    }, {
      test: /\.css$/i,
      use: ["style-loader", "css-loader"],
    },]
  },

  devtool: process.env.NODE_ENV === "production" ? false : "cheap-module-source-map",

  plugins: [
    new webpack.ProvidePlugin({
      Buffer: ['buffer', 'Buffer'],
      process: require.resolve("./polyfill/process.js"),
      setImmediate: [require.resolve("./polyfill/setimmediate.js"), "setImmediate"],
      os: require.resolve("./polyfill/os.js"),
    }),
  ],

  resolve: {
    extensions: ['.tsx', '.ts', '.js'],
    fallback: {
      "string_decoder": require.resolve("string_decoder"),
      "buffer": require.resolve('buffer'),
      "stream": require.resolve("stream-browserify"),
      "url": require.resolve("url"),
      "crypto": require.resolve("crypto-browserify"),
      "process": require.resolve("./polyfill/process.js"),
      "path": require.resolve("path-browserify"),
      "os": require.resolve("./polyfill/os.js"),
      "zlib": require.resolve("browserify-zlib"), // still used by nodemailer

      "http": false,
      "https": false,
      "dns": false,
      "net": false,
      "util": false,
      "fs": false,
    }
  },

  optimization: {
    minimize: isProd,
    minimizer: [
      new TerserPlugin({
        terserOptions: {
          compress: {
            pure_funcs: ["console.info", "console.warn", "console.time", "console.timeEnd"],
          },
        },
      }),
    ],
  },
};

module.exports = [
  Object.assign({}, baseConfig, {
    entry: './src/demo',
    output: { path: path.resolve(__dirname, 'docs'), filename: "demo.js", },
  }),
];
