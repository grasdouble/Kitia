import util from 'util/';
import stripAnsi from 'strip-ansi';
export const types = util.types;
export const stripVTControlCharacters = stripAnsi;
export default { ...util, stripVTControlCharacters };
