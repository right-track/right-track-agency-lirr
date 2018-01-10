'use strict';

const http = require('http');
const https = require('https');
const cache = require('memory-cache');
const parse = require('node-html-parser').parse;
const core = require('right-track-core');

const DateTime = core.utils.DateTime;
const StationFeed = core.rt.StationFeed.StationFeed;
const Departure = core.rt.StationFeed.StationFeedDeparture;
const Status = core.rt.StationFeed.StationFeedDepartureStatus;


// Amount of time (ms) to keep cached data
let CACHE_TIME = 60*1000;

// Amount of time (ms) for download to timeout
let DOWNLOAD_TIMEOUT = 7*1000;

// Agency Configuration
let CONFIG = {};


/**
 * Get the requested Stop's `StationFeed`.  This function will load the agency's
 * real-time status sources and populate a `StationFeed` with `StationFeedDeparture`s
 * containing the real-time status information.
 * @param {RightTrackDB} db The Right Track DB to query GTFS data from
 * @param {Stop} origin Origin Stop
 * @param {Object} config Agency configuration
 * @param {function} callback Station Feed Callback
 * @private
 */
function feed(db, origin, config, callback) {

  // Set Agency Configuration
  CONFIG = config;

  // Make sure we have a valid status id
  if ( origin.statusId === '-1' ) {
    return callback(
      new Error('4007|Unsupported Station|The Stop does not support real-time status information.')
    );
  }

  // Get / Update GTFS-RT Information
  _getGTFSRT(function(rtData) {

    // Build Station Feed with Train Time data
    _getTrainTime(db, origin, rtData, function(feed) {

      // Return the Station Feed
      return callback(null, feed);

    });

  });

}



// ==== TRAIN TIME FUNCTIONS ==== //


/**
 * Get the Train Time Data and Build the Station Feed
 * @param {RightTrackDB} db The Right Track DB to query GTFS data from
 * @param {Stop} origin Origin Stop
 * @param {Object[]} rtData GTFS RT Data
 * @param {function} callback Callback function(feed)
 * @private
 */
function _getTrainTime(db, origin, rtData, callback) {
  let done = 0;
  let max = -1;

  // Combined parsed data to return
  let combined = [];
  let lastUpdated = undefined;

  // Get the next stops from the origin
  _getNextStops(db, origin, function(stops) {
    max = stops.length;

    // Parse each of the destination stops
    for ( let i = 0; i < stops.length; i++ ) {

      // Get the TT info for the origin --> stop pair
      _getTrainTimeData(db, origin, stops[i], rtData, _build);

    }

  });



  // Parse the returned data for the origin --> stop pair
  function _build(data) {
    done ++;

    // Parse returned data
    if ( data !== undefined ) {

      // Combine the data
      let updated = data.updated;
      let departures = data.departures;

      // Get most recent updated date
      if ( lastUpdated === undefined ||
        ( updated.getDateInt() > lastUpdated.getDateInt() || updated.getTimeSeconds() > lastUpdated.getTimeSeconds() ) ) {
        lastUpdated = updated;
      }

      // Add new departures to list
      for ( let i = 0; i < departures.length; i++ ) {
        let found = false;
        let departure = departures[i];
        for ( let j = 0; j < combined.length; j++ ) {
          let c = combined[j];
          if ( c.trip.id === departure.trip.id ) {
            found = true;
          }
        }
        if ( !found ) {
          combined.push(departure);
        }
      }

    }

    // Return all of the data once all requests have finished
    if ( done === max ) {
      _finish();
    }
  }


  // Build the Station Feed to Return
  function _finish() {

    // Sort the combined departures
    combined.sort(Departure.sort);

    // Return Station Feed
    return callback(new StationFeed(origin, lastUpdated, combined));

  }

}


/**
 * Get the Train Time Data for the specified origin --> destination Stops
 * @param {RightTrackDB} db The Right Track DB to query GTFS data from
 * @param {Stop} origin Origin Stop
 * @param {Stop} destination Destination Stop
 * @param {Object[]} rtData GTFS RT Data
 * @param {function} callback Callback function(data)
 * @private
 */
function _getTrainTimeData(db, origin, destination, rtData, callback) {

  // Check cache for Train Time Data
  let data = cache.get(origin.statusId + "-" + destination.statusId);
  if ( data !== null ) {
    return callback(data);
  }

  // Update Train Time Data from source
  _downloadTrainTime(db, origin, destination, rtData, function(data) {

    // Add Data to Cache
    cache.put(
      origin.statusId + "-" + destination.statusId,
      data,
      CACHE_TIME
    );

    // Return the data
    return callback(data);

  });

}


