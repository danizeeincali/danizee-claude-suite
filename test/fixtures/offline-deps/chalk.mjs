const id = (s) => String(s);
const chalk = new Proxy(id, { get: () => chalk, apply: (_t, _this, args) => id(args[0]) });
export default chalk;
