
# streamline-require/lib/client/require
 
Client-side require script

* `id = module.id`  
  the `id` of the current module.
* `module = require(id)`  
  _requires_ a module synchronously.  
  `id` _must_ be a string literal.
* `module = require.async(id, _)`  
  _requires_ a module asynchronously.  
  `id` may be a variable or an expression.
* `require.localize(locale, _)`  
  updates localized resources on all modules
* `main = require.main`  
  return the main module
* `require.main(id)`  
  loads main module from HTML page.

# streamline-require/lib/server/require
 
Server-side require handler

Handles require requests coming from the client.

* `dispatcher = require.dispatcher(options)`  
  returns an HTTP request dispatcher that responds to requests
  issued by the client-side `require` script.  
  The dispatcher is called as `dispatcher(_, request, response)`
