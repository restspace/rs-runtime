import { Message } from "rs-core/Message.ts";
import { Service } from "rs-core/Service.ts";
import { IServiceConfig } from "rs-core/IServiceConfig.ts";
import { ServiceContext } from "rs-core/ServiceContext.ts";
import { Image } from "https://deno.land/x/imagescript@1.3.0/mod.ts";

interface IImageProcessorConfig extends IServiceConfig {
  maxWidth: number;
  maxHeight: number;
  maxQuality: number;
}

const service = new Service<never, IImageProcessorConfig>();

service.post(async (msg: Message, context: ServiceContext<never>, config: IImageProcessorConfig) => {
  const imageData = await msg.data?.asArrayBuffer();
  if (!imageData) {
    return msg.setStatus(400, "No image data provided");
  }
  let mime = msg.data!.mimeType;
  if (mime === "image/jpeg") mime = "image/jpg";
  if (!["image/jpg", "image/png"].includes(mime)) {
    return msg.setStatus(400, "Invalid image format, only jpg and png are supported");
  }

  const image = await Image.decode(new DataView(imageData));

  // Check for 'info' query parameter
  if (msg.url.query["info"]) {
    try {
      const info = {
        width: image.width,
        height: image.height,
        type: mime,
        size: imageData.byteLength,
      };

      return msg.setData(JSON.stringify(info), "application/json");
    } catch (error) {
      context.logger.error(`Image info retrieval error: ${JSON.stringify(error)}`);
      return msg.setStatus(500, "Error retrieving image info");
    }
  }

  const width = Number(msg.url.query["width"]?.[0] || 0) || Image.RESIZE_AUTO;
  const height = Number(msg.url.query["height"]?.[0] || 0) || Image.RESIZE_AUTO;
  const quality = Number(msg.url.query["quality"]?.[0] || 0) || undefined;

  // Validate input
  if (width > config.maxWidth || height > config.maxHeight || (quality || 0) > config.maxQuality) {
    return msg.setStatus(400, "Invalid dimensions or quality");
  }

  try {
      if (width > 0 || height > 0) {
        image.resize(width, height);
      }
      
      if (mime === "image/jpg") {
        const result = await image.encodeJPEG(quality);
        return msg.setData(result, "image/jpeg");
      } else {
        const result = await image.encode()
        return msg.setData(result, "image/png");
      }
  } catch (error) {
    context.logger.error(`Image processing error: ${JSON.stringify(error)}`);
    return msg.setStatus(500, "Error processing image");
  }
});

export default service;