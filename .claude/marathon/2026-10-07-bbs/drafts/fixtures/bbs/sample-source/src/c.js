// review helper (fixture — never executed)
export const changedFiles = (diff) => diff.split('\n').filter(l => l.startsWith('+++ ')).map(l => l.slice(4));
