'use strict';

const getData = require('./gtfsrt.js');
const core = require('right-track-core');
const ServiceException = core.gtfs.ServiceException;
const Service = core.gtfs.Service;
const StopTime = core.gtfs.StopTime;
const Trip = core.gtfs.Trip;
const DateTime = core.utils.DateTime;
const StationFeed = core.classes.StationFeed.StationFeed;
const Departure = core.classes.StationFeed.StationFeedDeparture;
const Status = core.classes.StationFeed.StationFeedDepartureStatus;
const Position = core.classes.StationFeed.StationFeedDeparturePosition;


const DEPARTED_TIME = 5*60;       // Max time to display departed trains (5 min)
const MAX_DEPARTED_TIME = 10*60;  // Max time to display any train past est departure (10 min)
const MAX_TIME = 3*60*60;         // Max time to display future departures (3 hours)


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

  // Make sure we have a valid status id
  if ( origin.statusId === '-1' ) {
    return callback(
      new Error('4007|Unsupported Station|The Stop does not support real-time status information.')
    );
  }

  // Get the GTFS-RT Data
  getData(config, function(err, data) {
    if ( err ) return callback(err);

    // Build the feed for the requested stop
    _buildFeed(db, origin, data, function(err, feed) {
      if ( err ) return callback(err);

      // Return the feed
      return callback(null, feed);

    });
  });
}


/**
 * Build the Station Feed for the requested Stop
 * @param {RightTrackDB} db The Right Track DB to query GTFS data from
 * @param {Stop} origin Origin Stop
 * @param {Object} data GTFS-RT data, including stops and trips
 * @param {function} callback Callback function(err, feed)
 * @private
 */
function _buildFeed(db, origin, data, callback) {
  try {
    let updated = DateTime.createFromJSDate(new Date(data.updated));
    let stop_data = data.stops.hasOwnProperty(origin.id) ? data.stops[origin.id] : [];
    let trip_data = data.trips;

    // Build each of the departures
    let p = [];
    for ( let i = 0; i < stop_data.length; i++ ) {
      let departure = stop_data[i];
      let departure_trip = trip_data[departure.trip_id];
      p.push(_buildDeparture(db, origin, departure, departure_trip));
    }

    // Execute promises
    Promise.all(p).then(function(departures) {

      // Drop filtered departures
      let rtn = [];
      for ( let i = 0; i < departures.length; i++ ) {
        if ( departures[i] ) {
          rtn.push(departures[i]);
        }
      }

      // Build the feed
      rtn.sort(Departure.sort);
      let feed = new StationFeed(origin, updated, rtn);

      // Return the Feed
      return callback(null, feed);

    });
  }
  catch (err) {
    return callback(new Error('5003|Could not build MNR Station Feed|' + err));
  }
}


/**
 * Build a StationFeedDeparture with the specified stop and trip info
 * @param {RightTrackDB} db The Right Track DB to query GTFS data from
 * @param {Stop} origin Origin Stop
 * @param {Object} departure GTFS-RT stop data for the departure
 * @param {Object} departure_trip GTFS-RT trip data for the departure
 * @returns {StationFeedDeparture} A SFDeparture or undefined
 * @private
 */
