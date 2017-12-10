'use strict';

/**
 * LIRR Post-Compile Script
 * This script performs the LIRR-specific Database fixes
 * @param {Object} agencyOptions Agency DB-Build Options
 * @param {Object} db SQLite database
 * @param {function} callback Callback function()
 * @private
 */
function postCompile(agencyOptions, db, callback) {

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

      // Set stop_url in gtfs_stops to 'http://lirr42.mta.info/stationInfo.php?id=[stop_id]'
      console.log("    ... Setting stop URLs");
      db.all("SELECT stop_id FROM gtfs_stops;", function(err, rows) {

        // Update Stop
        _updateStopUrl(db, rows, 0, function() {

          // Finish when all stops are updated
          db.exec("COMMIT", function() {
            return callback();
          });

        });

      });
    });

  }

}

/**
 * Update the specified Stop url
 * @param db RightTrackDB
 * @param rows Rows of Stops
 * @param count Stop counter
 * @param callback Stop callback function
 * @private
 */
function _updateStopUrl(db, rows, count, callback) {
  if ( count < rows.length ) {
    let id = rows[count].stop_id;
    let url = "http://lirr42.mta.info/stationInfo.php?id=" + id;
    db.exec("UPDATE gtfs_stops SET stop_url='" + url + "' WHERE stop_id='" + id + "';",
      function() {
        _updateStopUrl(db, rows, count+1, callback);
      }
    );
  }
  else {
    return callback();
  }
}


module.exports = postCompile;