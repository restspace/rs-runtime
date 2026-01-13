# Request Spec

A request spec is a simple syntax for defining how to call a url.

It looks like this:

```json
[ <method> [ <body json path> ] ] <url pattern>
```

The url pattern part of this is required. This is a normal url (which can be absolute to call a url outside the Restspace instance, or site-relative to call an internal service component). It can be augmented with substitution codes which patch into it parts of an ‘original’ url, this is called a [Path Pattern](https://www.notion.so/Path-Pattern-9ea2dc091c3949489c6c540ebea0352e?pvs=21).

The method is just the request method. By default this is POST. It can be GET, PUT, POST, PATCH, DELETE, HEAD or OPTIONS.

In a pipeline, generally the body of the incoming request is sent out to the next outgoing request. If the incoming request is JSON, you can optionally put a [JSON Path](https://www.notion.so/JSON-Path-38cca37a26e8455a928e687e12451249?pvs=21) here to select some part of the incoming JSON to send out.