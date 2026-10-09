// drift monitor (fixture — never executed)
export const hashConfig = (cfg) => JSON.stringify(cfg).length;
export const drifted = (prev, cfg) => prev !== hashConfig(cfg);
