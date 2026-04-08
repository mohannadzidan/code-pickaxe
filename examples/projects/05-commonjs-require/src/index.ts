declare function require(moduleName: string): any;

const helpers = require("./helpers");
const { twice } = require("./helpers");

export const a = helpers.label;
export const b = twice(21);
