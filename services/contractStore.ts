import { Service } from "rs-core/Service.ts";
import { IQueryAdapter } from "rs-core/adapter/IQueryAdapter.ts";
import { Message } from "rs-core/Message.ts";
import { ServiceContext } from "rs-core/ServiceContext.ts";
import { Url } from "rs-core/Url.ts";

const service = new Service<IQueryAdapter>();

interface FunctionInput {
	name: string;
	type: string;
}

interface FunctionAbi {
	name: string;
	type: string;
	inputs: FunctionInput[]
}

const inputsToProperties = (inputs: FunctionInput[]) => {
	const props = {} as Record<string, unknown>;
	inputs.forEach((i: FunctionInput) => {
		switch (i.type) {
			case "address":
				props[i.name] = { type: "string" };
				break;
			case "bytes32":
			case "bytes":
				props[i.name] = { type: "string" };
				break;
			case "bool":
				props[i.name] = { type: "boolean" };
				break;
			case "uint8":
			case "uint64":
				props[i.name] = { type: "number" };
				break;
		}
	});
	return props;
}

const abiToSchema = (functionAbi: FunctionAbi) => {
	const schema = {
		title: functionAbi.name,
		type: "object",
		properties: inputsToProperties(functionAbi.inputs)
	};
	return schema;
}

service.post(async (msg: Message, context: ServiceContext<IQueryAdapter>) => {
	const reqContract = msg.copy().setMethod("GET");
	const msgContract = await context.makeRequest(reqContract);
	if (!msgContract.ok) return msgContract;
	const contract = await msgContract.data!.asJson();
	if (!contract) return msg.setStatus(400, 'No contract');
	if (!contract.abi) return msg.setStatus(400, 'No abi on contract');
	if (!contract.address) return msg.setStatus(400, 'No address on contract');
	if (!contract.network) return msg.setStatus(400, 'No network on contract');

	// find the applicable url: the msgAbi location header tells you the url of the actual abi file
	// - the rest is the subpath of the url
	const contextUrl: Url = msg.url.copy();
	contextUrl.setSubpathFromUrl(msgContract.getHeader('location') || '');

	if (contextUrl.subPathElementCount === 0) return msg.setStatus(400, 'No function name');
	const functionName = contextUrl.subPathElements[0];
	const functionAbi = contract.abi.find((f: FunctionAbi) =>
		f.name === functionName
		&& f.type === 'function');
	if (!functionAbi) return msg.setStatus(400, 'No abi with that name');

	const operation = contextUrl.subPathElements[1];
	switch (operation) {
		case "schema":
			msg.setDataJson(abiToSchema(functionAbi));
			return msg;
	}

	return msg;
});

export default service;
