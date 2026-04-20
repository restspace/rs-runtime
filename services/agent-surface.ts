import { Message } from "rs-core/Message.ts";
import { Service } from "rs-core/Service.ts";
import { IServiceConfig } from "rs-core/IServiceConfig.ts";
import { IServiceManifest } from "rs-core/IManifest.ts";
import { SimpleServiceContext } from "rs-core/ServiceContext.ts";
import { DirDescriptor, PathInfo, StoreViewSpec, ViewSpec } from "rs-core/DirDescriptor.ts";
import { PipelineSpec } from "rs-core/PipelineSpec.ts";
import { config as runtimeConfig } from "../config.ts";
import { AuthUser } from "../auth/AuthUser.ts";

type Surface = "ui" | "cli" | "mcp" | "endUser" | "builder" | "ops";
type IssueSeverity = "error" | "warning";
type SourceType = "entity" | "pipeline";

type AgentSurfaceIssue = {
  severity: IssueSeverity;
  code: string;
  message: string;
  sourceType: SourceType;
  sourcePath: string;
  id?: string;
};

type EntityCandidate = {
  id: string;
  ref: string;
  serviceBasePath: string;
  dataset: string;
  dataUrl: string;
  schemaUrl: string;
  schema: Record<string, unknown>;
  sourcePath: string;
  issues: AgentSurfaceIssue[];
};

type PipelineCandidate = {
  id: string;
  ref: string;
  sourceKind: "service" | "store";
  serviceBasePath: string;
  itemPath?: string;
  executionUrl: string;
  spec: Record<string, unknown>;
  pipeline: PipelineSpec;
  inputSchema?: Record<string, unknown>;
  outputSchema?: Record<string, unknown>;
  sourcePath: string;
  issues: AgentSurfaceIssue[];
};

type ScanResult = {
  entities: EntityCandidate[];
  pipelines: PipelineCandidate[];
};

const service = new Service();
service.postIsWrite = false;

const surfaces = new Set<Surface>([
  "ui",
  "cli",
  "mcp",
  "endUser",
  "builder",
  "ops",
]);

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === "object" && !Array.isArray(value);
}

function asSurface(value: string | undefined): Surface {
  return surfaces.has(value as Surface) ? value as Surface : "mcp";
}

function stableId(parts: string[]): string {
  const bytes = new TextEncoder().encode(parts.join("\n"));
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/g, "");
}

function issue(
  severity: IssueSeverity,
  code: string,
  message: string,
  sourceType: SourceType,
  sourcePath: string,
  id?: string,
): AgentSurfaceIssue {
  return { severity, code, message, sourceType, sourcePath, id };
}

function getExposeState(
  metadataOwner: Record<string, unknown>,
  surface: Surface,
  sourceType: SourceType,
  sourcePath: string,
  id?: string,
): { present: boolean; exposed: boolean; issues: AgentSurfaceIssue[] } {
  const xExpose = metadataOwner["x-expose"];
  if (xExpose === undefined) return { present: false, exposed: false, issues: [] };
  if (!isPlainObject(xExpose)) {
    return {
      present: true,
      exposed: false,
      issues: [
        issue("error", "x_expose_malformed", "`x-expose` must be an object", sourceType, sourcePath, id),
      ],
    };
  }
  const surfaceValue = xExpose[surface];
  if (surfaceValue !== undefined && typeof surfaceValue !== "boolean") {
    return {
      present: true,
      exposed: false,
      issues: [
        issue(
          "error",
          "x_expose_surface_malformed",
          `\`x-expose.${surface}\` must be a boolean`,
          sourceType,
          sourcePath,
          id,
        ),
      ],
    };
  }
  return { present: true, exposed: surfaceValue === true, issues: [] };
}

function validateMetadataNamespaces(
  owner: Record<string, unknown>,
  sourceType: SourceType,
  sourcePath: string,
  id: string,
  issues: AgentSurfaceIssue[],
) {
  for (const key of ["x-ui", "x-agent", "x-policy", "x-render", "x-context"]) {
    if (owner[key] !== undefined && !isPlainObject(owner[key])) {
      issues.push(issue("error", "metadata_namespace_malformed", `\`${key}\` must be an object`, sourceType, sourcePath, id));
    }
  }
}

