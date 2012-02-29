## streamline-require

This package contains a small infrastructure to load streamline and regular JS modules from the browser. 
It applies the streamline transformation server side and caches the transformed files.
It also optimizes roundtrips between client and server: 
the _required_ module and all its dependencies are transferred in one message.
Also, dependencies that have already been transferred to the browser are not re-transferred 
when you require additional modules.

Note: the `lib/require` infrastructure does not handle all the subtleties of node's require logic but it handles enough to
support our applications (and it does it very efficiently).
It is provided _as is_ and contributions to improve it are welcome.

## Resources

The API is documented [here](https://github.com/Sage/streamlinejs/blob/master/API.md).  

For support and discussion, please join the [streamline.js Google Group](http://groups.google.com/group/streamlinejs).


## License

This work is licensed under the [MIT license](http://en.wikipedia.org/wiki/MIT_License).