import { IProxyAdapter } from "rs-core/adapter/IProxyAdapter.ts";
import { Message } from "rs-core/Message.ts";
import { AdapterContext, contextLoggerArgs } from "rs-core/ServiceContext.ts";
import { IQueryAdapter } from "rs-core/adapter/IQueryAdapter.ts";
import { upTo } from "rs-core/utility/utility.ts";
import { prefixStorageName, tenantStoragePrefix } from "./tenantStorage.ts";

export interface ElasticAdapterProps {
  username: string;
  password: string;
  host: string;
  tenantIndexes?: boolean;
}

export default class ElasticQueryAdapter implements IQueryAdapter {
  elasticProxyAdapter: IProxyAdapter | null = null;

  constructor(
    public context: AdapterContext,
    public props: ElasticAdapterProps,
  ) {
  }

  normaliseIndexName(s: string) {
    if (s === "." || s === "..") {
      throw new Error("Elastic does not allow index names . or ..");
    }
    return s.toLowerCase()
      .replace(/[\\/*?"<>| ,#]/g, "")
      .replace(/$[-_+]/, "")
      .slice(0, 255);
  }

  physicalIndexName(index: string) {
    if (this.props.tenantIndexes === false) {
      return this.normaliseIndexName(index);
    }
    return prefixStorageName(
      this.context.tenant,
      this.normaliseIndexName(index),
      {
        lowerCase: true,
        maxLength: 255,
      },
    );
  }

  tenantIndexWildcard() {
    if (this.props.tenantIndexes === false) {
      return "*";
    }
    return `${
      tenantStoragePrefix(this.context.tenant, { lowerCase: true })
    }__*`;
  }

  async ensureProxyAdapter() {
    if (this.elasticProxyAdapter === null) {
      this.elasticProxyAdapter = await this.context.getAdapter<IProxyAdapter>(
        "./adapter/ElasticProxyAdapter.ts",
        {
          username: this.props.username,
          password: this.props.password,
          host: this.props.host,
        },
      );
    }
  }

  async requestElastic(msg: Message) {
    await this.ensureProxyAdapter();
    const sendMsg = await this.elasticProxyAdapter!.buildMessage(msg);
    return await this.context.makeRequest(sendMsg);
  }

  async runQuery(
    query: string,
    _: Record<string, unknown>,
    take = 1000,
    skip = 0,
  ): Promise<
    number | Record<string, unknown>[] | {
      items: Record<string, unknown>[];
      total: number;
    }
  > {
    await this.ensureProxyAdapter();
    let index = "";
    let operation = "_search";
    let paged = true;

    let queryObj = {} as any;
    try {
      queryObj = JSON.parse(query);
    } catch (e) {
      this.context.logger.error(
        `Invalid JSON (${e}) in ES query: ${query}`,
        ...contextLoggerArgs(this.context),
      );
      return 400;
    }
    if (queryObj.index) {
      if (typeof queryObj.index !== "string") {
        this.context.logger.error(
          `Invalid index in ES query: ${JSON.stringify(queryObj.index)}`,
          ...contextLoggerArgs(this.context),
        );
        return 400;
      }
      try {
        index = "/" + this.physicalIndexName(queryObj.index);
      } catch (e) {
        this.context.logger.error(
          `Invalid index in ES query: ${e}`,
          ...contextLoggerArgs(this.context),
        );
        return 400;
      }
      delete queryObj.index;
    } else {
      index = "/" + this.tenantIndexWildcard();
    }
    const hasPagingParams = queryObj.size !== undefined ||
      queryObj.from !== undefined;
    if (queryObj.operation) {
      operation = queryObj.operation;
      delete queryObj.operation;
      const opName = upTo(operation, "?");
      if (["_update_by_query", "_delete_by_query", "_count"].includes(opName)) {
        paged = false;
      } else if (!["_search"].includes(opName)) {
        this.context.logger.error(
          `Unknown operation in ES query: ${operation}`,
          ...contextLoggerArgs(this.context),
        );
        return 400;
      }
    }
    if (paged) {
      if (queryObj.size === undefined) queryObj.size = take;
      if (queryObj.from === undefined) queryObj.from = skip;
    }
    if (
      paged && hasPagingParams && operation === "_search" &&
      queryObj.track_total_hits === undefined
    ) {
      queryObj.track_total_hits = true;
    }

    const msg = new Message(
      `${index}/${operation}`,
      this.context.tenant,
      "POST",
      null,
    );
    msg.startSpan(this.context.traceparent, this.context.tracestate);
    msg.setDataJson(queryObj);
    const res = await this.requestElastic(msg);
    if (!res.ok) {
      const report = await res.data?.asString();
      throw new Error(`Elastic adapter error, query: ${report}`);
    }
    const data = await res.data?.asJson();
    switch (operation) {
      case "_search": {
        // Check for suggest results first
        if (data?.suggest && typeof data.suggest === "object") {
          const suggestItems: Record<string, unknown>[] = [];
          const suggestObj = data.suggest as Record<string, unknown>;

          // Iterate through each suggest key (e.g., "ac")
          for (const suggestKey in suggestObj) {
            const suggestEntry = suggestObj[suggestKey];
            if (Array.isArray(suggestEntry)) {
              // Each suggest entry is an array of suggestion objects
              for (const suggestion of suggestEntry) {
                if (suggestion && typeof suggestion === "object") {
                  const suggestionObj = suggestion as Record<string, unknown>;
                  if (Array.isArray(suggestionObj.options)) {
                    // Extract options from each suggestion
                    suggestItems.push(
                      ...(suggestionObj.options as Record<string, unknown>[]),
                    );
                  }
                }
              }
            }
          }

          if (hasPagingParams) {
            return { items: suggestItems, total: suggestItems.length };
          }
          return suggestItems;
        }

        const items = (data?.hits?.hits ?? []) as Record<string, unknown>[];
        if (hasPagingParams) {
          const totalRaw = data?.hits?.total;
          const total = typeof totalRaw === "number"
            ? totalRaw
            : (totalRaw && typeof totalRaw === "object" &&
                typeof totalRaw.value === "number")
            ? totalRaw.value
            : 0;
          return { items, total };
        }
        return items;
      }
      default:
        return data;
    }
  }

  quote(x: any): string | Error {
    if (typeof x === "string") {
      return '"' + x.replace(/\"/g, '\\"') + '"';
    } else if (typeof x !== "object") {
      return JSON.stringify(x);
    } else if (Array.isArray(x)) {
      return JSON.stringify(x
        .filter((item) => typeof item !== "object"));
    } else {
      return new Error(
        "query variable must be a primitive, or an array of primitives",
      );
    }
  }
}