function propertyNames(schema: Record<string, unknown>): Set<string> {
  const properties = schema.properties;
  return new Set(
    isPlainObject(properties)
      ? Object.keys(properties)
      : [],
  );
}

function validateFieldList(
  fieldSource: Record<string, unknown>,
  fieldName: string,
  properties: Set<string>,
  sourcePath: string,
  id: string,
  issues: AgentSurfaceIssue[],
) {
  const value = fieldSource[fieldName];
  if (value === undefined) return;
  if (!Array.isArray(value) || !value.every((field) => typeof field === "string")) {
    issues.push(issue("error", "field_list_malformed", `\`${fieldName}\` must be an array of field names`, "entity", sourcePath, id));
    return;
  }
  for (const field of value) {
    if (!properties.has(field)) {
      issues.push(issue("error", "metadata_field_not_found", `Field \`${field}\` in \`${fieldName}\` is not declared in schema properties`, "entity", sourcePath, id));
    }
  }
}

function validateSingleField(
  fieldSource: Record<string, unknown>,
  fieldName: string,
  properties: Set<string>,
  sourcePath: string,
  id: string,
  issues: AgentSurfaceIssue[],
) {
  const value = fieldSource[fieldName];
  if (value === undefined) return;
  if (typeof value !== "string") {
    issues.push(issue("error", "field_name_malformed", `\`${fieldName}\` must be a field name`, "entity", sourcePath, id));
    return;
  }
  if (!properties.has(value)) {
    issues.push(issue("error", "metadata_field_not_found", `Field \`${value}\` in \`${fieldName}\` is not declared in schema properties`, "entity", sourcePath, id));
  }
}

function validateEntityCandidate(candidate: EntityCandidate, surface: Surface): boolean {
  const { schema, sourcePath, id, issues } = candidate;
  const expose = getExposeState(schema, surface, "entity", sourcePath, id);
  issues.push(...expose.issues);
  if (!expose.present || (!expose.exposed && expose.issues.length === 0)) return false;

  if (schema.type !== "object" || !isPlainObject(schema.properties)) {
    issues.push(issue("error", "entity_schema_not_object", "Exposed entity schema must be an object schema with properties", "entity", sourcePath, id));
  }
  validateMetadataNamespaces(schema, "entity", sourcePath, id, issues);

  const props = propertyNames(schema);
  const xAgent = isPlainObject(schema["x-agent"]) ? schema["x-agent"] : {};
  const xUi = isPlainObject(schema["x-ui"]) ? schema["x-ui"] : {};

  for (const fieldList of [
    "summaryFields",
    "searchableFields",
    "filterableFields",
    "identityHints",
    "summarizableFields",
  ]) {
    validateFieldList(xAgent, fieldList, props, sourcePath, id, issues);
  }
  for (const fieldList of ["subtitleFields", "defaultListFields"]) {
    validateFieldList(xUi, fieldList, props, sourcePath, id, issues);
  }
  validateSingleField(xUi, "primaryField", props, sourcePath, id, issues);

  if (typeof schema.title !== "string" || !schema.title.trim()) {
    issues.push(issue("warning", "entity_title_missing", "Entity schema should declare `title`", "entity", sourcePath, id));
  }
  if (typeof xAgent.entityName !== "string" || !xAgent.entityName.trim()) {
    issues.push(issue("warning", "entity_name_missing", "Entity metadata should declare `x-agent.entityName`", "entity", sourcePath, id));
  }
  if (!Array.isArray(xAgent.summaryFields) || xAgent.summaryFields.length === 0) {
    issues.push(issue("warning", "entity_summary_fields_missing", "Entity metadata should declare `x-agent.summaryFields`", "entity", sourcePath, id));
  }
  if (!Array.isArray(xAgent.searchableFields) || xAgent.searchableFields.length === 0) {
    issues.push(issue("warning", "entity_searchable_fields_missing", "Entity metadata should declare `x-agent.searchableFields`", "entity", sourcePath, id));
  }
  if (!Array.isArray(xAgent.filterableFields) || xAgent.filterableFields.length === 0) {
    issues.push(issue("warning", "entity_filterable_fields_missing", "Entity metadata should declare `x-agent.filterableFields`", "entity", sourcePath, id));
  }
  if (!isPlainObject(schema["x-render"])) {
    issues.push(issue("warning", "entity_render_missing", "Entity metadata should declare `x-render` hints", "entity", sourcePath, id));
  }

  return expose.exposed;
}

