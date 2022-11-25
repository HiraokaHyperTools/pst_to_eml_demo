exports.nextTick = function (callback, ...args) {
  const that = this;
  setTimeout(() => callback.apply(that, args), 4);
}

exports.env = {};
