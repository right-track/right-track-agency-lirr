'use strict';

/**
 * ### Agency Configuration
 * This module will read agency configuration files and provide the
 * configuration properties.
 * @module config
 */

const template = require('right-track-agency');


// Reset and load the default configuration
reset();


/**
 * Read the configuration file from the specified path and merge its properties
 * with the default configuration file.
 * @param {string} location Path to agency config file (relative paths are relative to module root)
 */
function read(location) {
  return template.config.read(__dirname, location);
}

/**
 * Get the agency configuration variables
 * @returns {object} Agency config variables
 */
function get() {
  return template.config.get();
}

/**
 * Clear any saved config information and reload the default configuration.  Any
 * previously added config files will have to be read again.
 */
function reset() {
  return template.config.reset(__dirname);
}


module.exports = {
  read: read,
  get: get,
  reset: reset
};
