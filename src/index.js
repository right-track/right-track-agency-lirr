'use strict';

const RightTrackAgency = require('right-track-agency');

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

}


// Export functions
module.exports = new LIRR();