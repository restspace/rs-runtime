import { Message } from "rs-core/Message.ts";
import { Service } from "rs-core/Service.ts";
import { IServiceConfig } from "rs-core/IServiceConfig.ts";
import { ServiceContext } from "rs-core/ServiceContext.ts";
import {
  ImageMagick,
  initialize,
} from "https://deno.land/x/imagemagick_deno/mod.ts";

interface IImageProcessorConfig extends IServiceConfig {
  maxWidth: number;
  maxHeight: number;
  maxQuality: number;
}

const service = new Service<never, IImageProcessorConfig>();

service.initializer(async (context) => {
  try {
    await initialize();
  } catch (error) {
    context.logger.error("ImageMagick initialization error:", error);
  }
});

service.post(async (msg: Message, _context: ServiceContext<never>, config: IImageProcessorConfig) => {
  const imageData = await msg.data?.asArrayBuffer();
  if (!imageData) {
    return msg.setStatus(400).setData("No image data provided", "text/plain");
  }

  // Check for 'info' query parameter
  if (msg.url.query["info"]) {
    try {
      const info = await ImageMagick.read(new Uint8Array(imageData), (image) => {
        return {
          width: image.width,
          height: image.height,
          format: image.format,
          quality: image.quality,
          size: imageData.byteLength,
        };
      });

      return msg.setData(JSON.stringify(info), "application/json");
    } catch (error) {
      console.error("Image info retrieval error:", error);
      return msg.setStatus(500).setData("Error retrieving image info", "text/plain");
    }
  }

  const width = Number(msg.url.query["width"]?.[0]) || 0;
  const height = Number(msg.url.query["height"]?.[0]) || 0;
  const quality = Number(msg.url.query["quality"]?.[0]) || 0;

  // Validate input
  if (width > config.maxWidth || height > config.maxHeight || quality > config.maxQuality) {
    return msg.setStatus(400).setData("Invalid dimensions or quality", "text/plain");
  }

  try {
    const result = await ImageMagick.read(new Uint8Array(imageData), (image) => {
      if (width > 0 || height > 0) {
        image.resize(width, height);
      }
      
      if (quality > 0) {
        image.quality = quality;
      }

      const format = image.format;

      return image.write(format, (data) => msg.setData(data, `image/${format.toLowerCase()}`));
    });

    return result;
  } catch (error) {
    console.error("Image processing error:", error);
    return msg.setStatus(500).setData("Error processing image", "text/plain");
  }
});

export default service;