function validatePipelineCandidate(candidate: PipelineCandidate, surface: Surface): boolean {
  const { spec, sourcePath, id, issues } = candidate;
  const expose = getExposeState(spec, surface, "pipeline", sourcePath, id);
  issues.push(...expose.issues);
  if (!expose.present || (!expose.exposed && expose.issues.length === 0)) return false;

  if (!Array.isArray(spec.pipeline)) {
    issues.push(issue("error", "pipeline_missing_pipeline", "Exposed pipeline metadata must include a `pipeline` array", "pipeline", sourcePath, id));
  }
  validateMetadataNamespaces(spec, "pipeline", sourcePath, id, issues);

  const xAgent = isPlainObject(spec["x-agent"]) ? spec["x-agent"] : {};
  const xPolicy = isPlainObject(spec["x-policy"]) ? spec["x-policy"] : {};

  if (xAgent.kind === undefined) {
    issues.push(issue("error", "pipeline_kind_missing", "Exposed pipeline must declare `x-agent.kind`", "pipeline", sourcePath, id));
  } else if (xAgent.kind !== "query" && xAgent.kind !== "action") {
    issues.push(issue("error", "pipeline_kind_invalid", "`x-agent.kind` must be `query` or `action`", "pipeline", sourcePath, id));
  }
  if (xPolicy.effect !== "read") {
    issues.push(issue("error", "pipeline_effect_not_read", "This discovery phase only exposes pipelines with `x-policy.effect = \"read\"`", "pipeline", sourcePath, id));
  }
  if (spec.inputSchema !== undefined && !isPlainObject(spec.inputSchema)) {
    issues.push(issue("error", "pipeline_input_schema_malformed", "`inputSchema` must be an object when present", "pipeline", sourcePath, id));
  }
  if (spec.outputSchema !== undefined && !isPlainObject(spec.outputSchema)) {
    issues.push(issue("error", "pipeline_output_schema_malformed", "`outputSchema` must be an object when present", "pipeline", sourcePath, id));
  }

  if (typeof xAgent.title !== "string" || !xAgent.title.trim()) {
    issues.push(issue("warning", "pipeline_title_missing", "Pipeline metadata should declare `x-agent.title`", "pipeline", sourcePath, id));
  }
  if (typeof xAgent.description !== "string" || !xAgent.description.trim()) {
    issues.push(issue("warning", "pipeline_description_missing", "Pipeline metadata should declare `x-agent.description`", "pipeline", sourcePath, id));
  }
  if (!isPlainObject(spec.outputSchema)) {
    issues.push(issue("warning", "pipeline_output_schema_missing", "Pipeline metadata should declare `outputSchema`", "pipeline", sourcePath, id));
  }
  if (!Array.isArray(xAgent.suggestedUtterances) || xAgent.suggestedUtterances.length === 0) {
    issues.push(issue("warning", "pipeline_suggested_utterances_missing", "Pipeline metadata should declare `x-agent.suggestedUtterances`", "pipeline", sourcePath, id));
  }
  if (typeof xAgent.resultShape !== "string" || !xAgent.resultShape.trim()) {
    issues.push(issue("warning", "pipeline_result_shape_missing", "Pipeline metadata should declare `x-agent.resultShape`", "pipeline", sourcePath, id));
  }

  return expose.exposed;
}

function hasErrors(candidate: EntityCandidate | PipelineCandidate): boolean {
  return candidate.issues.some((i) => i.severity === "error");
}

