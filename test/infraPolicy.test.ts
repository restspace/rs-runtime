import { assertEquals, assertRejects } from "std/testing/asserts.ts";
import { IAdapter } from "rs-core/adapter/IAdapter.ts";
import { IServiceConfig } from "rs-core/IServiceConfig.ts";
import S3FileAdapter from "../adapter/S3FileAdapter.ts";
import { config, IServerConfig } from "../config.ts";
import { ServiceFactory } from "../ServiceFactory.ts";
import { makeAdapterContext } from "./testUtility.ts";
import { testServerConfig } from "./testServerConfig.ts";

const s3Infra = {
  adapterSource: "./adapter/S3FileAdapter.ram.json",
  rootPath: "files",
  bucketName: "bucket",
  region: "eu-west-2",
};

const elasticInfra = {
  adapterSource: "./adapter/ElasticDataAdapter.ram.json",
  host: "http://elastic",
  username: "user",
  password: "pass",
};

const serviceConfig = (
  adapterConfig: Record<string, unknown> = {},
): IServiceConfig => ({
  name: "Files",
  source: "./services/file.rsm.json",
  basePath: "/files",
  access: { readRoles: "all", writeRoles: "all" },
  infraName: "s3",
  adapterConfig,
});

Deno.test("S3FileAdapter tenantDirectories controls physical tenant path segment", () => {
  const baseProps = {
    rootPath: "files",
    bucketName: "bucket",
    region: "eu-west-2",
  };

  const defaultAdapter = new S3FileAdapter(
    makeAdapterContext("tenant a"),
    baseProps,
  );
  const enabledAdapter = new S3FileAdapter(
    makeAdapterContext("tenant a"),
    { ...baseProps, tenantDirectories: true },
  );
  const disabledAdapter = new S3FileAdapter(
    makeAdapterContext("tenant a"),
    { ...baseProps, tenantDirectories: false },
  );

  assertEquals(
    (defaultAdapter as any).getPath("/reports/q1.pdf"),
    "files/tenant_a/reports/q1.pdf",
  );
  assertEquals(
    (enabledAdapter as any).getPath("/reports/q1.pdf"),
    "files/tenant_a/reports/q1.pdf",
  );
  assertEquals(
    (disabledAdapter as any).getPath("/reports/q1.pdf"),
    "files/reports/q1.pdf",
  );
});

Deno.test("S3 tenantDirectories is allowed from infra and rejected from service config", async () => {
  const oldServer = config.server;
  try {
    config.server = {
      ...(testServerConfig as IServerConfig),
      infra: {
        s3: {
          ...s3Infra,
          tenantDirectories: false,
        },
      },
    };
    const serviceFactory = new ServiceFactory(
      "tenant-a",
      "tenant-a.restspace.local:3100",
    );
    let capturedAdapterConfig: Record<string, unknown> | undefined;
    const context = makeAdapterContext("tenant-a", <T extends IAdapter>(
      _url: string,
      adapterConfig: unknown,
    ) => {
      capturedAdapterConfig = adapterConfig as Record<string, unknown>;
      return Promise.resolve({} as T);
    });

    await serviceFactory.extendContextWithAdapter(
      serviceConfig(),
      context as any,
    );

    assertEquals(capturedAdapterConfig?.tenantDirectories, false);
    assertEquals(capturedAdapterConfig?.adapterSource, undefined);
    assertEquals(capturedAdapterConfig?.allowedTenants, undefined);

    await assertRejects(
      () =>
        serviceFactory.extendContextWithAdapter(
          serviceConfig({ tenantDirectories: false }),
          context as any,
        ),
      Error,
      "infra-only adapter config properties: tenantDirectories",
    );
  } finally {
    config.server = oldServer;
  }
});

Deno.test("allowedTenants restricts explicit infra use and automatic infra selection", async () => {
  const oldServer = config.server;
  try {
    config.server = {
      ...(testServerConfig as IServerConfig),
      infra: {
        blocked: {
          adapterSource: "./adapter/LocalFileAdapter.ram.json",
          rootPath: "blocked",
          allowedTenants: ["other-tenant"],
        },
        open: {
          adapterSource: "./adapter/LocalFileAdapter.ram.json",
          rootPath: "open",
        },
      },
    };
    const serviceFactory = new ServiceFactory(
      "tenant-a",
      "tenant-a.restspace.local:3100",
    );
    const context = makeAdapterContext("tenant-a");

    await assertRejects(
      () =>
        serviceFactory.extendContextWithAdapter({
          ...serviceConfig({ basePath: "/data" }),
          infraName: "blocked",
        }, context as any),
      Error,
      "infra blocked is not available to tenant tenant-a",
    );

    assertEquals(
      await serviceFactory.infraForAdapterInterface("IFileAdapter"),
      "open",
    );
  } finally {
    config.server = oldServer;
  }
});

Deno.test("Elasticsearch tenantIndexes false requires allowedTenants and is infra-only", async () => {
  const oldServer = config.server;
  try {
    config.server = {
      ...(testServerConfig as IServerConfig),
      infra: {
        elastic: {
          ...elasticInfra,
          tenantIndexes: false,
          allowedTenants: ["tenant-a"],
        },
      },
    };
    const serviceFactory = new ServiceFactory(
      "tenant-a",
      "tenant-a.restspace.local:3100",
    );
    let capturedAdapterConfig: Record<string, unknown> | undefined;
    const context = makeAdapterContext("tenant-a", <T extends IAdapter>(
      _url: string,
      adapterConfig: unknown,
    ) => {
      capturedAdapterConfig = adapterConfig as Record<string, unknown>;
      return Promise.resolve({} as T);
    });

    await serviceFactory.extendContextWithAdapter(
      {
        ...serviceConfig(),
        infraName: "elastic",
      },
      context as any,
    );

    assertEquals(capturedAdapterConfig?.tenantIndexes, false);
    assertEquals(capturedAdapterConfig?.allowedTenants, undefined);

    await assertRejects(
      () =>
        serviceFactory.extendContextWithAdapter(
          {
            ...serviceConfig({ tenantIndexes: false }),
            infraName: "elastic",
          },
          context as any,
        ),
      Error,
      "infra-only adapter config properties: tenantIndexes",
    );

    config.server = {
      ...(testServerConfig as IServerConfig),
      infra: {
        elastic: {
          ...elasticInfra,
          tenantIndexes: false,
        },
      },
    };

    await assertRejects(
      () =>
        serviceFactory.extendContextWithAdapter(
          {
            ...serviceConfig(),
            infraName: "elastic",
          },
          context as any,
        ),
      Error,
      "tenantIndexes false for Elasticsearch",
    );
  } finally {
    config.server = oldServer;
  }
});
