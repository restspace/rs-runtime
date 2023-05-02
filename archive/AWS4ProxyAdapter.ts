import { IProxyAdapter } from "rs-core/adapter/IProxyAdapter.ts";
import { Message } from "rs-core/Message.ts";
import { resolvePathPatternWithUrl } from "rs-core/PathPattern.ts";
import { AdapterContext } from "rs-core/ServiceContext.ts";
import { S3Client } from "https://deno.land/x/aws_sdk@v3.32.0-1/client-s3/mod.ts";
import { Hash } from "https://jspm.dev/@aws-sdk/hash-node";
import { applyOrMap } from "rs-core/utility/utility.ts";

export interface AWS4ProxyAdapterProps {
    service: "s3";
    region: string;
    areStreamsHashed: boolean;
    applyChecksum: boolean;
    secretAccessKey: string;
    accessKeyId: string;
}

const maxCacheSize = 32;

const generatedHeaders = [ "authorization", "X-Amz-Date", "date" ];
const sha256Header = "x-amz-content-sha256";
const signatureHeader = "x-amz-signature";
const unsignedPayload = "UNSIGNED-PAYLOAD";
const alwaysUnsignableHeaders = {
    authorization: true,
    "cache-control": true,
    connection: true,
    expect: true,
    from: true,
    "keep-alive": true,
    "max-forwards": true,
    pragma: true,
    referer: true,
    te: true,
    trailer: true,
    "transfer-encoding": true,
    upgrade: true,
    "user-agent": true,
    "x-amzn-trace-id": true,
  };
const service = "s3";

const SHORT_TO_HEX: { [key: number]: string } = {};

for (let i = 0; i < 256; i++) {
  let encodedByte = i.toString(16).toLowerCase();
  if (encodedByte.length === 1) {
    encodedByte = `0${encodedByte}`;
  }

  SHORT_TO_HEX[i] = encodedByte;
}

export function toHex(bytesIn: Uint8Array | ArrayBuffer): string {
  let out = "";
  const bytes = bytesIn instanceof Uint8Array ? bytesIn : new Uint8Array(bytesIn);
  for (let i = 0; i < bytes.byteLength; i++) {
    out += SHORT_TO_HEX[bytes[i]];
  }

  return out;
}

export default class AWS4ProxyAdapter implements IProxyAdapter {

    constructor(public context: AdapterContext, public props: AWS4ProxyAdapterProps) {
    }

    async HMAC(key: string | Uint8Array, message: string | Uint8Array) {
        const g = (str: string) => new Uint8Array([...unescape(encodeURIComponent(str))].map(c => c.charCodeAt(0)));
        const k = typeof key === 'string' ? g(key) : key;
        const m = typeof message === 'string' ? g(message) : message;
        const c = await crypto.subtle.importKey('raw', k, { name: 'HMAC', hash: 'SHA-256' }, true, ['sign']);
        const s = await crypto.subtle.sign('HMAC', c, m);
        return new Uint8Array(s);
        //[...new Uint8Array(s)].map(b => b.toString(16).padStart(2, '0')).join('');
        //return btoa(String.fromCharCode(...new Uint8Array(s)));
    }

    getDate(): { longDate: string; shortDate: string } {
        const now = new Date();
        const longDate = now.toISOString().replace(/\.\d{3}Z$/, "Z").replace(/[\-:]/g, "");
        return {
          longDate,
          shortDate: longDate.substr(0, 8),
        };
      }
    
    createScope(shortDate: string): string {
        return `${shortDate}/${this.props.region}/${this.props.service}/aws4_request`;
    }

    async getPayloadHash(
        msg: Message
      ): Promise<string> {
        if (msg.getHeader(sha256Header)) return msg.getHeader(sha256Header);
      
        if (!msg.data) {
          return "e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855";
        } else if (!msg.data.isStream || this.props.areStreamsHashed) {
          const digest = await crypto.subtle.digest("SHA-256", (await msg.data.asArrayBuffer())!);
          return toHex(new Uint8Array(digest));
        }
      
        // As any defined body that is not a string or binary data is a stream, this
        // body is unsignable. Attempt to send the request with an unsigned payload,
        // which may or may not be accepted by the service.
        return unsignedPayload;
      }

    getCanonicalHeaders(headers: Record<string, string | string[]>,
        unsignableHeaders?: Set<string>,
        signableHeaders?: Set<string>
      ): Record<string, string | string[]> {
        const canonical: Record<string, string | string[]> = {};
        for (const headerName of Object.keys(headers)) {
          const canonicalHeaderName = headerName.toLowerCase();
          if (
            canonicalHeaderName in alwaysUnsignableHeaders ||
            unsignableHeaders?.has(canonicalHeaderName) ||
            /^proxy-/.test(canonicalHeaderName) ||
            /^sec-/.test(canonicalHeaderName)
          ) {
            if (!signableHeaders || (signableHeaders && !signableHeaders.has(canonicalHeaderName))) {
              continue;
            }
          }
      
          canonical[canonicalHeaderName] = applyOrMap(headers[headerName], (h: string) => h.trim().replace(/\s+/g, " "));
        }
      
        return canonical;
    }

