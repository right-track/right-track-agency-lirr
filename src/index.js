'use strict';

const path = require("path");
const merge = require("deepmerge");
const defaultLocation = "./agency.json";


let config = {};



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
        let add = require(location);

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

        // Merge configs
        config = merge(config, add, {
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
    return config;
};



// Load default properties
read(defaultLocation);



// Export functions
module.exports = {
    read: read,
    get: get
};