function _buildDeparture(db, origin, departure, departure_trip) {
  return new Promise(function(resolve, reject) {
    try {

      // Get the Estimated Departure
      let estDepartureDT = departure.departure || departure.arrival ? 
        DateTime.createFromJSDate(new Date(departure.departure || departure.arrival)) : 
        undefined;

      // Get the Destination Stop
      core.query.stops.getStop(db, departure_trip.destination, function(err, destination) {

        // Get the Trip (from the DB or built from the data)
        _getTrip(db, departure, departure_trip, function(trip, unscheduled) {

          // Get Vehicle Stop
          let vehicle_stop_id = departure_trip?.vehicle?.stop || "";
          core.query.stops.getStop(db, vehicle_stop_id, function(err, vehicle_stop) {

            // Get Vehicle Position
            let vehicle_lat = departure_trip?.vehicle?.lat;
            let vehicle_lon = departure_trip?.vehicle?.lon;
            let vehicle_status = departure_trip?.vehicle?.status;
            let vehicle_updated = departure_trip?.vehicle?.updated ? 
              DateTime.createFromJSDate(new Date(departure_trip.vehicle.updated)) : 
              DateTime.now();

            // Set Vehicle Description, based on status
            let vehicle_description;
            if ( vehicle_stop ) {
              if ( vehicle_status === 0 ) {
                vehicle_description = "Arriving at " + vehicle_stop.name;
              }
              else if ( vehicle_status === 1 ) {
                vehicle_description = "Stopped at " + vehicle_stop.name;
              }
              else if ( vehicle_status === 2 ) {
                vehicle_description = "In transit to " + vehicle_stop.name;
              }
            }

            // Get the delay between scheduled stop time and estimated stop time
            let schedDepartureDT = estDepartureDT ? estDepartureDT.clone() : undefined;
            if ( trip && trip.hasStopTime(origin) ) {
              let stopTime = trip.getStopTime(origin);
              schedDepartureDT = stopTime.departure;
            }
            let delay = estDepartureDT && schedDepartureDT ? 
              estDepartureDT.getTimeSeconds() - schedDepartureDT.getTimeSeconds() :
              0;

            // Get Origin and Vehicle Stop Sequences
            let origin_stop_sequence = trip ? trip.getStopTime(origin).stopSequence : undefined;
            let vehicle_stop_sequence = vehicle_stop && trip ? trip.getStopTime(vehicle_stop).stopSequence : undefined;

            // Set the Status Text
            let statusText = departure.status;
            if ( !statusText && vehicle_stop_id === origin.id && vehicle_status === 0 ) {
              statusText = "Arriving";
            }
            else if ( !statusText && vehicle_stop_id === origin.id && vehicle_status === 1 ) {
              statusText = "Arrived";
            }
            else if ( !statusText && vehicle_stop_sequence && origin_stop_sequence && vehicle_stop_sequence > origin_stop_sequence ) {
              statusText = "Departed";
            }
            else if ( !statusText && delay < 60 ) {
              statusText = "On Time";
            }
            else {
              statusText = `Late ${Math.floor(delay/60)}m`;
            }

            // Set remarks
            let remarks;
            if ( unscheduled ) {
              remarks = "Unscheduled Trip";
            }

            // FILTER DEPARTURES
            // Drop recently departed Trips or Trips too far in the future
            let now_s = new Date().getTime();
            let dep_s = departure.departure ? departure.departure : departure.arrival;
            let delta = (dep_s - now_s)/1000;
            if ( delta < (-1*MAX_DEPARTED_TIME) ) {
              return resolve();
            }
            if ( (statusText === "Departed" || (statusText === "Arrived" && origin.id === destination.id)) && delta < (-1*DEPARTED_TIME) ) {
              return resolve();
            }
            else if ( delta > (MAX_TIME) ) {
              return resolve();
            }

            // Build Position
            let position;
            if ( vehicle_lat && vehicle_lon && vehicle_description ) {
              position = new Position(
                vehicle_lat,
                vehicle_lon,
                vehicle_description,
                vehicle_updated
              );
            }

            // Build Status
            let status = new Status(
              statusText,
              delay > 60 ? delay : 0,
              estDepartureDT || schedDepartureDT,
              {
                track: departure.track,
                scheduled: statusText === "Scheduled"
              },
              remarks
            );

            // Build the Departure
            let rtn = new Departure(
              schedDepartureDT,
              destination,
              trip,
              status,
              position
            );

            return resolve(rtn);

          });
        });
      });
    }
    catch (err) {
      console.log("ERROR: Could not build departure for " + origin.name);
      console.log(departure);
      console.log(err);
      resolve();
    }
  });
}

/**
 * Get the Trip for the departure, either the scheduled trip from the 
 * database or (if not found in the DB) build a Trip with the GTFS-RT data
 * @param {RightTrackDB} db The Right Track DB to query GTFS data from
 * @param {Object} departure GTFS-RT stop data for the departure
 * @param {Object} departure_trip GTFS-RT trip data from the departure
 * @param {Function} callback Callback function(trip, unscheduled)
 * @private
 */
function _getTrip(db, departure, departure_trip, callback) {
  let count = 0;
  let max = departure_trip.stops.length;

  // Trip Metadata
  let se;         // ServiceException
  let s;          // Service
  let r;          // Route
  let sts = [];   // List of StopTimes

  // First, try to find a scheduled trip in the DB
  core.query.trips.getTrip(db, departure.trip_id, departure_trip.date, function(err, trip) {

    // Return the scheduled trip
    if ( trip ) {
      return callback(trip);
    }

    // Build Trip with GTFS-RT Data

    // Get the Trip's Route
    core.query.routes.getRoute(db, departure_trip.route, function(err, route) {
      r = route;

      // Set the Trip's Service
      se = new ServiceException("SE-" + departure_trip.id, departure_trip.date, ServiceException.SERVICE_ADDED);
      s = new Service("S-" + departure_trip.trip_id, 0, 0, 0, 0, 0, 0, 0, departure_trip.date, departure_trip.date, [se]);

      // Build the StopTimes
      for ( let i = 0; i < departure_trip.stops.length; i++ ) {
        let stop_info = departure_trip.stops[i];

        // Get the Stop
        core.query.stops.getStop(db, stop_info.id, function(err, stop) {
          if ( stop && (stop_info.arrival || stop_info.departure) ) {
            let arrDT = DateTime.createFromJSDate(new Date(stop_info.arrival ? stop_info.arrival : stop_info.departure));
            let depDT = DateTime.createFromJSDate(new Date(stop_info.departure ? stop_info.departure : stop_info.arrival));

            // Build the StopTime
            let st = new StopTime(stop, arrDT.getTimeGTFS(), depDT.getTimeGTFS(), stop_info.sequence, {date: departure_trip.date});
            sts.push(st);
          }
          _finish();
        });
      }
    });
  });

  function _finish() {
    count++;
    if ( count >= max ) {

      // Build the Trip
      let trip = new Trip(departure_trip.id, r, s, sts, { directionId: departure_trip.direction });
      return callback(trip, true);

    }
  }

}

// MODULE EXPORTS
module.exports = feed;