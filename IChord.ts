import { IChordServiceConfig } from "rs-core/IServiceConfig.ts";

export const schemaIChord = {
    type: "object",
    properties: {
        id: { type: "string" },
        newServices: {
            type: "object",
            properties: {
                name: { type: "string" },
                basePath: { type: "string" },
                source: { type: "string" }
            },
            required: [ "name", "basePath", "source" ]
        }
    },
    required: [ "id" ]
};

export interface IChord {
    id: string;
    newServices?: IChordServiceConfig[];
}