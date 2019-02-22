'use strict';

const http = require('http');
const https = require('https');
const cache = require('memory-cache');
const parse = require('node-html-parser').parse;
const core = require('right-track-core');
const DateTime = core.utils.DateTime;
const Trip = core.gtfs.Trip;
const Route = core.gtfs.Route;
const Service = core.gtfs.Service;
const Agency = core.gtfs.Agency;

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
  let url = CONFIG.stationFeed.stationURL
    .replace("{{ORIGIN_ID}}", origin.statusId);


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

  // Set counters
  let count = 1;
  let done = 0;

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
    done = rows.length;
    for ( let i = 1; i < rows.length; i++ ) {
      let row = rows[i];
      let cells = row.querySelectorAll('td');

      // Get the data from the cells
      let time = cells[0].rawText.replace(/^\s+|\s+$/g, '');
      let shortName = cells[0].attributes.title;
      let destinationName = cells[1].rawText.replace(/^\s+|\s+$/g, '');
      let infoText = cells[2].rawText.replace(/^\s+|\s+$/g, '');
      let track = cells[3].rawText.replace(/^\s+|\s+$/g, '');

      // Parse Info into Status
      let statusText = "Scheduled";
      if ( infoText.indexOf("min") !== -1 ) {
        try {
          let now = DateTime.now();
          let departDT = DateTime.createFromTime(time, true);
          let estDepartsMin = parseInt(infoText.replace(" min", ""));
          let schedDepartsMin = Math.round((departDT.toTimestamp() - now.toTimestamp()) / 60000);
          let delta = estDepartsMin - schedDepartsMin;
          if ( delta > 1 ) {
            statusText = "Late " + delta + " min";
          }
          else {
            statusText = "On Time";
          }
        }
        catch (err) {}
      }
      else {
        statusText = infoText;
      }

      // Build the Departure
      try {
        _buildDeparture(db, origin, time, destinationName, track, statusText, rtData, function(departure) {

          // Add built departure to list
          if ( departure !== undefined ) {
            DEPARTURES.push(departure);
          }

          _finish();

        });
      }
      catch (err) {
        console.log("ERROR: Could not build departure " + time + " from " + origin.name + " to " + destinationName);
        console.error(err);
        _finish();
      }

    }

  }
  else {
    return callback();
  }


  function _finish() {
    // Return when all departures have been built
    count++;
    if ( count >= done ) {
      DEPARTURES.sort(Departure.sort);
      return callback(
        {
          updated: DateTime.now(),
          departures: DEPARTURES
        }
      );
    }
  }

}


/**
 * Build the Departure from the TrainTime information
 * @param {RightTrackDB} db The Right Track DB to query
 * @param {Stop} origin The origin Stop
 * @param {String} time The parsed TrainTime departure time
 * @param {String} destinationName The parsed TrainTime destination name
 * @param {String} track The parsed TrainTime track information
 * @param {String} statusText The parsed TrainTime status information
 * @param {Object[]} rtData GTFS RT Data
 * @param {function} callback Callback function(departure)
 * @private
 */
function _buildDeparture(db, origin, time, destinationName, track, statusText, rtData, callback) {

  // Create Date/Time from Departure
  let dep = undefined;
  try {
    dep = DateTime.createFromTime(time, true);
  }
  catch (err) {
    return callback();
  }

  // Parse Track
  if ( track === '--' ) {
    track = '';
  }

  // Parse the Delay Time
  let delay = 0;
  if ( statusText.toLowerCase().indexOf('min') !== -1 ) {
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

      // Unknown Trip
      if ( trip === undefined ) {
        trip = new Trip(
          "Unknown-" + dep.getTimeGTFS() + "-" + destination.id
        );
      }


      // See if there's a match in the GTFS-RT delays
      let gtfsDelay = undefined;
      if ( trip !== undefined && rtData !== undefined ) {

        // Get Trip from rtData
        if ( rtData.hasOwnProperty("trip_" + trip.id) ) {
          gtfsDelay = 0;
          let tripData = rtData["trip_" + trip.id];

          // Stop in rtData
          if ( tripData.hasOwnProperty("stop_" + origin.id) ) {
            gtfsDelay = tripData["stop_" + origin.id]
          }

          // Stop NOT in rtData
          else {
            let delays = []
            for ( let s in tripData ) {
                if ( tripData.hasOwnProperty(s) ) {
                    delays.push(tripData[s])
                }
            }
            if ( delays.length > 0 ) {
              gtfsDelay = delays[0];
            }
          }
        }


        // TrainTime says 'Left Station'
        if ( statusText.toLowerCase() === 'left station' ) {
          delay = 0;
        }

        // No GTFS RT data
        else if ( statusText == "" && gtfsDelay == undefined ) {
          statusText == "Scheduled";
        }
        else if ( statusText == "" && gtfsDelay == 0 ) {
          statusText = "On Time";
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


      // Add Delay Time to estimated departure
      let estDeparture = dep.clone();
      try {
        estDeparture = estDeparture.deltaMins(delay);
      }
      catch(err) {
        console.log("WARNING: Could not add " + delay + " mins to departure (" + dep.toString() + ")");
      }


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


      // Return departure, ignoring trains that 'left station' more than 5 minutes ago
      if ( statusText.toLowerCase() !== 'left station' || ( statusText.toLowerCase() === 'left station' && dep >= DateTime.now().deltaMins(-5) ) ) {
        return callback(departure);
      }
      else {
        return callback();
      }





    });

  });

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