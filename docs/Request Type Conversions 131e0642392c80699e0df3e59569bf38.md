# Request Type Conversions

Restspace categorises request body types i.e. mime types into 3 groups:

- Data (JSON is the standard data format, and JSON mime types will often include a schema reference)
- Text
- Binary

To enable the maximum flexibility of input handling, Restspace assumes a set of standard conversions between these types:

- For Data to Text: JSON is a text format so there is no change here
- For Text to Binary: UTF-8 encoding
- For Binary to Text: Base 64 encoding
- For Binary to Data: A single string of Base 64 encoding
- For Text to Data: A single string containing the text