
# Server-side require handler

Handles require requests coming from the client.

* `dispatcher = require.dispatcher(options)`  
  returns an HTTP request dispatcher that responds to requests
  issued by the client-side `require` script.  
  The dispatcher is called as `dispatcher(_, request, response)`
