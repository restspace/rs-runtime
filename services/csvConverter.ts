import { Service, ServiceFunction } from "rs-core/Service.ts";
import { readCSV } from "https://deno.land/x/csv/mod.ts";
import { readerFromStreamReader } from "std/streams/reader_from_stream_reader.ts";
import { IServiceConfig } from "rs-core/IServiceConfig.ts";
import { IAdapter } from "rs-core/adapter/IAdapter.ts";
import Ajv, { ValidateFunction } from "https://cdn.skypack.dev/ajv?dts";
import { BaseStateClass, SimpleServiceContext } from "rs-core/ServiceContext.ts";

export interface ICSVConverterConfig extends IServiceConfig {
	lineSchema: Record<string, unknown>;
	ignoreBlankLines?: boolean;
}

const service = new Service<IAdapter, ICSVConverterConfig>();

export class CSVState extends BaseStateClass {
	validate: ValidateFunction<unknown> | null = null;

	load(_context: SimpleServiceContext, config: ICSVConverterConfig) {
        const ajv = new Ajv({ strictSchema: false, allowUnionTypes: true });
		if (config.lineSchema) {
			this.validate = ajv.compile(config.lineSchema);
			_context.logger.info('TT Compiled validation func');
		}
		return Promise.resolve();
    }
}

type CSVMode = "validate" | "ndjson" | "json";

const csvToJson: (mode: CSVMode) => ServiceFunction<IAdapter, ICSVConverterConfig> = (mode: CSVMode) => async (msg, context, config) => {
	if (msg.getHeader('content-type') !== "text/csv") {
		return msg;
	}

	const readable = msg.data?.asReadable();
	if (!readable) return msg.setStatus(400, 'No data');
	const rdr = readerFromStreamReader(readable.getReader());
	const properties = config.lineSchema.properties as Record<string, Record<string, unknown>>;
	const required = (config.lineSchema.required as string[]) || [];
	const rowProps = Object.keys(properties);
	const errors = [] as string[];
	const warnings = [] as string[];

	const state = await context.state(CSVState, context, config);
	const validate = state.validate;
	const ignoreBlank = config.ignoreBlankLines === undefined ? true : config.ignoreBlankLines;

	let stream: TransformStream | null = null;
	let writer: WritableStreamDefaultWriter<any> | null = null;
	let writeString = (_: string) => {};
	if (mode !== "validate") {
		stream = new TransformStream();
		writer = stream.writable.getWriter();
		writeString = (data: string) => writer!.write(new TextEncoder().encode(data));
	}

	let rowIdx = 0;
	let blanks = 0;

	const process = async () => {
		try {
			if (mode === "json") {
				writeString("[");
			}

			for await (const row of readCSV(rdr)) {
				let idx = 0;
				let rowObj: Record<string, unknown> | null = {};
				for await (let cell of row) {
					cell = cell.trim();
					if (idx < rowProps.length) {
						const subschema = properties[rowProps[idx]];
						let val: any = null;

						const fieldRequired = required.includes(rowProps[idx]);
						if (cell === '' && !fieldRequired) {
							idx++;
							continue;
						}

						switch (subschema.type) {
							case "number":
								val = parseFloat(cell);
								if (isNaN(val)) {
									rowObj = null;
									if (mode === "validate") {
										errors.push(`row ${rowIdx} col ${idx}: ${cell} is not a number`);
									}
								}
								break;
							case "integer":
								val = parseInt(cell);
								if (isNaN(val)) {
									rowObj = null;
									if (mode === "validate") {
										errors.push(`row ${rowIdx} col ${idx}: ${cell} is not an integer`);
									}
								}
								break;
							case "boolean":
								val = cell.toLowerCase();
								if (val !== 'true' && val !== 'false') {
									rowObj = null;
									if (mode === "validate") {
										errors.push(`row ${rowIdx} col ${idx}: ${cell} is not true or false`);
									}
								} else {
									val = (val === 'true');
								}
								break;
							default:
								val = cell;
						}

						if (rowObj) rowObj[rowProps[idx]] = val;
					} else if (mode === "validate" && idx === rowProps.length) {
						warnings.push(`line ${rowIdx} too long (> ${rowProps.length} fields)`);
					}
					idx++;
				}

				const isBlank = rowObj && Object.keys(rowObj).length === 0;
				if (isBlank) blanks++;

				if (mode === "validate") {
					if (idx < rowProps.length) {
						warnings.push(`line ${rowIdx} too short (< ${rowProps.length} fields)`);
					}
					if (validate && rowObj && !validate(rowObj)) {
						const errorMsg = (validate.errors || []).map((e: any) => e.message).join('; ');
						errors.push(`bad format line ${rowIdx}: ${errorMsg}`);
					}
				} else if (rowObj && !(ignoreBlank && isBlank)) {
					if (mode === "ndjson") {
						writeString(JSON.stringify(rowObj) + '\n');
					} else {
						writeString((rowIdx === 0 ? '' : ',') + JSON.stringify(rowObj));
					}
				}

				if (mode === "validate" && errors.length > 100) {
					errors.push('Aborted, over 100 errors');
					break;
				}
				rowIdx++;
			}

			if (mode === "json") {
				writeString("]");
			}
		} catch (err) {
			context.logger.error('Failure in CSV processing: ' + err.toString());
		} finally {
			writer?.close();
		}
	}

	try {
		if (mode === "validate") {
			await process();
			let report = ''
			if (errors.length > 0) {
				let report = errors.join('\n');
				if (warnings.length) report += '\nWarnings:\n' + warnings.join('\n');
				report += `${rowIdx} lines, ${errors.length} errors, ${warnings.length} warnings`;
				return msg.setStatus(400, report);
			} else {
				report = `OK, ${rowIdx} lines validated`;
				if (warnings.length) report += `, ${warnings.length} warnings\n` + warnings.join('\n');
				return msg.setStatus(200, report);
			}
		} else {
			process();
			return msg.setData(stream!.readable,
				mode === "ndjson" ? "application/x-ndjson" : "application/json");
		}
	} catch (err) {
		writer?.close();
		return msg.setStatus(500, err.toString());
	}
}

service.postPath("ndjson", csvToJson("ndjson"));
service.postPath("validate", csvToJson("validate"));
service.postPath("json", csvToJson("json"));

export default service;