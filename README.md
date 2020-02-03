Long Island Rail Road
=====================

**node module:** [right-track-agency-lirr](https://www.npmjs.com/package/right-track-agency-lirr)  
**GitHub repo:** [right-track/right-track-agency-lirr](https://github.com/right-track/right-track-agency-lirr)

---

This module is an implementation of a [right-track-agency](https://github.com/right-track/right-track-agency) 
used to add agency-specific configuration and functionality to various [Right Track Projects](https://github.com/right-track).

### Features

This module provides the following agency-specific information:

* Build Scripts for creating a Right Track Database for LIRR (using the [right-track-db-build](https://github.com/right-track/right-track-db-build) project)
* The latest compiled Right Track Database for LIRR (located in the ./static/db directory)
* Agency configuration properties to be used in various _Right Track_ projects
* The functions to generate a LIRR Station Feed for the [right-track-server](https://github.com/right-track/right-track-server)

**NOTE:** Archived schedule databases are no longer stored in the git repository due to their storage size.  Archived LIRR  
databases can be found in [this shared Google Drive folder](https://drive.google.com/drive/folders/1UMMesQair-7aRoIgejenJ7QhfI3blWj-).

### Documentation

Documentation can be found in the **/doc/** directory of this repository 
or online at [https://docs.righttrack.io/right-track-agency-lirr](https://docs.righttrack.io/right-track-agency-lirr).

Additional documentation about the `RightTrackAgency` class can be found in the 
[right-track-agency](https://github.com/right-track/right-track-agency) project 
and online at [https://docs.righttrack.io/right-track-agency](https://docs.righttrack.io/right-track-agency).

### Usage

On `require` the module will return a new instance of the **Long Island Rail Road**
implementation of a `RightTrackAgency` Class.

To get the agency configuration properties:
```javascript
const LIRR = require('right-track-agency-lirr');

// Optionally load an additional configuration file
LIRR.readConfig('/path/to/config.json');

// Get the merged configuration
let config = LIRR.getConfig();
```

To get the real-time `StationFeed` for Jamaica Station:
```javascript
const core = require('right-track-core');
const RightTrackDB = require('right-track-db-sqlite3');
const LIRR = require('right-track-agency-lirr');

// Set up the Right Track DB for LIRR
let db = new RightTrackDB(LIRR);

// Get the Stop for Jamaica (id='15') by querying the RightTrackDB
core.query.stops.getStop(db, '15', function(err, stop) {

  // Load the StationFeed for Jamaica
  LIRR.loadFeed(db, stop, function(err, feed) {

    // Do something with the feed
    console.log(feed);

  });

});
```