function warningCount(candidate: EntityCandidate | PipelineCandidate): number {
  return candidate.issues.filter((i) => i.severity === "warning").length;
}

function currentUserCanRead(serviceConfig: IServiceConfig, msg: Message): boolean {
  const readRoles = serviceConfig.access?.readRoles || "";
  if (!readRoles) return false;
  const user = new AuthUser(msg.user || AuthUser.anon);
  return user.authorizedFor(readRoles, serviceConfig.basePath);
}

function manifestModuleEndsWith(manifest: IServiceManifest, suffix: string): boolean {
  return typeof manifest.moduleUrl === "string" && manifest.moduleUrl.replace(/\\/g, "/").endsWith(suffix);
}

async function getManifest(serviceConfig: IServiceConfig, tenantName: string): Promise<IServiceManifest | null> {
  const manifest = await runtimeConfig.modules.getServiceManifest(serviceConfig.source, tenantName);
  if (typeof manifest === "string") {
    runtimeConfig.logger.error(`Failed to load manifest for ${serviceConfig.source}: ${manifest}`);
    return null;
  }
  return manifest;
}

async function readJson(
  context: SimpleServiceContext,
  parentMsg: Message,
  url: string,
  manage = false,
): Promise<unknown | number> {
  const readMsg = new Message(url, context, "GET", parentMsg);
  readMsg.user = parentMsg.user;
  readMsg.authenticated = parentMsg.authenticated;
  if (manage) readMsg.setHeader("X-Restspace-Request-Mode", "manage");
  const response = await context.makeRequest(readMsg);
  if (!response.ok || !response.data) return response.status || 500;
  try {
    return await response.data.asJson();
  } catch (err) {
    context.logger.warn(`Failed to parse JSON from ${url}: ${err}`);
    return 500;
  }
}

function stripSlash(path: string): string {
  return path.endsWith("/") ? path.slice(0, -1) : path;
}

function pathInfos(value: unknown): PathInfo[] {
  return isPlainObject(value) && Array.isArray((value as unknown as DirDescriptor).paths)
    ? (value as unknown as DirDescriptor).paths
    : [];
}

function entitySummary(candidate: EntityCandidate) {
  const schema = candidate.schema;
  const xAgent = isPlainObject(schema["x-agent"]) ? schema["x-agent"] : {};
  const xUi = isPlainObject(schema["x-ui"]) ? schema["x-ui"] : {};
  const properties = isPlainObject(schema.properties) ? Object.keys(schema.properties) : [];
  return {
    id: candidate.id,
    ref: candidate.ref,
    title: typeof schema.title === "string" ? schema.title : undefined,
    entityName: xAgent.entityName,
    entityNamePlural: xAgent.entityNamePlural,
    serviceBasePath: candidate.serviceBasePath,
    dataset: candidate.dataset,
    dataUrl: candidate.dataUrl,
    schemaUrl: candidate.schemaUrl,
    fields: properties,
    summaryFields: xAgent.summaryFields,
    searchableFields: xAgent.searchableFields,
    filterableFields: xAgent.filterableFields,
    primaryField: xUi.primaryField,
    warnings: warningCount(candidate),
    href: `entities/${candidate.id}`,
  };
}

function entityDetail(candidate: EntityCandidate) {
  return {
    ...entitySummary(candidate),
    schema: candidate.schema,
    issues: candidate.issues,
  };
}

function viewItemSpec(): ViewSpec {
  return {
    pattern: "view",
    respMimeType: "application/json",
  };
}

function viewStoreSpec(): StoreViewSpec {
  return {
    pattern: "store-view",
    createDirectory: false,
    createFiles: false,
    storeMimeTypes: [],
    respMimeType: "application/json",
  };
}

