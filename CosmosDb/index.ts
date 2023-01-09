import * as documentdb from "@pulumi/azure-native/documentdb";
import * as pulumi from "@pulumi/pulumi";
import { getCosmosDbName } from "../Common/Naming";
import { DefaultResourceArgs, KeyVaultInfo, ResourceGroupInfo } from "../types";
import ResourceCreator from "../Core/ResourceCreator";
import { defaultTags, isPrd } from "../Common/AzureEnv";
import { createThreatProtection } from "../Logs/Helpers";
import { Input } from "@pulumi/pulumi";
import { addLegacySecret } from "../KeyVault/LegacyHelper";

interface CosmosDbProps {
  name: string;
  group: ResourceGroupInfo;
  vaultInfo?: KeyVaultInfo;
  //locations?: Input<string>[];
  enableMultipleWriteLocations?: boolean;
  capabilities?: Array<"EnableCassandra" | "EnableTable" | "EnableGremlin">;

  network?: {
    publicNetworkAccess?: boolean;
    allowAzureServicesAccess?: boolean;
    subnetIds?: Input<string>[];
    ipAddresses?: Input<string>[];
  };

  sqlDbs?: Array<{
    name: string;
    containers?: Array<{
      name: string;

      partitionKeyPath: string;
      /** auto expired items in seconds*/
      ttl?: number;
    }>;
  }>;
  //allowPortalAccess?: boolean;
  //mongoNames?: Array<string>;
  //sqlDbContainers?: Array<string>;
}

export default async ({
  name,
  group,
  vaultInfo,
  capabilities = ["EnableTable"],
  enableMultipleWriteLocations,
  network,
  sqlDbs,
}: CosmosDbProps) => {
  name = getCosmosDbName(name);

  const { resource } = await ResourceCreator(documentdb.DatabaseAccount, {
    accountName: name,
    ...group,
    databaseAccountOfferType: documentdb.DatabaseAccountOfferType.Standard,
    kind: documentdb.DatabaseAccountKind.MongoDB,
    identity: { type: "SystemAssigned" },

    capabilities: capabilities
      ? capabilities.map((n) => ({ name: n }))
      : undefined,
    //locations: locations?.map(s=>({})),

    backupPolicy: isPrd
      ? {
          type: "Periodic",
          periodicModeProperties: {
            backupIntervalInMinutes: 30,
            backupRetentionIntervalInHours: 4,
          },
        }
      : undefined,

    enableAutomaticFailover: isPrd,
    enableAnalyticalStorage: false,
    enableFreeTier: true,
    enableMultipleWriteLocations,

    consistencyPolicy: {
      defaultConsistencyLevel:
        documentdb.DefaultConsistencyLevel.BoundedStaleness,
      maxIntervalInSeconds: 60 * 60, //1 hours
      maxStalenessPrefix: 100000,
    },

    publicNetworkAccess:
      network?.publicNetworkAccess === true
        ? documentdb.PublicNetworkAccess.Enabled
        : documentdb.PublicNetworkAccess.Disabled,

    isVirtualNetworkFilterEnabled: !network?.publicNetworkAccess,

    networkAclBypass:
      network?.allowAzureServicesAccess === true
        ? documentdb.NetworkAclBypass.AzureServices
        : documentdb.NetworkAclBypass.None,

    virtualNetworkRules: network?.subnetIds
      ? network.subnetIds.map((s) => ({
          id: s,
          ignoreMissingVNetServiceEndpoint: true,
        }))
      : undefined,

    ipRules: network?.ipAddresses
      ? network.ipAddresses.map((i) => ({ ipAddressOrRange: i }))
      : undefined,

    //keyVaultKeyId: encryptKey?.properties.id,
    monitoring: {
      logsCategories: [
        "CassandraRequests",
        "PartitionKeyStatistics",
        "ControlPlaneRequests",
        "MongoRequests",
        "QueryRuntimeStatistics",
        "GremlinRequests",
        "PartitionKeyRUConsumption",
        "DataPlaneRequests",
      ],
      metricsCategories: ["Requests"],
    },
    tags: defaultTags,
  } as unknown as documentdb.DatabaseAccountArgs & DefaultResourceArgs);

  //Thread Protection
  createThreatProtection({
    name,
    targetResourceId: resource.id,
  });

  //Vault variables
  if (vaultInfo) {
    const keys = resource.id.apply(async (id) => {
      if (!id) return undefined;
      return await documentdb.listDatabaseAccountKeys({
        accountName: name,
        ...group,
      });
    });
  }

  //Database and Containers
  if (sqlDbs) {
    sqlDbs.forEach((db) => {
      const database = new documentdb.SqlResourceSqlDatabase(
        db.name,
        {
          databaseName: db.name,
          accountName: name,
          resource: { id: db.name },
          ...group,
        },
        { dependsOn: resource }
      );

      if (db.containers) {
        db.containers.forEach(
          (c) =>
            new documentdb.SqlResourceSqlContainer(`${db.name}-${c.name}`, {
              accountName: name,
              ...group,
              databaseName: db.name,
              containerName: c.name,
              resource: {
                id: c.name,
                defaultTtl: c.ttl,
                partitionKey: { paths: [c.partitionKeyPath || "/id"] },
              },
            })
        );
      }
    });
  }

  return resource;
};
