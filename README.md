Long Island Rail Road
==========================

This module is an implementation of a _right-track-agency_ used to 
extend the functionality of the **right-track-core** module.

### Features

Currently, this module provides the configuration variables for this 
agency to be used in various projects in the _Right Track Library_.

### Configuration

#### Default Configuration

When the module is loaded via `require()`, the default configuration file (`agency.json` 
located in the module's root directory) is loaded.

```javascript
const agency = require("right-track-agency-lirr");   // loads the default configuration  
``` 

#### Custom Configuration

If you need to override any variables in the default configuration, create a new 
json file and include any variable definitions to change.

Any relative paths in the configuration file (such as the database location) will 
be loaded relative to the directory this configuration file is located in.

```json
{
    "db_location": "/path/to/database.db"
}
```

### Usage

#### Read Custom Configuration File

To load a custom configuration file, use the `read(location)` function.

A relative path passed as the location of the new config file will be loaded 
relative to the module's root directory.

```javascript
agency.read("/path/to/config.json");               // override config variables
```


#### Get Configuration Variables

Use the `get()` function to get the agency's configuration variables (including 
any merged in from an additional file via `read()`).

```javascript
let config = agency.get();
```

where `config` is an Object containing the agency's configuration.

```
{ 
    name: 'Long Island Rail Road',
    id: 'lirr',
    db_location: '/right-track/db/db_latest/lirr/database.db',
    db_archive_location: '/right-track/db/db_archive/lirr/',
    maintainer: { 
        name: 'David Waring',
        email: 'dev@davidwaring.net',
        website: 'https://www.davidwaring.net/' 
    } 
}
```