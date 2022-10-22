import { Message } from "rs-core/Message.ts";
import { Service } from "rs-core/Service.ts";
import { ILogReaderAdapter } from "rs-core/adapter/ILogReaderAdapter.ts";
import { ServiceContext } from "rs-core/ServiceContext.ts";

const service = new Service<ILogReaderAdapter>();

service.getPath("tail", async (msg: Message, { adapter }: ServiceContext<ILogReaderAdapter>) => {
	const nLines = parseInt(msg.url.servicePathElements?.[0]);
	if (isNaN(nLines)) return msg.setStatus(400, 'Last path element must be number of lines to read');
	const lines = await adapter.tail(nLines);
	return msg.setData(lines.join('\n'), 'text/plain');
});

service.getPath("search", async (msg: Message, { adapter }: ServiceContext<ILogReaderAdapter>) => {
	const nLines = parseInt(msg.url.servicePathElements?.[0]);
	const search = msg.url.servicePathElements?.[1];
	if (isNaN(nLines)) return msg.setStatus(400, 'Last path element must be number of lines to read');
	if (!search) return msg.setStatus(400, 'Must provide a string to search for');
	const lines = await adapter.search(nLines, search);
	return msg.setData(lines.join('\n'), 'text/plain');
});

export default service;