/**
 * Download fresh Train Time data for the origin --> destination Stops
 * @param {RightTrackDB} db The Right Track DB to query GTFS data from
 * @param {Stop} origin Origin Stop
 * @param {Stop} destination Destination Stop
 * @param {Object[]} rtData GTFS RT Data
 * @param {function} callback Callback function(data)
 * @private
 */
function _downloadTrainTime(db, origin, destination, rtData, callback) {
  let url = CONFIG.stationFeed.stationURL
    .replace("{{ORIGIN_ID}}", origin.statusId)
    .replace("{{DESTINATION_ID}}", destination.statusId);

  // Download the Train Time Data
  _download(url, function(data) {

    // Parse the Train Time Data
    _parseTrainTime(db, origin, data, rtData, function(parsed) {

      // Return the parsed data
      return callback(parsed);

    });

  });

}


/**
 * Parse the raw Train Time data
 * @param {RightTrackDB} db The Right Track DB to query GTFS data from
 * @param {Stop} origin Origin Stop
 * @param {string} data Raw Train Time data
 * @param {Object[]} rtData GTFS RT Data
 * @param {function} callback Callback function(data)
 * @private
 */
function _parseTrainTime(db, origin, data, rtData, callback) {

  // List of departures to return
  let DEPARTURES = [];

  // Make sure we got data
  if ( data === undefined ) {
    return callback();
  }

  // Parse the raw data
  let parsed = parse(data);

  // Get tables from page
  let tables = parsed.querySelectorAll('table');

  // Page has tables...
  if ( tables !== undefined && tables.length > 0 ) {

    // Get the first table
    let table = tables[0];

    // Get the table's rows
    let rows = table.querySelectorAll('tr');

    // Not enough rows
    if ( rows.length < 2 ) {
      return callback();
    }

    // Parse each row of the table, ignoring the header
    let count = 1;
    for ( let i = 1; i < rows.length; i++ ) {
      let row = rows[i];
      let cells = row.querySelectorAll('td');


      // Get the data from the cells
      let time = cells[0].rawText.replace(/^\s+|\s+$/g, '');
      let destinationName = cells[2].rawText.replace(/^\s+|\s+$/g, '');
      let track = cells[3].rawText.replace(/^\s+|\s+$/g, '');
      let statusText = cells[4].rawText.replace(/^\s+|\s+$/g, '');

      // Create Date/Time from Departure
      let dep = DateTime.createFromTime(time, true);

      // Parse Track
      if ( track === '--' ) {
        track = '';
      }

      // Parse the Delay Time
      let delay = 0;
      if ( statusText.toLowerCase().indexOf('late') !== -1 ) {
        try {
          let toParse = statusText;
          toParse = toParse.toLowerCase();
          toParse = toParse.replace('late', '');
          toParse = toParse.replace('\"', '');
          toParse = toParse.replace('min', '');
          delay = parseInt(toParse);

          if ( !isNaN(delay) ) {
            statusText = "Late " + delay;
          }
        }
        catch (err) {
          delay = 0;
          statusText = "Late";
        }
      }



      // Get Destination Stop from Destination Name
      core.query.stops.getStopByName(db, destinationName, function(err, destination) {


        // Destination not found, use name from table
        if ( destination === undefined ) {
          destination = new core.gtfs.Stop('', destinationName, 0, 0);
        }


        // Get the Departure Trip
        core.query.trips.getTripByDeparture(db, origin.id, destination.id, dep, function(err, trip) {


          // See if there's a match in the GTFS-RT delays
          if ( trip !== undefined && rtData !== undefined ) {
            for ( let i = 0; i < rtData.length; i++ ) {
              if ( rtData[i].trip_id === trip.id ) {
                let gtfsDelay = rtData[i].delay;

                // TrainTime says 'Left Station'
                if ( statusText.toLowerCase() === 'left station' ) {
                  delay = 0;
                }

                // No Delays, set status to On Time
                else if ( delay === 0 && gtfsDelay === 0 ) {
                  statusText = "On Time";
                }

                // Combine GTFS and TT Delay Information
                else if ( delay === 0 && gtfsDelay > 0 ) {
                  statusText = "Late " + gtfsDelay;
                  delay = gtfsDelay;
                }
                else if ( delay < gtfsDelay ) {
                  statusText = "Late " + delay + "-" + gtfsDelay;
                }
                else if ( gtfsDelay < delay ) {
                  statusText = "Late " + gtfsDelay + "-" + delay;
                  delay = gtfsDelay;
                }

              }
            }
          }



          // Add Delay Time to estimated departure
          let estDeparture = dep.clone().deltaMins(delay);


          // Build the Status
          let status = new Status(
            statusText,
            delay,
            estDeparture,
            track
          );

          // Build the Departure
          let departure = new Departure(
            dep,
            destination,
            trip,
            status
          );


          // Add to list of Departures, ignoring trains that 'left station' more than 5 minutes ago
          if ( statusText.toLowerCase() !== 'left station' || ( statusText.toLowerCase() === 'left station' && dep >= DateTime.now().deltaMins(-5) ) ) {
            DEPARTURES.push(departure);
          }


          // Return when all departures have been built
          count++;
          if ( count === rows.length ) {
            DEPARTURES.sort(Departure.sort);
            return callback(
              {
                updated: DateTime.now(),
                departures: DEPARTURES
              }
            );
          }


        });

      });

    }

  }
  else {
    return callback();
  }


}






