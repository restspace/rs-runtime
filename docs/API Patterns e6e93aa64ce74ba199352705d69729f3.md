# API Patterns

Restspace defines certain patterns for APIs. Every directory in the URLs managed by a Restspace service will conform to one of these patterns, and the pattern is discoverable by reading the directory information for the directory (see [Listing](https://www.notion.so/Listing-c5c479950200486fa32b4ed412210151?pvs=21)). This enables generic handling of APIs by external tools and the Admin interface.

These are the patterns:

- **Transform**
A Transform receives and sends data, having applied some operation to the data. A `POST` request is used to send and receive the data.
- **View**
A View sends data only. A `GET` request is used to get the data.
- **Operation**
An Operation receives data only and returns an empty response. A `POST` request is used to send the data.
- **Directory**
A Directory does not receive or send data itself, it exists only to contain other resources. It can only be listed by a `GET` request on the path terminated by slash (e.g. `/xyz/myresource/`)
- **Store**
A Store receives and sends data, in such a way that each resource persists the data sent to it. Sending data is done with a `PUT` or `POST` request and reading data with a `GET` request. A `POST` request returns the stored data, a `PUT` request does not.
- **StoreTransform**
A StoreTransform combines Store and Transform functionalities. It performs a Transform via a `POST` request, but the transform is dependent on a configuration or script stored at the same resource via a `PUT` request (and this configuration can be read with a `GET` request). For instance, a StoreTransform of HTML templates would let you save a template to a resource via a `PUT` request then send data to receive the filled in template via a `POST` request to the same url.
- **StoreView**
A StoreView operates like a StoreTransform except that you should post empty data in the `POST` request as like a view, no input is needed.
- **StoreOperation**
A StoreOperation is again like a StoreTransform except that an empty response is given to the `POST` request.
- **StoreDirectory**
A StoreDirectory is like a Store except that the data files are configuring multiple endpoints which exist in a subdirectory. This means when you list a StoreDirectory you get a subdirectory for each data file stored. An example would be the StoreTimer service where you write configuration files for timers to the root directory of the service (e.g. `/timers/timer01`, and then each timer has several endpoints (e.g. `/timers/timer01/start` .

You can discover what the pattern of an API directory is by listing the directory and using the `details` flag (see [Listing](https://www.notion.so/Listing-c5c479950200486fa32b4ed412210151?pvs=21))