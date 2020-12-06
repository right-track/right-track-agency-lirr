'use strict';

const http = require('http');
const https = require('https');
const URL = require('url');
const cache = require('memory-cache');
const core = require('right-track-core');
const DateTime = core.utils.DateTime;

const SF = require('right-track-agency/src/StationFeed');
const StationFeed = SF.StationFeed;
const Departure = SF.StationFeedDeparture;
const Status = SF.StationFeedDepartureStatus;


// Amount of time (ms) to keep cached data
let CACHE_TIME = 60*1000;

// Amount of time (ms) for download to timeout
let DOWNLOAD_TIMEOUT = 4*1000;

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

      // Check to make sure the feed updated date/time is set
      if ( feed === undefined ) {
        return callback(
          new Error('5003|Could Not Parse Station Data|The LIRR TrainTime website did not return a valid response. Please try again later.')
        );
      }

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

  // Last Update Date/Time
  let lastUpdated = undefined;

  // Get the Origin's TrainTime Page
  _getTrainTimeData(db, origin, rtData, _build);


  // Parse the returned data for the origin --> stop pair
  function _build(data) {

    let departures = [];

    // Parse returned data
    if ( data !== undefined ) {

      // Combine the data
      let updated = data.updated;
      departures = data.departures;

      // Get most recent updated date
      if ( lastUpdated === undefined ||
        ( updated.getDateInt() > lastUpdated.getDateInt() || updated.getTimeSeconds() > lastUpdated.getTimeSeconds() ) ) {
        lastUpdated = updated;
      }

    }

    // Return all of the data once all requests have finished
    _finish(departures);
    
  }


  // Build the Station Feed to Return
  function _finish(departures) {

    // Sort the combined departures
    departures.sort(Departure.sort);

    // Return Station Feed
    if ( departures.length > 0 && lastUpdated !== undefined ) {
      return callback(new StationFeed(origin, lastUpdated, departures));
    }
    else {
      return callback();
    }

  }

}


/**
 * Get the Train Time Data for the specified origin --> destination Stops
 * @param {RightTrackDB} db The Right Track DB to query GTFS data from
 * @param {Stop} origin Origin Stop
 * @param {Object[]} rtData GTFS RT Data
 * @param {function} callback Callback function(data)
 * @private
 */
