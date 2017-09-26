'use strict';


const config = require("./config.js");


// Load default properties
config.reset();



// Export functions
module.exports = {
    config: {
        read: config.read,
        get: config.get,
        reset: config.reset
    }
};