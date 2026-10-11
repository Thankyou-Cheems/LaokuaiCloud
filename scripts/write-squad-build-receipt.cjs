/* eslint-env node */
/* eslint-disable @typescript-eslint/no-var-requires */
const path = require("node:path");
require("./laokuai-package-audit.cjs").writeSquadReceipt(path.resolve(__dirname,".."));