function pipelineSummary(candidate: PipelineCandidate) {
  const xAgent = isPlainObject(candidate.spec["x-agent"]) ? candidate.spec["x-agent"] : {};
  const xPolicy = isPlainObject(candidate.spec["x-policy"]) ? candidate.spec["x-policy"] : {};
  return {
    id: candidate.id,
    ref: candidate.ref,
    sourceKind: candidate.sourceKind,
    serviceBasePath: candidate.serviceBasePath,
    itemPath: candidate.itemPath,
    executionUrl: candidate.executionUrl,
    kind: xAgent.kind,
    title: xAgent.title,
    description: xAgent.description,
    resultShape: xAgent.resultShape,
    effect: xPolicy.effect,
    hasInputSchema: !!candidate.inputSchema,
    hasOutputSchema: !!candidate.outputSchema,
    warnings: warningCount(candidate),
    href: `pipelines/${candidate.id}`,
  };
}

function pipelineDetail(candidate: PipelineCandidate) {
  return {
    ...pipelineSummary(candidate),
    inputSchema: candidate.inputSchema,
    outputSchema: candidate.outputSchema,
    metadata: {
      "x-agent": candidate.spec["x-agent"],
      "x-policy": candidate.spec["x-policy"],
      "x-render": candidate.spec["x-render"],
      "x-context": candidate.spec["x-context"],
      "x-expose": candidate.spec["x-expose"],
    },
    pipeline: candidate.pipeline,
    issues: candidate.issues,
  };
}

function logExcludedInvalid(context: SimpleServiceContext, candidate: EntityCandidate | PipelineCandidate) {
  const errors = candidate.issues.filter((i) => i.severity === "error");
  if (!errors.length) return;
  for (const err of errors) {
    context.logger.warn(`Agent surface excluded ${err.sourceType} ${candidate.sourcePath}: ${err.code} ${err.message}`);
  }
}

async function collectDataEntities(
  serviceConfig: IServiceConfig,
  context: SimpleServiceContext,
  msg: Message,
  surface: Surface,
): Promise<EntityCandidate[]> {
  const directory = await readJson(context, msg, `${serviceConfig.basePath}/?$list=details,all`);
  if (typeof directory === "number") return [];

  const candidates: EntityCandidate[] = [];
  for (const [name] of pathInfos(directory)) {
    const dataset = stripSlash(name);
    if (!dataset || dataset === ".schema.json") continue;
    const schemaUrl = `${serviceConfig.basePath}/${dataset}/.schema.json`;
    const schema = await readJson(context, msg, schemaUrl);
    if (typeof schema === "number" || !isPlainObject(schema)) continue;
    const id = stableId(["entity", serviceConfig.basePath, dataset]);
    const candidate: EntityCandidate = {
      id,
      ref: typeof schema.$id === "string" ? schema.$id : `restspace://entity${serviceConfig.basePath}/${dataset}`,
      serviceBasePath: serviceConfig.basePath,
      dataset,
      dataUrl: `${serviceConfig.basePath}/${dataset}/`,
      schemaUrl,
      schema,
      sourcePath: schemaUrl,
      issues: [],
    };
    const isExposed = validateEntityCandidate(candidate, surface);
    if (isExposed || candidate.issues.length > 0) candidates.push(candidate);
  }
  return candidates;
}

function collectDatasetEntity(
  serviceConfig: IServiceConfig,
  surface: Surface,
): EntityCandidate[] {
  const schema = (serviceConfig as IServiceConfig & { schema?: unknown }).schema;
  const datasetName = (serviceConfig as IServiceConfig & { datasetName?: unknown }).datasetName;
  if (!isPlainObject(schema) || typeof datasetName !== "string" || !datasetName.trim()) {
    return [];
  }
  const id = stableId(["entity", serviceConfig.basePath, datasetName]);
  const candidate: EntityCandidate = {
    id,
    ref: typeof schema.$id === "string" ? schema.$id : `restspace://entity${serviceConfig.basePath}`,
    serviceBasePath: serviceConfig.basePath,
    dataset: datasetName,
    dataUrl: `${serviceConfig.basePath}/`,
    schemaUrl: `${serviceConfig.basePath}/.schema.json`,
    schema,
    sourcePath: `${serviceConfig.basePath}#schema`,
    issues: [],
  };
  const isExposed = validateEntityCandidate(candidate, surface);
  return isExposed || candidate.issues.length > 0 ? [candidate] : [];
}

