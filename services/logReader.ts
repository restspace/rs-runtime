import { Message } from "rs-core/Message.ts";
import { Service } from "rs-core/Service.ts";
import { ILogReaderAdapter } from "rs-core/adapter/ILogReaderAdapter.ts";
import { ServiceContext } from "rs-core/ServiceContext.ts";
import { FileHandler } from "https://deno.land/std@0.185.0/log/handlers.ts";
import { ViewSpec } from "rs-core/DirDescriptor.ts";

const service = new Service<ILogReaderAdapter>();

service.getPath("tail", async (msg: Message, { adapter, logger }: ServiceContext<ILogReaderAdapter>) => {
	(logger.handlers[1] as FileHandler).flush();
	const nLines = parseInt(msg.url.servicePathElements?.[0]);
	if (isNaN(nLines)) return msg.setStatus(400, 'Last path element must be number of lines to read');
	const lines = await adapter.tail(nLines);
	return msg.setData(lines.join('\n'), 'text/plain');
});

service.getPath("json", async (msg: Message, { adapter, logger }: ServiceContext<ILogReaderAdapter>) => {
	(logger.handlers[1] as FileHandler).flush();
	const nLines = parseInt(msg.url.servicePathElements?.[0]);
	if (isNaN(nLines)) return msg.setStatus(400, 'Last path element must be number of lines to read');
	const lines = await adapter.tail(nLines);
	const json = lines.reduce((prev, line) => {
		const lineParts = line.split(' ').filter(p => !!p);
		const lineJson = {
			level: lineParts[0],
			timestamp: lineParts[1],
			request: lineParts[2],
			span: lineParts[3],
			user: lineParts[5],
			message: lineParts.slice(6).join(' ')
		};
		const lineEntry = {
			timestamp: lineJson.timestamp,
			level: lineJson.level,
			message: lineJson.message
		};

		if (prev[lineJson.request]) {
			if (prev[lineJson.request][lineJson.span]) {
				prev[lineJson.request][lineJson.span].push(lineEntry);
			} else {
				prev[lineJson.request][lineJson.span] = [ lineEntry ];
			}
		} else {
			prev[lineJson.request] = {
				[lineJson.span]: [ lineEntry ]
			};
		}
		return prev;
	}, {} as Record<string, Record<string, Record<string, string>[]>>);
	return msg.setDataJson(json);
});

service.getPath("search", async (msg: Message, { adapter, logger }: ServiceContext<ILogReaderAdapter>) => {
	(logger.handlers[1] as FileHandler).flush();
	const nLines = parseInt(msg.url.servicePathElements?.[0]);
	const search = msg.url.servicePathElements?.[1];
	if (isNaN(nLines)) return msg.setStatus(400, 'Last path element must be number of lines to read');
	if (!search) return msg.setStatus(400, 'Must provide a string to search for');
	const lines = await adapter.search(nLines, search);
	return msg.setData(lines.join('\n'), 'text/plain');
});

service.constantDirectory('/', {
    path: '/',
    paths: [ 
        [ 'tail', 0, { pattern: "view" } as ViewSpec ],
        [ 'json', 0, { pattern: "view" } as ViewSpec ],
        [ 'search', 0, { pattern: "view" } as ViewSpec ]
    ],
    spec: {
        pattern: 'directory'
    }
});

export default service;