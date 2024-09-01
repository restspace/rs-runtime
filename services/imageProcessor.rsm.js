export default {
  "name": "ImageProcessor",
  "description": "Process and transform images using ImageMagick",
  "moduleUrl": "./services/imageProcessor.ts",
  "apis": [ "transform" ],
  "configSchema": {
    "type": "object",
    "properties": {
      "maxWidth": { "type": "number", "default": 2000 },
      "maxHeight": { "type": "number", "default": 2000 },
      "maxQuality": { "type": "number", "default": 100 }
    },
    "required": [ "maxWidth", "maxHeight", "maxQuality" ]
  },
  "defaults": {
    "maxWidth": 2000,
    "maxHeight": 2000,
    "maxQuality": 100
  }
}