// ==== GTFS RT FUNCTIONS ==== //


/**
 * Get the cached or fresh GTFS RT data
 *
 * {
 *    trip_id: delay_mins,
 *    ...
 * }
 * @param callback Callback function(parsed data)
 * @private
 */
function _getGTFSRT(callback) {

  // Check cache for GTFS RT data
  let data = cache.get('GTFS-RT');
  if ( data !== null ) {
    return callback(data);
  }

  // Update GTFS RT from source
  _updateGTFSRT(function(data) {
    if ( Object.keys(data).length > 0 ) {
      cache.put('GTFS-RT', data, CACHE_TIME);
    }
    return callback(data);
  });

}


/**
 * Update the GTFS RT Data
 * @param callback Callback function(parsed data)
 * @private
 */
function _updateGTFSRT(callback) {
  let api_key = CONFIG.stationFeed.gtfsrt.apiKey;
  let url = CONFIG.stationFeed.gtfsrt.url.replace('{{GTFS_RT_API_KEY}}', api_key);

  // Download the GTFS RT data
  _download(url, function(data) {

    // Parse the GTFS RT data
    _parseGTFSRT(data, function(parsed) {

      // Return the parsed data
      return callback(parsed);

    });

  });

}

/**
 * Parse the GTFS data into an Array:
 * [
 *   {
 *     trip_id: GTFS Trip Id,
 *     delay: delay in mins
 *   }
 *   ...
 * ]
 * @param data Raw GTFS RT data
 * @param callback Callback function(parsed data)
 * @private
 */
function _parseGTFSRT(data, callback) {
  // Parsed Data to Return
  let rtn = [];

  // Parse data as JSON
  data = JSON.parse(data);

  // Get Trip Entities
  if ( data.hasOwnProperty('FeedHeader') ) {
    if ( data.FeedHeader.hasOwnProperty('Entities') ) {
      let ents = data.FeedHeader.Entities;

      // Parse each of the entities
      for ( let i = 0; i < ents.length; i++ ) {
        let ent = ents[i];

        // Get Trip Update
        if ( ent.hasOwnProperty('FeedEntity') ) {
          if ( ent.FeedEntity.hasOwnProperty('TripUpdate') ) {
            let trip = ent.FeedEntity.TripUpdate;

            // Get the delay information for the trip
            let id = trip.TripDescriptor.trip_id;
            let delay = trip.TripDescriptor.StopTimeUpdates[0].StopTimeUpdate.Arrival.delay;
            delay = delay / 60;

            // Add Trip to return object
            rtn.push(
              {
                trip_id: id,
                delay: delay
              }
            );

          }
        }

      }

    }
  }

  // Return the parsed data
  return callback(rtn);
}





// ===== UTILITY FUNCTIONS ===== //


/**
 * Get all of the possible next stops from the specified stop
 * @param {RightTrackDB} db The Right Track DB to query GTFS data from
 * @param {Stop} stop The Origin Stop
 * @param {function} callback Callback Function(Stop[])
 * @private
 */
function _getNextStops(db, stop, callback) {

  // Get all next stops for both directions
  let stops = [];
  core.query.routegraph.getNextStops(db, stop.id, 0, function(err, rtn) {
    stops = stops.concat(rtn);
    core.query.routegraph.getNextStops(db, stop.id, 1, function(err, rtn) {
      stops = stops.concat(rtn);
      return callback(stops);
    });
  });

}


/**
 * Download the specified URL
 * @param {string} url URL to download
 * @param callback Callback function accepting downloaded data
 * @private
 */
function _download(url, callback) {
  let scheme = http;
  if ( url.indexOf('https://') !== -1 ) {
    scheme = https;
  }
  let data = '';
  let timedout = false;
  let request = scheme.get(url, function(res) {
    res.on('data', function(chunk) {
      data += chunk;
    });
    res.on('end', function() {
      callback(data);
    });
  });
  request.on('error', function(e) {
    if ( !timedout ) {
      console.warn('ERROR: Could not download ' + url);
      console.warn(e);
      callback(undefined);
    }
  });
  request.setTimeout(DOWNLOAD_TIMEOUT, function() {
    timedout = true;
    request.abort();
    console.warn('ERROR: Request to ' + url + ' timed out');
    callback(undefined);
  });
}



module.exports = feed;