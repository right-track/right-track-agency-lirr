'use strict';

const RightTrackAgency = require('right-track-agency');
const feed = require('./feed.js');

const moduleDirectory = __dirname + "/../";


/**
 * RightTrackAgency implementation for the Long Island Rail Road
 *
 * See the Right Track Agency project ({@link https://github.com/right-track/right-track-agency})
 * for more information.
 * @class
 */
class LIRR extends RightTrackAgency {

  /**
   * Create a new RightTrackAgency for the Long Island Railroad
   */
  constructor() {
    super(moduleDirectory);
  }

  isFeedSupported() {
    return true;
  }

  loadFeed(db, origin, callback) {
    return feed(db, origin, this.config, callback);
  }

}


// Export functions
module.exports = new LIRR();