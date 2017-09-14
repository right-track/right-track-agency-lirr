'use strict';

const defaultLocation = "../agency.json";


/**
 * Get the agency configuration properties from the specified
 * location (or the default properties if no location given)
 * @param {string|undefined} location Path to agency config
 * @returns {object} config values
 */
let config = function(location) {

    // Load the default configuration
    let config = require(defaultLocation);

    // Load additional config from location
    if ( location !== undefined ) {
        config = Object.assign(config, require(location));
    }
    else {
        location = defaultLocation
    }

    // Add config location
    config.path = location;

    // Return the config
    return config;

};



// Export functions
module.exports = {
    config: config
};