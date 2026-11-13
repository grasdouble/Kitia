export const stdout = { level: 3, hasBasic: true, has256: true, has16m: true };
export const stderr = stdout;
export const supportsColor = () => stdout;
export default { stdout, stderr };
