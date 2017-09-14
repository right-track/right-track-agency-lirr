Long Island Rail Road
=====================

This module is an implementation of a _right-track-agency_ used to 
extend the functionality of the **right-track-core** module.

### Features

Currently, this module provides the configuration variables for this 
agency to be used in the _Right Track Library_.

### Usage

#### Configuration

The module's ```config()``` function loads the agency's configuration 
variables.

```javascript
const agency = require("right-track-agency-lirr");
const config = agency.config();                         // load the default configuration  
``` 

If you need to override any variables in the default configuration, create a new 
json file and include any variable definitions to change.

```json
{
    "db_location": "/path/to/database.db"
}
```

Then, pass the location of the config file to ```config(location)```.

```javascript
const config = agency.config("/path/to/config.json")    // override config variables
```