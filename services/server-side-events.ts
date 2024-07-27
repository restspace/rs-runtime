import { Service } from "rs-core/Service.ts";
import { IServiceConfig } from "rs-core/IServiceConfig.ts";
import { IDataAdapter } from "rs-core/adapter/IDataAdapter.ts";
import { BaseStateClass } from "rs-core/ServiceContext.ts";
import { OperationSpec, ViewSpec } from "rs-core/DirDescriptor.ts";
import { upTo } from "rs-core/utility/utility.ts";
import { MessageBody } from "rs-core/MessageBody.ts";

interface ISSEConfig extends IServiceConfig {

}

interface SSESession {
    id: string;
    transformStream: SSETransformStream;
    eventIdx: number;
}

interface StringBuffer {
  value: string;
}
interface Controller {
  value: TransformStreamDefaultController<Uint8Array> | null;
}

class SSETransformStream extends TransformStream<Uint8Array, Uint8Array> {
    buffer: StringBuffer;
    eventName: string | null;
    id: string | null;
    controller: Controller;
    enc: TextEncoder = new TextEncoder();

    constructor() {
      // Hold these references locally before calling super to avoid references to 'this'
      const _buffer = { value: '' } as StringBuffer;
      const _controller = { value: null } as Controller;
      const _enc = new TextEncoder();

      const transformer = {
        start: (controller: TransformStreamDefaultController<Uint8Array>) => {
          _controller.value = controller;
        },
        transform: (chunk: Uint8Array, controller: TransformStreamDefaultController<Uint8Array>) => {
          _buffer.value += new TextDecoder().decode(chunk);
          const parts = _buffer.value.split('\n');
          for (let i = 0; i < parts.length - 1; i++) {
            controller.enqueue(_enc.encode(`data: ${parts[i]}\n`));
          }
          _buffer.value = parts[parts.length - 1];
        },
        flush: (controller: TransformStreamDefaultController<Uint8Array>) => {
          if (_buffer.value.length > 0) {
            controller.enqueue(_enc.encode(`data: ${this.buffer}\n`));
          }
          controller.enqueue(_enc.encode("\n"));
        }
      } as Transformer;
  
      super(transformer);

      this.buffer = _buffer;
      this.controller = _controller;
  
      this.eventName = null;
      this.id = null;
    }
  
    write(chunk: Uint8Array) {
      this.buffer.value += new TextDecoder().decode(chunk);
      const parts = this.buffer.value.split('\n');
      for (let i = 0; i < parts.length - 1; i++) {
        this.controller.value!.enqueue(this.enc.encode(`data: ${parts[i]}\n`));
      }
      this.buffer.value = parts[parts.length - 1];
    }
  
    writeEventName(eventName: string) {
      this.controller.value!.enqueue(this.enc.encode(`event: ${eventName}\n`));
    }
  
    writeId(id: string) {
      this.controller.value!.enqueue(this.enc.encode(`id: ${id}\n`));
    }
  
    endEvent() {
      if (this.buffer.value.length > 0) {
        this.controller.value!.enqueue(this.enc.encode(`data: ${this.buffer.value}\n`));
        this.buffer.value = '';
      }
      this.controller.value!.enqueue(this.enc.encode("\n"));
    }
}

class SSEState extends BaseStateClass {
    sessions: Record<string, SSESession> = {}

    createSession(sessionId: string): SSESession {
        const transformStream = new SSETransformStream();
        if (!sessionId) sessionId = self.crypto.randomUUID();
        const session  = { transformStream, eventIdx: 0, id: sessionId };
        this.sessions[sessionId] = session;
        return session;
    }

    unload(_newState?: BaseStateClass | undefined): Promise<void> {
        return Promise.resolve();
    }
}

const sendEvent = async (session: SSESession, data: MessageBody, eventName?: string) => {
    try {
        if (eventName) session.transformStream.writeEventName(eventName);
        session.transformStream.writeId(`${session.id}-${session.eventIdx++}`);
        await data.asReadable()!.pipeTo(session.transformStream.writable, { preventClose: true });
        session.transformStream.endEvent();
    }
    catch (err) {
        console.error(`Error sending event: ${err}`);
    }
};

const service = new Service<IDataAdapter, ISSEConfig>();

service.initializer(async (context, config) => {
	await context.state(SSEState, context, config);
});

service.getPath('connect', async (msg, context, config) => {
    const state = await context.state(SSEState, context, config);
    let sessionId = msg.url.servicePathElements[0] || '';
    let session: SSESession;
    if (msg.headers['Last-Event-ID']) {
        sessionId = upTo(msg.headers['Last-Event-ID'] as string, '-');
        session = state.createSession(sessionId);
    } else if (!state.sessions[sessionId]) {
        session = state.createSession(sessionId);
    } else {
        session = state.sessions[sessionId];
    }
    msg.setData(session.transformStream.readable, 'text/event-stream');
    msg.setHeader('Cache-Control', 'no-cache');
    msg.setHeader('Connection', 'keep-alive');
    msg.setHeader('X-Restspace-Session-Id', session.id);

    context.registerAbortAction(msg, async () => {
      await session.transformStream.controller.value!.terminate();
      delete state.sessions[session.id];
    });

    setTimeout(() => sendEvent(session, MessageBody.fromString(session.id), 'connect'), 200);

    return msg.setStatus(200);
});
service.postPath('push', async (msg, context, config) => {
    const state = await context.state(SSEState, context, config);
    const sessionId = msg.url.servicePathElements[0] || '';
    const eventName = msg.url.servicePathElements[1] || '';

    if (!sessionId) return msg.setStatus(400, 'last url element should be a session ID');
    const session = state.sessions[sessionId];
    if (!session) return msg.setStatus(404, `No such session ${sessionId}`);
    if (!msg.data) return msg.setStatus(400, 'No data to push');

    await sendEvent(session, msg.data!.copy(), eventName);
    
    return msg.setStatus(200);
});

service.constantDirectory('/', {
    path: '/',
    paths: [ 
        [ 'connect', 0, { pattern: "view" } as ViewSpec ],
        [ 'push', 0, { pattern: "operation" } as OperationSpec ]
    ],
    spec: {
        pattern: 'directory'
    }
});

export default service;