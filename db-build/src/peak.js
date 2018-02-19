'use strict';

const path = require('path');
const fs = require('fs');
const readline = require('readline');
const DateTime = require('right-track-core').utils.DateTime;


// List of City Terminal Zone Stop IDs
const TERM_IDs = ['8', '12', '1', '2', '15'];

// List of Holidays with No Peak Service
const HOLIDAYS_TABLE = '../rt/rt_holidays.csv';
const HOLIDAYS = [];

// Set Time Seconds
const SIX_AM = 21600;   // 6:00 AM
const TEN_AM = 36000;   // 10:00 AM
const FOUR_PM = 57600;  // 4:00 PM
const EIGHT_PM = 72000; // 8:00 PM


/**
 * Determine the Peak Status of the specified Trip
 * @param {Object} db SQLite Database
 * @param {string} tripId The GTFS Trip ID
 * @param {function} callback Callback function
 * @param {int} callback.peak Trip peak status
 */
function peak(db, tripId, callback) {

  // Read the Holidays from the Holidays Table
  _readHolidays(function() {

    // Check if Trip Stops at a Terminal
    _tripStopsAtTerm(db, tripId, function(stopsAtTerm) {

      // Stops at a Terminal...
      if ( stopsAtTerm ) {


        // Get the Days of the Week the Trip operates on
        _getDOWCode(db, tripId, function(dow) {

          // Operates on a Weekday...
          if ( dow > 0 ) {


            // Check if the Trip operates during peak times
            _operatesDuringPeak(db, tripId, function(peak) {

              // Could be Peak...
              if ( peak ) {
                return callback(dow);
              }

              // Does not operate during peak times...
              else {
                return callback(0);
              }

            });

          }

          // Does not operate on a Weekday...
          else {
            return callback(0);
          }

        });

      }

      // Does not Stop at a Terminal...
      else {
        return callback(0);
      }

    });

  });

}


/**
 * Check if the Trip stops at a Terminal Station
 * @param db SQLite Database
 * @param tripId GTFS Trip ID
 * @param callback Callback function(boolean)
 * @private
 */
function _tripStopsAtTerm(db, tripId, callback) {

  // Build Select Statement
  let select = "SELECT COUNT(stop_id) AS count FROM gtfs_stop_times " +
    "WHERE trip_id='" + tripId + "' AND stop_id IN ('" + TERM_IDs.join("', '") + "');";

  // Run Query
  db.get(select, function(err, row) {
    return callback(row && row.count && row.count > 0);
  });

}



/**
 * Check which Days of the Week the Trip operates on
 * @param {object} db SQLite Database
 * @param {string} tripId GTFS Trip ID
 * @param {function} callback Callback function(int)
 * @param {int} callback.weekday
 *    0 = just weekend
 *    1 = just weekday
 *    2 = mixed weekend and weekday
 * @private
 */
function _getDOWCode(db, tripId, callback) {

  // DOW Flags
  let weekday = false;
  let weekend = false;

  // Check default weekday status
  let select = "SELECT monday, tuesday, wednesday, thursday, friday, saturday, sunday " +
    "FROM gtfs_calendar WHERE service_id = " +
    "(SELECT service_id FROM gtfs_trips WHERE trip_id = '" + tripId + "');";

  // Run Query
  db.get(select, function(err, row) {
    if ( err ) {
      return _finish();
    }

    // Check Default Weekday
    if ( row ) {
      if ( row.monday === 1 || row.tuesday === 1 || row.wednesday === 1 ||
        row.thursday === 1 || row.friday === 1 ) {
        weekday = true;
      }
      if ( row.saturday === 1 || row.sunday === 1  ) {
        weekend = true;
      }
    }


    // Get Service Exceptions
    select = "SELECT date FROM gtfs_calendar_dates " +
      "WHERE exception_type = 1 AND service_id = " +
      "(SELECT service_id FROM gtfs_trips WHERE trip_id = '" + tripId + "');";

    // Run Query
    db.all(select, function(err, rows) {
      if ( err ) {
        return _finish();
      }

      // Parse the dates
      for ( let i = 0; i < rows.length; i++ ) {
        let date = rows[i].date;

        // Skip Holidays
        if ( !HOLIDAYS.includes(date) ) {
          let dow = DateTime.createFromDate(date).getDateDOW();
          if ( dow === "saturday" || dow === "sunday" ) {
            weekend = true;
          }
          else {
            weekday = true;
          }
        }

      }

      // Return the weekday state
      return _finish();

    });

  });


  /**
   * Return the DOW Code
   * @private
   */
  function _finish() {
    if ( weekday && weekend ) {
      return callback(2);
    }
    else if ( weekday && !weekend ) {
      return callback(1);
    }
    else if ( weekend && !weekday ) {
      return callback(0);
    }
    else {
      return callback(-1);
    }
  }

}



/**
 * Determine if the Trip operates during Peak times
 * @param db SQlite Database
 * @param tripId GTFS Trip ID
 * @param callback Callback function(boolean)
 * @private
 */
function _operatesDuringPeak(db, tripId, callback) {

  // Get Grand Central Info
  let select = "SELECT arrival_time, departure_time, direction_id " +
    "FROM gtfs_stop_times " +
    "INNER JOIN gtfs_trips ON gtfs_trips.trip_id = gtfs_stop_times.trip_id " +
    "WHERE gtfs_stop_times.trip_id = '" + tripId + "' " +
    "AND stop_id IN ('" + TERM_IDs.join("', '") + "');";

  // Run Query
  db.all(select, function(err, rows) {
    if ( err ) {
      return callback(false);
    }

    // Parse Each Set of Arrival/Departure Times
    for ( let i = 0; i < rows.length; i++ ) {

      // Set values
      let arrivalTime = rows[i].arrival_time;
      let departureTime = rows[i].departure_time;
      let direction = rows[i].direction_id;


      // INBOUND TRIPS
      if ( direction === 1 ) {
        let arrival = DateTime.createFromTime(arrivalTime).getTimeSeconds();

        // Peak: Arrival time between 6 and 10 AM
        if ( arrival >= SIX_AM && arrival <= TEN_AM ) {
          return callback(true);
        }

      }

      // OUTBOUND TRIPS
      else if ( direction === 0 ) {
        let departure = DateTime.createFromTime(departureTime).getTimeSeconds();

        // Peak: Departure between 4 and 8 PM
        if ( departure >= FOUR_PM && departure <= EIGHT_PM ) {
          return callback(true);
        }

      }

    }

    // Did not find a peak hour stop
    return callback(false);

  });

}




/**
 * Parse the Holidays file and add Holidays that do not have
 * peak service to the Holidays list
 * @param callback
 * @private
 */
function _readHolidays(callback) {

  // Full Location to file
  let location = path.normalize(__dirname + '/' + HOLIDAYS_TABLE);

  // File Exists...
  if ( fs.existsSync(location) ) {

    // File headers
    let headers = [];

    let lineReader = readline.createInterface({
      input: fs.createReadStream(location)
    });

    lineReader.on('line', function (line) {
      let values = line.split(',');
      if ( headers.length === 0 ) {
        headers = values;
      }
      else if ( values.length === headers.length ) {
        let params = {};
        for ( let i = 0; i < values.length; i++ ) {
          params[headers[i]] = values[i];
        }

        // Add Holidays no peak service
        if ( parseInt(params.peak) === 0 ) {
          HOLIDAYS.push(parseInt(params.date));
        }

      }
    });

    lineReader.on('close', function() {
      _finish();
    });

  }

  // File Does Not Exist...
  else {
    _finish();
  }


  function _finish() {
    return callback();
  }

}



module.exports = peak;