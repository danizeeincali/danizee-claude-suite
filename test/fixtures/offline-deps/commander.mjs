// The small part of commander that bin/cli.js uses: name/description/version, command/option/action, parse.
class Cmd {
  constructor(name) { this.cmdName = name; this.opts = []; this.subs = []; this.fn = null; this.defaults = {}; }
  name() { return this; }
  description() { return this; }
  version() { return this; }
  command(name) { const c = new Cmd(name); this.subs.push(c); return c; }
  option(flags, _desc, def) {
    const m = /^(?:-(\w), )?--([\w-]+)(?: <\w+>)?$/.exec(flags);
    const key = m[2].replace(/-(\w)/g, (_, c) => c.toUpperCase());
    this.opts.push({ short: m[1], long: m[2], key, takes: /</.test(flags) });
    if (def !== undefined) this.defaults[key] = def;
    return this;
  }
  action(fn) { this.fn = fn; return this; }
  parse(argv = process.argv) {
    const [name, ...rest] = argv.slice(2);
    const sub = this.subs.find((c) => c.cmdName === name);
    if (!sub) { console.error(`error: unknown command '${name}'`); process.exit(1); }
    const options = { ...sub.defaults };
    for (let i = 0; i < rest.length; i++) {
      const o = sub.opts.find((x) => rest[i] === `--${x.long}` || (x.short && rest[i] === `-${x.short}`));
      if (!o) { console.error(`error: unknown option '${rest[i]}'`); process.exit(1); }
      options[o.key] = o.takes ? rest[++i] : true;
    }
    sub.fn(options);
    return this;
  }
}
export class Command extends Cmd { constructor() { super('program'); } }