function _getTrainTimeData(db, origin, rtData, callback) {

  // Check cache for Train Time Data
  let data = cache.get(origin.statusId);
  if ( data !== null ) {
    return callback(data);
  }

  // Update Train Time Data from source
  _downloadTrainTime(db, origin, rtData, function(data) {

    // Add Data to Cache
    cache.put(
      origin.statusId,
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
 * @param {Object[]} rtData GTFS RT Data
 * @param {function} callback Callback function(data)
 * @private
 */
function _downloadTrainTime(db, origin, rtData, callback) {
  let url = CONFIG.stationFeed.station.url
    .replace("{{ORIGIN_ID}}", origin.statusId);
  let headers = CONFIG.stationFeed.station.headers;

  // Download the Train Time Data
  _download(url, headers, function(data) {

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

  // List of parsed departures and processing flags
  let departures = [];
  let count = 0;
  let total = 0;

  // Parse into JSON
  try {
    data = JSON.parse(data);
    total = Array.isArray(data) ? data.length : 0;
    if ( total === 0 ) {
      return callback();
    }

    // Parse each train
    for ( let i = 0; i < data.length; i++ ) {
      let d = data[i];
      
      // Get departure properties
      let departure_date = parseInt(d.run_date.replace(/-/g, ""));
      let dest_code = d.stops[d.stops.length-1];
      let train_num = d.train_num;

      // Get the matching trip by its short name
      core.query.trips.getTripByShortName(db, train_num, departure_date, function(err, trip) {
        
        // Depature object to build
        let departure = undefined;
        
        // Only build departure if the trip was found...
        if ( trip ) {

          // Get the departure DateTime for the origin stop
          let departure_dt = undefined;
          for ( let i = 0; i < trip.stopTimes.length; i++ ) {
            if ( trip.stopTimes[i].stop.id === origin.id ) {
              departure_dt = trip.stopTimes[i].departure;
            }
          }

          // Get the destination stop
          let destination = trip.stopTimes[trip.stopTimes.length-1].stop;

          // Only continue if the scheduled destination is the same as the TrainTime one
          if ( destination.statusId === dest_code ) {
            
            // Get status properties
            let delay = d.status.opt && d.status.otp < 0 ? -1*Math.ceil(d.status.otp/60) : 0;
            let status_label = "On Time";
            if ( d.status.held ) status_label = "HELD";
            if ( d.status.cancelled ) status_label = "CANCELLED";
            if ( delay > 0 ) status_label = "Late " + delay;
            let est_departure_dt = departure_dt.deltaMins(delay);
            let track = d.sched_track;

            // Build the Status
            let status = new Status(status_label, delay, est_departure_dt, track);

            // Build the Departure
            departure = new Departure(departure_dt, destination, trip, status);

          }

          // Destinations Don't Match!
          else {
            console.log("WARNING: Destination mistmatch! [" + dest_code + " !== " + destination.name + "]");
          }

        }
        
        // Finish with the departure
        _finish(departure);

      });
    }
  }

  // Error parsing the train time response
  catch (exception) {
    console.log(exception);
    return callback();
  }

  /**
   * Return to the main callback with the parsed departures
   */
  function _finish(departure) {
    if ( departure ) departures.push(departure);
    count++;
    if ( count >= total ) {
      departures.sort(Departure.sort);
      return callback({
        updated: DateTime.now(),
        departures: departures
      });
    }
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
    cache.put('GTFS-RT', data, CACHE_TIME);
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
  let rtn = {}

  // Parse data as JSON
  try {
    data = JSON.parse(data);

    // Get Trip Entities
    if ( data.hasOwnProperty('data') ) {
      if ( data.data.hasOwnProperty('entity') ) {
        let ents = data.data.entity;

        // Parse each of the entities
        for ( let i = 0; i < ents.length; i++ ) {
          let ent = ents[i];

          // Get Trip Update
          if ( ent !== undefined && ent !== null ) {
            if ( ent.hasOwnProperty('trip_update') ) {
              let trip_update = ent.trip_update;

              // Get the Trip ID
              let trip_id = trip_update.trip.trip_id;
              rtn["trip_" + trip_id] = [];

              // Parse each stop's delay
              if ( trip_update.hasOwnProperty('stop_time_update') ) {
                for ( let j = 0; j < trip_update.stop_time_update.length; j++ ) {
                  
                  if ( trip_update.stop_time_update[j].hasOwnProperty('departure') ) {
                    let stop_id = trip_update.stop_time_update[j].stop_id;
                    let delay = trip_update.stop_time_update[j].departure.delay;
                    delay = delay / 60;
                    delay = Math.round(delay);
                    if ( delay < 0 ) delay = 0

                    // Add Trip to return object
                    rtn["trip_" + trip_id]["stop_" + stop_id] = delay
                  }

                }
              }

            }
          }

        }

      }
    }

  }
  catch(err) {
    console.log("Warning: Could not parse GTFS-RT Feed!");
  }

  // Return the parsed data
  return callback(rtn);
}





// ===== UTILITY FUNCTIONS ===== //


/**
 * Download the specified URL
 * @param {string} url URL to download
 * @param {Object} [headers] The headers to add to the request
 * @param callback Callback function accepting downloaded data
 * @private
 */
function _download(url, headers, callback) {
  if ( !callback ) {
    callback = headers;
    headers = {};
  }

  let u = URL.parse(url);
  let opts = {
    protocol: u.protocol,
    hostname: u.hostname,
    path: u.path,
    headers: headers
  }

  let scheme = http;
  if ( u.protocol === "https:" ) {
    scheme = https;
  }
  let data = '';
  let timedout = false;
  
  let request = scheme.get(opts, function(res) {
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