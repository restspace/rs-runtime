import { Service } from "rs-core/Service.ts";
import { PipelineSpec } from "rs-core/PipelineSpec.ts";
import { Url } from "rs-core/Url.ts";
import { pipeline } from "../pipeline/pipeline.ts";
import { AuthUser } from "../auth/AuthUser.ts";

interface PipelineSpecAccess {
  getRoles?: string;
  postRoles?: string;
  writeRoles?: string;
}

interface PipelineSpecWithAccess extends PipelineSpecAccess {
  pipeline: PipelineSpec;
}

interface NormalizedStoredPipelineSpec {
  pipeline: PipelineSpec;
  access?: PipelineSpecAccess;
}

function trimRoleSpec(roleSpec?: string): string | undefined {
  if (roleSpec === undefined) return undefined;
  const trimmed = roleSpec.trim();
  return trimmed ? trimmed : undefined;
}

function normalizeStoredPipelineSpec(
  rawSpec: unknown,
): NormalizedStoredPipelineSpec | null {
  if (Array.isArray(rawSpec)) {
    return { pipeline: rawSpec as PipelineSpec };
  }
  if (!rawSpec || typeof rawSpec !== "object" || Array.isArray(rawSpec)) {
    return null;
  }

  const { getRoles, postRoles, writeRoles, pipeline } = rawSpec as Partial<
    PipelineSpecWithAccess
  >;
  if (!Array.isArray(pipeline)) return null;
  if (getRoles !== undefined && typeof getRoles !== "string") return null;
  if (postRoles !== undefined && typeof postRoles !== "string") return null;
  if (writeRoles !== undefined && typeof writeRoles !== "string") return null;

  return {
    pipeline,
    access: {
      getRoles: trimRoleSpec(getRoles),
      postRoles: trimRoleSpec(postRoles),
      writeRoles: trimRoleSpec(writeRoles),
    },
  };
}

function requiredRolesForMethod(
  method: string,
  access?: PipelineSpecAccess,
): string | null {
  if (!access) return null;
  switch (method) {
    case "GET":
    case "HEAD":
      return access.getRoles || "";
    case "POST":
      return access.postRoles || "";
    case "PUT":
    case "PATCH":
    case "DELETE":
      return access.writeRoles || "";
    default:
      return "";
  }
}

const service = new Service();

service.postIsWrite = false;
service.all(async (msg, context) => {
  const reqForStore = msg.url.isDirectory ||
    (msg.getHeader("X-Restspace-Request-Mode") === "manage" &&
      msg.method !== "POST");
  if (reqForStore) return msg.setStatus(0); // request will be handled by store

  const getFromStore = msg.copy().setMethod("GET").setHeader(
    "X-Restspace-Request-Mode",
    "manage",
  );
  const msgPipelineSpec = await context.makeRequest(getFromStore);
  if (msg.url.isDirectory || !msgPipelineSpec.ok) return msgPipelineSpec;

  const rawPipelineSpec = await msgPipelineSpec.data!.asJson();
  const normalizedSpec = normalizeStoredPipelineSpec(rawPipelineSpec);
  if (!normalizedSpec) return msg.setStatus(400, "Invalid pipeline spec");

  const requiredRoles = requiredRolesForMethod(
    msg.method,
    normalizedSpec.access,
  );
  if (requiredRoles !== null) {
    const authUser = new AuthUser(msg.user || AuthUser.anon);
    if (
      !requiredRoles ||
      !authUser.authorizedFor(requiredRoles, msg.url.servicePath)
    ) {
      return msg.setStatus(401, "Unauthorized");
    }
  }

  let pipelineSpec = normalizedSpec.pipeline;
  if (msg.url.query["$to-step"]) {
    const toStep = parseInt(msg.url.query["$to-step"][0]);
    if (!isNaN(toStep) && toStep < pipelineSpec.length - 1) {
      pipelineSpec = pipelineSpec.slice(0, toStep + 1);
    }
  }

  // find the applicable url
  const pipelineUrl: Url = msg.url.copy();
  const location = msgPipelineSpec.getHeader("location");
  const locationUrl = location ? new Url(location).stripPrivateServices() : "";
  pipelineUrl.setSubpathFromUrl(locationUrl);

  const pipelineResult = await pipeline(
    msg,
    pipelineSpec,
    pipelineUrl,
    false,
    (msg) => context.makeRequest(msg),
    context.serviceName,
  );
  // Preserve pipeline status codes (e.g. 400), but translate "0" (internal OK) to a real HTTP 200.
  return pipelineResult.status === 0
    ? pipelineResult.setStatus(200)
    : pipelineResult;
});

export default service;
