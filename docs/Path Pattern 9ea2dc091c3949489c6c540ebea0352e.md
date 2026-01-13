# Path Pattern

A path pattern is a syntax for substituting parts of a context url into a string describing another url. Substitution codes all start with `$` .

## Path Parts

Depending on the context, a url in Restspace may be possible to split into up to three parts:

- The Base Path which is the path to the current service
- The Service Path which is the part of the path to the item being requested on the current service which comes after the Base Path.
- Some services have items in a Store which can be accessed using their url plus an extra path part which can specify an operation to do on the item for instance.  This is set up as a Store with the `parentIfMissing` config set to true. This extra path part is the Sub Path.

## Substitutions

| $>0 | first element of the service path e.g. **my**/service/path |
| --- | --- |
| $>1 | second element of the service path e.g. my/**service**/path |
| $<0 | lastmost element (0 places in from the end) of the service path e.g. my/service/**path** |
| $<2 | third from last element (2 places in from end) of the service path e.g. my/**long**/service/path |
| $>1<0 | second element of the service path to the last inclusive e.g. my/**long/service/path** |
| $<2<1 | third-to-last to second-to-last elements of the service path inclusive e.g. my/**long/service**/path |
| $B<2<1 | same as above but for the Base Path |
| $S<2<1 | same as above but for the Sub Path |
| $P<2<1 | same as above but for the whole path of the url |
| $N<2<1 | same as above but for the name of the current message. This may well not be in path format, but if it is this will slice it up as before. |
| $* | the whole service path |
| $P* | the whole path of the url |
| $N* | the whole name of the current message |
| $$ | the whole url |
| $>2:(def) | the third element of the service path, or else ‘def’ if there is no third element. Similarly for $B, $S, $P and $N |
| $?(abc) | the value of the query string key ‘abc’ |
| $?* | the whole query string (minus ‘?’) |
| ${path} | the value or values at [JSON path](https://www.notion.so/JSON-Path-38cca37a26e8455a928e687e12451249?pvs=21) ‘path’ in the payload of the current message |
| ${$var} | the value of variable ‘$var’ in a pipeline |
| ${$var/path} | the value or values at [JSON path](https://www.notion.so/JSON-Path-38cca37a26e8455a928e687e12451249?pvs=21) ‘path’ in the structured value of variable ‘$var’ |