function collectConfiguredPipeline(
  serviceConfig: IServiceConfig,
  surface: Surface,
): PipelineCandidate[] {
  const configWithPipeline = serviceConfig as IServiceConfig & {
    pipeline?: unknown;
    inputSchema?: unknown;
    outputSchema?: unknown;
    "x-agent"?: unknown;
    "x-policy"?: unknown;
    "x-render"?: unknown;
    "x-context"?: unknown;
    "x-expose"?: unknown;
    manualMimeTypes?: { requestSchema?: unknown; responseSchema?: unknown };
  };
  const spec: Record<string, unknown> = {
    pipeline: configWithPipeline.pipeline,
    inputSchema: configWithPipeline.inputSchema ?? configWithPipeline.manualMimeTypes?.requestSchema,
    outputSchema: configWithPipeline.outputSchema ?? configWithPipeline.manualMimeTypes?.responseSchema,
    "x-agent": configWithPipeline["x-agent"],
    "x-policy": configWithPipeline["x-policy"],
    "x-render": configWithPipeline["x-render"],
    "x-context": configWithPipeline["x-context"],
    "x-expose": configWithPipeline["x-expose"],
  };
  const id = stableId(["pipeline", "service", serviceConfig.basePath]);
  const candidate: PipelineCandidate = {
    id,
    ref: `restspace://pipeline${serviceConfig.basePath}`,
    sourceKind: "service",
    serviceBasePath: serviceConfig.basePath,
    executionUrl: serviceConfig.basePath,
    spec,
    pipeline: Array.isArray(configWithPipeline.pipeline) ? configWithPipeline.pipeline as PipelineSpec : [],
    inputSchema: isPlainObject(spec.inputSchema) ? spec.inputSchema : undefined,
    outputSchema: isPlainObject(spec.outputSchema) ? spec.outputSchema : undefined,
    sourcePath: `${serviceConfig.basePath}#config`,
    issues: [],
  };
  const isExposed = validatePipelineCandidate(candidate, surface);
  return isExposed || candidate.issues.length > 0 ? [candidate] : [];
}

async function collectStoredPipelines(
  serviceConfig: IServiceConfig,
  context: SimpleServiceContext,
  msg: Message,
  surface: Surface,
): Promise<PipelineCandidate[]> {
  const directory = await readJson(context, msg, `${serviceConfig.basePath}/?$list=details,all`, true);
  if (typeof directory === "number") return [];

  const candidates: PipelineCandidate[] = [];
  for (const [name] of pathInfos(directory)) {
    if (!name || name.endsWith("/")) continue;
    const itemPath = name;
    const specUrl = `${serviceConfig.basePath}/${itemPath}`;
    const rawSpec = await readJson(context, msg, specUrl, true);
    if (!isPlainObject(rawSpec)) continue;
    const pipeline = Array.isArray(rawSpec.pipeline) ? rawSpec.pipeline as PipelineSpec : [];
    const id = stableId(["pipeline", "store", serviceConfig.basePath, itemPath]);
    const candidate: PipelineCandidate = {
      id,
      ref: typeof rawSpec.$id === "string" ? rawSpec.$id : `restspace://pipeline${specUrl}`,
      sourceKind: "store",
      serviceBasePath: serviceConfig.basePath,
      itemPath,
      executionUrl: specUrl,
      spec: rawSpec,
      pipeline,
      inputSchema: isPlainObject(rawSpec.inputSchema) ? rawSpec.inputSchema : undefined,
      outputSchema: isPlainObject(rawSpec.outputSchema) ? rawSpec.outputSchema : undefined,
      sourcePath: specUrl,
      issues: [],
    };
    const isExposed = validatePipelineCandidate(candidate, surface);
    if (isExposed || candidate.issues.length > 0) candidates.push(candidate);
  }
  return candidates;
}

