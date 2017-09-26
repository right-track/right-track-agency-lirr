'use strict';

const fs = require("fs");
const path = require("path");
const merge = require("deepmerge");


// DEFAULT CONFIGURATION FILE
const defaultLocation = "./agency.json";


// AGENCY CONFIGURATION VARIABLES
let CONFIG = {};


/**
 * Read the configuration file from the specified path and merge its
 * properties with the default configuration file.
 * @param {string} location Path to agency config file (relative paths are relative to module root)
 */
let read = function(location) {
    if ( location !== undefined ) {

        // Relative paths are relative to the project root directory
        if (location.charAt(0) === ".") {
            location = path.join(__dirname, "/../", location);
        }
        location = path.normalize(location);
        console.log("--> Reading Agency Config File: " + location);

        // Read new config file
        let add = JSON.parse(fs.readFileSync(location, 'utf8'));

        // Parse relative paths relative to file location
        let dirname = path.dirname(location);
        if (add.db_location !== undefined) {
            if (add.db_location.charAt(0) === '.') {
                add.db_location = path.join(dirname, "/", add.db_location);
            }
        }
        if (add.db_archive_location !== undefined) {
            if (add.db_archive_location.charAt(0) === '.') {
                add.db_archive_location = path.join(dirname, "/", add.db_archive_location);
            }
        }
        if ( add.icon_location !== undefined ) {
            if ( add.icon_location.charAt(0) === '.' ) {
                add.icon_location = path.join(dirname, "/", add.icon_location);
            }
        }

        // Merge configs
        CONFIG = merge(CONFIG, add, {
            arrayMerge: function (d, s) {
                return d.concat(s);
            }
        });

    }
};


/**
 * Get the agency configuration variables
 * @returns {object} Agency config variables
 */
let get = function() {
    return CONFIG;
};


/**
 * Clear any saved config information and
 * reload the default configuration.  Any
 * previously added config files will have
 * to be read again.
 */
let reset = function() {
    CONFIG = {};
    read(defaultLocation);
};



// Export Functions
module.exports = {
    read: read,
    get: get,
    reset: reset
};