    getCanonicalHeaderList = (headers: object): string => Object.keys(headers).sort().join(";");

    cacheQueue: Array<string> = [];
    signingKeyCache: Record<string, Uint8Array> = {};

    async getSigningKey(
        shortDate: string,
        region: string
      ): Promise<Uint8Array> {
        const credsHash = await this.HMAC(this.props.secretAccessKey, this.props.accessKeyId);

        const cacheKey = `${shortDate}:${region}:${service}:${toHex(credsHash)}`;
        if (cacheKey in this.signingKeyCache) {
          return this.signingKeyCache[cacheKey];
        }
      
        this.cacheQueue.push(cacheKey);
        while (this.cacheQueue.length > maxCacheSize) {
          delete this.signingKeyCache[this.cacheQueue.shift() as string];
        }
      
        let key: string | Uint8Array = `AWS4${this.props.secretAccessKey}`;
        for (const signable of [shortDate, region, service, "aws4_request"]) {
          key = await this.HMAC(key, signable);
        }
        return (this.signingKeyCache[cacheKey] = key as Uint8Array);
      }

    getCanonicalPath(msg: Message): string {
        const path = msg.url.toString();
        const doubleEncoded = encodeURIComponent(path.replace(/^\//, ""));
        return `/${doubleEncoded.replace(/%2F/g, "/")}`;
    }

    hexEncode = (c: string) => `%${c.charCodeAt(0).toString(16).toUpperCase()}`;

    escapeUri = (uri: string): string =>
      // AWS percent-encodes some extra non-standard characters in a URI
      encodeURIComponent(uri).replace(/[!'()*]/g, this.hexEncode);

    getCanonicalQuery(msg: Message): string {
      const query = msg.url.query;
      const keys: Array<string> = [];
      const serialized: { [key: string]: string } = {};
      for (const key of Object.keys(query).sort()) {
        if (key.toLowerCase() === signatureHeader) {
          continue;
        }
    
        keys.push(key);
        const value = query[key];
        if (value.length === 1) {
          serialized[key] = `${this.escapeUri(key)}=${this.escapeUri(value[0])}`;
        } else if (Array.isArray(value)) {
          serialized[key] = value
            .slice(0)
            .sort()
            .reduce(
              (encoded: Array<string>, value: string) => encoded.concat([`${this.escapeUri(key)}=${this.escapeUri(value)}`]),
              []
            )
            .join("&");
        }
      }
    
      return keys
        .map((key) => serialized[key])
        .filter((serialized) => serialized) // omit any falsy values
        .join("&");
    }

    createCanonicalRequest(request: Message, canonicalHeaders: Record<string, string | string[]>, payloadHash: string): string {
        const sortedHeaders = Object.keys(canonicalHeaders).sort();
        return `${request.method}
    ${this.getCanonicalPath(request)}
    ${this.getCanonicalQuery(request)}
    ${sortedHeaders.map((name) => `${name}:${canonicalHeaders[name]}`).join("\n")}
    
    ${sortedHeaders.join(";")}
    ${payloadHash}`;
    }
    
    private async createStringToSign(
        longDate: string,
        credentialScope: string,
        canonicalRequest: string
    ): Promise<string> {
        const hashedRequest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(canonicalRequest));
    
        return `AWS4-HMAC-SHA256
    ${longDate}
    ${credentialScope}
    ${toHex(hashedRequest)}`;
    }

    private async getSignature(
      longDate: string,
      credentialScope: string,
      keyPromise: Promise<Uint8Array>,
      canonicalRequest: string
    ): Promise<string> {
      const stringToSign = await this.createStringToSign(longDate, credentialScope, canonicalRequest);
      const hashedString = await this.HMAC(await keyPromise, stringToSign);

      return toHex(hashedString);
    }

    async buildMessage(msg: Message): Promise<Message> {
        for (const headerName of Object.keys(msg.headers)) {
            if (generatedHeaders.includes(headerName.toLowerCase())) {
              msg.removeHeader(headerName);
            }
          }
        const { longDate, shortDate } = this.getDate();
        const scope = this.createScope(shortDate);
        const payloadHash = await this.getPayloadHash(msg);
        if (!msg.getHeader(sha256Header) && this.props.applyChecksum) {
            msg.setHeader(sha256Header, payloadHash);
          }

        const canonicalHeaders = this.getCanonicalHeaders(msg.headers);
        const signature = await this.getSignature(
          longDate,
          scope,
          this.getSigningKey(shortDate, this.props.region),
          this.createCanonicalRequest(msg, canonicalHeaders, payloadHash)
        );

        const authHeader = 'AWS4-HMAC-SHA256' +
        `Credential=${this.props.accessKeyId}/${scope}` +
        `SignedHeaders=${this.getCanonicalHeaderList(canonicalHeaders)}` +
        `Signature=${signature}`;

        msg.setHeader('Authorization', authHeader);
        msg.setHeader('X-Amz-Date', longDate);

        return msg;
    }
}