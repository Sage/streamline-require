
# Client-side require script

* `id = module.id`  
  the `id` of the current module.
* `module = require(id)`  
  _requires_ a module synchronously.  
  `id` _must_ be a string literal.
* `module = require.async(id, _)`  
  _requires_ a module asynchronously.  
  `id` may be a variable or an expression.
* `module = require.shallow(id)`  
  _requires_ a module in shallow mode, without loading any 
  deeper dependencies from the required module's source.  
  `id` _must_ be a string literal.
* `require.localize(locale, _)`  
  updates localized resources on all modules
* `main = require.main`  
  return the main module
* `require.main(id)`  
  loads main module from HTML page.
