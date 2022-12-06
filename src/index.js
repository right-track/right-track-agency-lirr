'use strict';

const core = require('right-track-core');
const RightTrackAgency = core.classes.RightTrackAgency;
const RightTrackDB = core.classes.RightTrackDB;
const feed = require('./feed.js');

const moduleDirectory = __dirname + "/../";


/**
 * RightTrackAgency implementation for the Long Island Rail Road
 *
 * For more information, see:
 * - Right Track core module ({@link https://github.com/right-track/right-track-core})
 * - Right Track core documentation ({@link https://docs.righttrack.io/right-track-core})
 * @class
 */
class LIRR extends RightTrackAgency {

  /**
   * Create a new RightTrackAgency for the Long Island Railroad
   */
  constructor() {
    super(moduleDirectory);
  }

  /**
   * Check if this Agency supports a real-time Station Feed
   * @returns {boolean} true if Station Feeds are supported
   */
  isFeedSupported() {
    return true;
  }

  /**
   * Load the real-time Station Feed for the specified Station
   * @param {RightTrackDB} db The Right Track DB used to query GTFS data from
   * @param {Stop} origin The Origin Stop
   * @param {function} callback Callback function
   * @param {Error} callback.error Station Feed Error. The Error's message will be a pipe (|) separated string in the format of: Error Code|Error Type|Error Message that will be parsed out by the Right Track API Server into a more specific error Response.
   * @param {StationFeed} callback.feed The built StationFeed for the Stop
   */
  loadFeed(db, origin, callback) {
    return feed(db, origin, this.config, callback);
  }

}


// Export functions
module.exports = new LIRR();