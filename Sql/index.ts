import * as azuread from "@pulumi/azuread";
import * as sql from "@pulumi/azure-native/sql";
import {
  BasicResourceArgs,
  BasicResourceResultProps,
  KeyVaultInfo,
  PrivateLinkProps,
} from "../types";
import { Input, Output, interpolate, all } from "@pulumi/pulumi";
import {
  currentEnv,
  defaultTags,
  isPrd,
  tenantId,
  subscriptionId,
} from "../Common/AzureEnv";
import { randomLogin } from "../Core/Random";
import { addSecret } from "../KeyVault/Helper";
import sqlDbCreator, { SqlDbProps } from "./SqlDb";

import privateEndpointCreator from "../VNet/PrivateEndpoint";
import { roleAssignment } from "../AzAd/RoleAssignment";
import roleCreator from "../AzAd/Role";
import { getElasticPoolName, getSqlServerName } from "../Common/Naming";
import Locker from "../Core/Locker";
import { convertToIpRange } from "../VNet/Helper";

type ElasticPoolCapacityProps = 50 | 100 | 200 | 300 | 400 | 800 | 1200;

interface ElasticPoolProps extends BasicResourceArgs {
  sqlName: Output<string>;
  /** Minimum is 50 Gd*/
  maxSizeBytesGb?: number;
  sku?: { name: "Standard" | "Basic"; capacity: ElasticPoolCapacityProps };
  lock?: boolean;
}

const createElasticPool = ({
  group,
  name,
  sqlName,
  //Minimum is 50 GD
  maxSizeBytesGb = 50,
  sku = { name: isPrd ? "Standard" : "Basic", capacity: 50 },
  lock = true,
}: ElasticPoolProps): BasicResourceResultProps<sql.ElasticPool> => {
  //Create Sql Elastic
  const elasticName = getElasticPoolName(name);

  const ep = new sql.ElasticPool(elasticName, {
    elasticPoolName: elasticName,
    serverName: sqlName,
    ...group,

    maxSizeBytes: isPrd ? maxSizeBytesGb * 1024 * 1024 * 1024 : undefined,
    sku: {
      name: `${sku.name}Pool`,
      tier: sku.name,
      capacity: sku.capacity,
    },
    perDatabaseSettings: {
      minCapacity: 0,
      maxCapacity: sku.name === "Basic" ? 5 : sku.capacity,
    },

    //licenseType: sql.ElasticPoolLicenseType.BasePrice,
    //zoneRedundant: isPrd,
  });

  if (lock) {
    Locker({ name, resourceId: ep.id, dependsOn: ep });
  }

  return { name: elasticName, resource: ep };
};

interface Props extends BasicResourceArgs {
  vaultInfo?: KeyVaultInfo;

  /** if Auth is not provided it will be auto generated */
  auth?: {
    /** create a Admin group on AzAD for SQL accessing.*/
    enableAdAdministrator: boolean;
    adminLogin: Input<string>;
    password: Input<string>;
  };

  elasticPool?: {
    name: "Standard" | "Basic";
    capacity: ElasticPoolCapacityProps;
  };

  databases: Array<
    Omit<SqlDbProps, "sqlServerName" | "group" | "elasticPoolId" | "dependsOn">
  >;

  network?: {
    subnetId?: Input<string>;
    ipAddresses?: Input<string>[];
    /** To enable Private Link need to ensure the subnetId is provided. */
    privateLink?: Omit<PrivateLinkProps, "subnetId">;
  };

  vulnerabilityAssessment?: {
    alertEmails: Array<string>;
    logStorageId?: Input<string>;
    storageAccessKey: Input<string>;
    storageEndpoint: Input<string>;
  };
  lock?: boolean;
}

export default async ({
  name,
  auth,
  group,

  elasticPool,
  databases,
  vaultInfo,

  network,
  vulnerabilityAssessment,
  lock = true,
}: Props): Promise<
  BasicResourceResultProps<sql.Server> & {
    elasticPool?: BasicResourceResultProps<sql.ElasticPool>;
    databases?: Array<BasicResourceResultProps<sql.Database>>;
    adminGroup?: azuread.Group;
  }
