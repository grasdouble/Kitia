import stripAnsi from 'strip-ansi';
import util from 'util/';
export const types = util.types;
export const stripVTControlCharacters = stripAnsi;
export default { ...util, stripVTControlCharacters };
