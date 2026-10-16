const STUBS = new Set(['commander', 'chalk', 'ora']);
export async function resolve(specifier, context, nextResolve) {
  try {
    return await nextResolve(specifier, context);
  } catch (error) {
    if (error?.code === 'ERR_MODULE_NOT_FOUND' && STUBS.has(specifier)) {
      return { url: new URL(`./${specifier}.mjs`, import.meta.url).href, shortCircuit: true };
    }
    throw error;
  }
}
