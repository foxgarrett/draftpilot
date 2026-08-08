// Thin re-export -- the actual analyzer implementations live in
// ../utils/analysis.js so the extension and this prototype run identical
// logic. Everything the prototype uses is re-exported here to keep imports
// in analyze.js unchanged.
module.exports = require('../utils/analysis');