async function scanSurface(
  context: SimpleServiceContext,
  msg: Message,
  surface: Surface,
  logInvalid: boolean,
  includeEntities = true,
  includePipelines = true,
): Promise<ScanResult> {
  const tenant = runtimeConfig.tenants[context.tenant];
  const entities: EntityCandidate[] = [];
  const pipelines: PipelineCandidate[] = [];

  for (const serviceConfig of Object.values(tenant.servicesConfig!.services)) {
    if (!currentUserCanRead(serviceConfig, msg)) continue;

    const manifest = await getManifest(serviceConfig, tenant.name);
    if (!manifest) continue;

    let candidates: (EntityCandidate | PipelineCandidate)[] = [];
    if (includeEntities && ((manifest.apis || []).includes("data.base") || manifestModuleEndsWith(manifest, "services/data.ts"))) {
      candidates = await collectDataEntities(serviceConfig, context, msg, surface);
      entities.push(...candidates as EntityCandidate[]);
    } else if (includeEntities && ((manifest.apis || []).includes("data.set") || manifestModuleEndsWith(manifest, "services/dataset.ts"))) {
      candidates = collectDatasetEntity(serviceConfig, surface);
      entities.push(...candidates as EntityCandidate[]);
    } else if (includePipelines && ((manifest.apis || []).includes("pipeline") && manifestModuleEndsWith(manifest, "services/pipeline.ts"))) {
      candidates = collectConfiguredPipeline(serviceConfig, surface);
      pipelines.push(...candidates as PipelineCandidate[]);
    } else if (includePipelines && manifestModuleEndsWith(manifest, "services/pipeline-store.ts")) {
      candidates = await collectStoredPipelines(serviceConfig, context, msg, surface);
      pipelines.push(...candidates as PipelineCandidate[]);
    }

    if (logInvalid) {
      candidates.filter(hasErrors).forEach((candidate) => logExcludedInvalid(context, candidate));
    }
  }

  return {
    entities: entities.filter((candidate) => !hasErrors(candidate)),
    pipelines: pipelines.filter((candidate) => !hasErrors(candidate)),
  };
}

async function scanValidation(
  context: SimpleServiceContext,
  msg: Message,
  surface: Surface,
) {
  const tenant = runtimeConfig.tenants[context.tenant];
  const entities: EntityCandidate[] = [];
  const pipelines: PipelineCandidate[] = [];
  const entityIssues: AgentSurfaceIssue[] = [];
  const pipelineIssues: AgentSurfaceIssue[] = [];

  for (const serviceConfig of Object.values(tenant.servicesConfig!.services)) {
    if (!currentUserCanRead(serviceConfig, msg)) continue;

    const manifest = await getManifest(serviceConfig, tenant.name);
    if (!manifest) continue;

    let rawCandidates: (EntityCandidate | PipelineCandidate)[] = [];
    if ((manifest.apis || []).includes("data.base") || manifestModuleEndsWith(manifest, "services/data.ts")) {
      rawCandidates = await collectDataEntities(serviceConfig, context, msg, surface);
    } else if ((manifest.apis || []).includes("data.set") || manifestModuleEndsWith(manifest, "services/dataset.ts")) {
      rawCandidates = collectDatasetEntity(serviceConfig, surface);
    } else if ((manifest.apis || []).includes("pipeline") && manifestModuleEndsWith(manifest, "services/pipeline.ts")) {
      rawCandidates = collectConfiguredPipeline(serviceConfig, surface);
    } else if (manifestModuleEndsWith(manifest, "services/pipeline-store.ts")) {
      rawCandidates = await collectStoredPipelines(serviceConfig, context, msg, surface);
    }

    for (const candidate of rawCandidates) {
      if ("schema" in candidate) {
        entityIssues.push(...candidate.issues);
        if (candidate.issues.some((candidateIssue) => candidateIssue.severity === "error")) continue;
        entities.push(candidate);
      } else {
        pipelineIssues.push(...candidate.issues);
        if (candidate.issues.some((candidateIssue) => candidateIssue.severity === "error")) continue;
        pipelines.push(candidate);
      }
    }
  }

  return {
    surface,
    summary: {
      entities: {
        included: entities.length,
        excluded: entityIssues.some((i) => i.severity === "error")
          ? new Set(entityIssues.filter((i) => i.severity === "error").map((i) => i.id || i.sourcePath)).size
          : 0,
        warnings: entityIssues.filter((i) => i.severity === "warning").length,
        errors: entityIssues.filter((i) => i.severity === "error").length,
      },
      pipelines: {
        included: pipelines.length,
        excluded: pipelineIssues.some((i) => i.severity === "error")
          ? new Set(pipelineIssues.filter((i) => i.severity === "error").map((i) => i.id || i.sourcePath)).size
          : 0,
        warnings: pipelineIssues.filter((i) => i.severity === "warning").length,
        errors: pipelineIssues.filter((i) => i.severity === "error").length,
      },
    },
    entities: {
      included: entities.map(entitySummary),
      issues: entityIssues,
    },
    pipelines: {
      included: pipelines.map(pipelineSummary),
      issues: pipelineIssues,
    },
  };
}

