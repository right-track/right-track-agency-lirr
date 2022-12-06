'use strict';

/**
 * LIRR Post-Compile Script
 * This script performs the LIRR-specific Database fixes
 * @param {Object} agencyOptions Agency DB-Build Options
 * @param {Object} db SQLite database
 * @param {function} log DB-Build Log functions
 * @param {Object} errors DB-Build Error functions
 * @param {function} callback Callback function()
 * @private
 */
function postCompile(agencyOptions, db, log, errors, callback) {

  // Perform post-compile if a compile was requested...
  if ( agencyOptions.compile === true ) {

    db.serialize(function() {
      db.exec("BEGIN TRANSACTION");

      // Set route agency
      console.log("    ... Setting agency id of routes");
      db.exec("UPDATE gtfs_routes SET agency_id=(SELECT agency_id FROM gtfs_agency);");

      // Update Route Long Names
      console.log("    ... Updating route names");
      db.exec("UPDATE gtfs_routes SET route_long_name='Babylon Branch' WHERE route_short_name='Babylon';");
      db.exec("UPDATE gtfs_routes SET route_long_name='Hempstead Branch' WHERE route_short_name='Hempstead';");
      db.exec("UPDATE gtfs_routes SET route_long_name='Oyster Bay Branch' WHERE route_short_name='Oyster Bay';");
      db.exec("UPDATE gtfs_routes SET route_long_name='Ronkonkoma Branch' WHERE route_short_name='Ronkonkoma';");
      db.exec("UPDATE gtfs_routes SET route_long_name='Montauk Branch' WHERE route_short_name='Montauk';");
      db.exec("UPDATE gtfs_routes SET route_long_name='Long Beach Branch' WHERE route_short_name='Long Beach';");
      db.exec("UPDATE gtfs_routes SET route_long_name='Far Rockaway Branch' WHERE route_short_name='Far Rockaway';");
      db.exec("UPDATE gtfs_routes SET route_long_name='West Hempstead Branch' WHERE route_short_name='West Hempstead';");
      db.exec("UPDATE gtfs_routes SET route_long_name='Port Washington Branch' WHERE route_short_name='Port Washington';");
      db.exec("UPDATE gtfs_routes SET route_long_name='Port Jefferson Branch' WHERE route_short_name='Port Jefferson';");
      db.exec("UPDATE gtfs_routes SET route_long_name='Belmont Branch' WHERE route_short_name='Belmont';");
      db.exec("UPDATE gtfs_routes SET route_long_name='City Terminal Zone' WHERE route_short_name='City Zone';");

      // Set direction descriptions
      console.log("    ... Setting direction descriptions");
      db.exec("UPDATE gtfs_directions SET description='Eastbound' WHERE direction_id=0;");
      db.exec("UPDATE gtfs_directions SET description='Westbound' WHERE direction_id=1;");

      // Set pickup and drop-off types to 0
      console.log("    ... Setting pickup / drop-off types");
      db.exec("UPDATE gtfs_stop_times SET pickup_type=0;");
      db.exec("UPDATE gtfs_stop_times SET drop_off_type=0;");

      // Update Trip Short Name
      console.log("    ... Updating trip short name");
      db.all("SELECT trip_id, trip_short_name FROM gtfs_trips;", function(err, rows) {
        _updateTrip(db, rows, 0, _finish);
      });
    });

  }

  /**
   * Update missing Trip Short Name of the specified Trip
   * @param  {RightTrackDB}   db   Right Track DB
   * @param  {Object[]}   rows     Array of DB Rows
   * @param  {int}        count    Row Counter
   * @param  {Function}   callback Callback function
   */
  function _updateTrip(db, rows, count, callback) {
    if ( count < rows.length ) {
      let short = rows[count].trip_short_name;
      let id = rows[count].trip_id;
      if ( !short || short === "" ) {
        let parts = id.split("_");
        short = parts[2];
        db.exec("UPDATE gtfs_trips SET trip_short_name='" + short + "' WHERE trip_id='" + id + "';", function() {
          _next();
        });
      }
      else {
        _next();
      }
    }
    else {
      return callback();
    }

    /**
     * Start processing the next trip
     * @private
     */
    function _next() {
      process.nextTick(function() {
        _updateTrip(db, rows, count+1, callback);
      });
    }
  }

  /**
   * Commit the changes and return with the callback
   * @private
   */
  function _finish() {
    db.exec("COMMIT", function() {
      return callback();
    });
  }

}


module.exports = postCompile;