> => {
  const sqlName = getSqlServerName(name);

  if (vaultInfo && !auth) {
    const login = await randomLogin({ name, loginPrefix: "sql", vaultInfo });
    auth = {
      enableAdAdministrator: true,
      adminLogin: login.userName,
      password: login.password,
    };
  }

  const adminGroup = auth?.enableAdAdministrator
    ? roleCreator({
        env: currentEnv,
        appName: name,
        roleName: "Db-Admin",
      })
    : undefined;

  const sqlServer = new sql.Server(sqlName, {
    serverName: sqlName,
    ...group,
    version: "12.0",
    minimalTlsVersion: "1.2",

    identity: { type: "SystemAssigned" },

    administratorLogin: auth?.adminLogin,
    administratorLoginPassword: auth?.password,

    administrators:
      auth?.enableAdAdministrator && adminGroup
        ? {
            administratorType: sql.AdministratorType.ActiveDirectory,
            azureADOnlyAuthentication: !auth?.adminLogin,

            principalType: sql.PrincipalType.Group,
            tenantId,
            sid: adminGroup.id,
            login: `${name}Admin`,
          }
        : undefined,

    publicNetworkAccess: network?.privateLink
      ? sql.ServerPublicNetworkAccess.Disabled
      : sql.ServerPublicNetworkAccess.Enabled,

    tags: defaultTags,
  });

  if (lock) {
    Locker({ name: sqlName, resourceId: sqlServer.id, dependsOn: sqlServer });
  }

  const ep = elasticPool
    ? createElasticPool({
        name,
        group,
        sqlName: sqlServer.name,
        sku: elasticPool,
      })
    : undefined;

  if (network?.subnetId) {
    if (network.privateLink) {
      privateEndpointCreator({
        group,
        name,
        resourceId: sqlServer.id,
        privateDnsZoneName: "privatelink.database.windows.net",
        ...network.privateLink,
        subnetId: network.subnetId,
        linkServiceGroupIds: ["sqlServer"],
      });
    } else {
      //Link to Vnet
      new sql.VirtualNetworkRule(sqlName, {
        virtualNetworkRuleName: `${sqlName}-vnetRule`,
        serverName: sqlServer.name,
        ...group,

        virtualNetworkSubnetId: network.subnetId,
        ignoreMissingVnetServiceEndpoint: false,
      });

      //Public IpAddresses
      if (network.ipAddresses) {
        all(network.ipAddresses).apply((ips) =>
          convertToIpRange(ips).map((ip, i) => {
            const n = `${sqlName}-fwRule-${i}`;

            return new sql.FirewallRule(n, {
              firewallRuleName: n,
              serverName: sqlServer.name,
              ...group,
              startIpAddress: ip.start,
              endIpAddress: ip.end,
            });
          })
        );
      }
    }
  }

  if (vulnerabilityAssessment) {
    //Grant Storage permission
    if (vulnerabilityAssessment.logStorageId) {
      await roleAssignment({
        name,
        principalId: sqlServer.identity.apply((i) => i?.principalId || ""),
        principalType: "ServicePrincipal",
        roleName: "Storage Blob Data Contributor",
        scope: vulnerabilityAssessment.logStorageId,
      });
    }

    //Server Audit
    new sql.ExtendedServerBlobAuditingPolicy(name, {
      auditActionsAndGroups: [
        "SUCCESSFUL_DATABASE_AUTHENTICATION_GROUP",
        "FAILED_DATABASE_AUTHENTICATION_GROUP",
        "BATCH_COMPLETED_GROUP",
      ],
      serverName: sqlServer.name,
      ...group,

      blobAuditingPolicyName: "default",
      isAzureMonitorTargetEnabled: true,
      isStorageSecondaryKeyInUse: false,
      predicateExpression: "object_name = 'SensitiveData'",
      queueDelayMs: 4000,
      retentionDays: isPrd ? 30 : 6,
      state: "Enabled",
      isDevopsAuditEnabled: true,

      storageAccountAccessKey: vulnerabilityAssessment.storageAccessKey,
      storageAccountSubscriptionId: subscriptionId,
      storageEndpoint: vulnerabilityAssessment.storageEndpoint,
    });

    //ServerSecurityAlertPolicy
    new sql.ServerSecurityAlertPolicy(name, {
      securityAlertPolicyName: name,
      ...group,
      serverName: sqlServer.name,
      emailAccountAdmins: !vulnerabilityAssessment.alertEmails,
      emailAddresses: vulnerabilityAssessment.alertEmails,

      retentionDays: 7,

      storageAccountAccessKey: vulnerabilityAssessment.storageAccessKey,
      storageEndpoint: vulnerabilityAssessment.storageEndpoint,
      state: "Enabled",
    });

    //ServerVulnerabilityAssessment
    new sql.ServerVulnerabilityAssessment(name, {
      vulnerabilityAssessmentName: name,
      ...group,
      serverName: sqlServer.name,

      recurringScans: {
        isEnabled: true,
        emailSubscriptionAdmins: !vulnerabilityAssessment.alertEmails,
        emails: vulnerabilityAssessment.alertEmails,
      },

      storageContainerPath: interpolate`${vulnerabilityAssessment.storageEndpoint}/${sqlName}`,
      storageAccountAccessKey: vulnerabilityAssessment.storageAccessKey,
    });
  }

  let dbs: Array<BasicResourceResultProps<sql.Database>> | undefined;
  if (databases) {
    dbs = databases.map((db) => {
      const d = sqlDbCreator({
        ...db,
        group,
        sqlServerName: sqlName,
        dependsOn: sqlServer,
        elasticPoolId: ep ? ep.resource.id : undefined,
      });

      if (vaultInfo) {
        const connectionString = auth?.adminLogin
          ? interpolate`Data Source=${sqlName}.database.windows.net;Initial Catalog=${
              d.name
            };User Id=${auth.adminLogin};Password=${
              auth!.password
            };MultipleActiveResultSets=False;Encrypt=True;TrustServerCertificate=False;Connection Timeout=120;`
          : interpolate`Data Source=${sqlName}.database.windows.net;Initial Catalog=${d.name};Authentication=Active Directory Integrated;;MultipleActiveResultSets=False;Encrypt=True;TrustServerCertificate=False;Connection Timeout=120;`;

        addSecret({
          name: d.name,
          value: connectionString,
          vaultInfo,
          contentType: `Sql ${d.name} Connection String`,
          dependsOn: d.resource,
          tags: defaultTags,
        });
      }

      return d;
    });
  }

  return {
    name: sqlName,
    resource: sqlServer,
    elasticPool: ep,
    databases: dbs,
    adminGroup,
  };
};