function rootDocument(msg: Message, surface: Surface, scan: ScanResult) {
  const base = msg.url.baseUrl();
  return {
    "$id": "app://agent-surface",
    surface,
    entities: {
      count: scan.entities.length,
      href: `${base}/entities/?surface=${surface}`,
    },
    pipelines: {
      count: scan.pipelines.length,
      href: `${base}/pipelines/?surface=${surface}`,
    },
    validation: {
      href: `${base}/validate?surface=${surface}`,
    },
    capabilities: {
      supportsEntities: true,
      supportsPipelines: true,
      supportsReadOnlyPipelines: true,
      supportsValidation: true,
      supportsProgressiveDisclosure: true,
      supportsProposals: false,
      supportsPlans: false,
      supportsContextInjection: false,
    },
  };
}

service.constantDirectory("/", {
  path: "/",
  paths: [
    [ "entities/", 0, viewStoreSpec() ],
    [ "pipelines/", 0, viewStoreSpec() ],
    [ "validate", 0, viewItemSpec() ],
  ],
  spec: {
    pattern: "directory",
  },
});

service.getDirectoryPath("entities", async (msg: Message, context: SimpleServiceContext) => {
  const surface = asSurface(msg.url.query.surface?.[0]);
  const scan = await scanSurface(context, msg, surface, true, true, false);
  return msg.setDirectoryJson({
    path: msg.url.servicePath,
    paths: scan.entities.map((entity) => [ entity.id, 0, viewItemSpec() ] as PathInfo),
    spec: viewStoreSpec(),
  } as DirDescriptor);
});

service.getDirectoryPath("pipelines", async (msg: Message, context: SimpleServiceContext) => {
  const surface = asSurface(msg.url.query.surface?.[0]);
  const scan = await scanSurface(context, msg, surface, true, false, true);
  return msg.setDirectoryJson({
    path: msg.url.servicePath,
    paths: scan.pipelines.map((pipeline) => [ pipeline.id, 0, viewItemSpec() ] as PathInfo),
    spec: viewStoreSpec(),
  } as DirDescriptor);
});

async function route(msg: Message, context: SimpleServiceContext) {
  const surface = asSurface(msg.url.query.surface?.[0]);
  const path = msg.url.servicePathElements;

  if (path.length === 0) {
    const scan = await scanSurface(context, msg, surface, true);
    return msg.setDataJson(rootDocument(msg, surface, scan));
  }

  if (path.length === 2 && path[0] === "entities") {
    const scan = await scanSurface(context, msg, surface, true, true, false);
    const entity = scan.entities.find((candidate) => candidate.id === path[1]);
    if (!entity) return msg.setStatus(404, "Entity not found");
    return msg.setDataJson(entityDetail(entity));
  }

  if (path.length === 2 && path[0] === "pipelines") {
    const scan = await scanSurface(context, msg, surface, true, false, true);
    const pipeline = scan.pipelines.find((candidate) => candidate.id === path[1]);
    if (!pipeline) return msg.setStatus(404, "Pipeline not found");
    return msg.setDataJson(pipelineDetail(pipeline));
  }

  if (path.length === 1 && path[0] === "validate") {
    return msg.setDataJson(await scanValidation(context, msg, surface));
  }

  return msg.setStatus(404, "Not found");
}

service.get(route);

export default service;
