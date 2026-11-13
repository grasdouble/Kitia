// Vite injects the build runtime's builtin names for stack-trace classification.
export const builtinModules = __KITIA_NODE_BUILTINS__;
export function createRequire() {
  throw new Error('Node module loading is unavailable in the browser demo');
}
export default { builtinModules, createRequire };
