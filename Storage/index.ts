import * as storage from '@pulumi/azure-native/storage';

import { AppInsightInfo, KeyVaultInfo, BasicResourceArgs } from '../types';
import { Input, Output } from '@pulumi/pulumi';
import { createThreatProtection } from '../Logs/Helpers';
import { addInsightMonitor } from '../Logs/WebTest';
import { getSecret, parseKeyUrl } from '../KeyVault/Helper';
import { defaultTags, isPrd } from '../Common/AzureEnv';

import cdnCreator from './CdnEndpoint';

import {
  getConnectionName,
  getKeyName,
  getStorageName,
} from '../Common/Naming';
import { addCustomSecret } from '../KeyVault/CustomHelper';
import Locker from '../Core/Locker';
import {
  createManagementRules,
  DefaultManagementRules,
  ManagementRules,
} from './ManagementRules';

type ContainerProps = {
  name: string;
  public?: boolean;
  /** The management rule applied to Container level*/
  managementRules?: Array<ManagementRules>;
};

interface StorageProps extends BasicResourceArgs {
  customDomain?: string;
  allowsCors?: string[];
  encryptionKeyUrl?: Output<string> | string;
  vaultInfo: KeyVaultInfo;

  /** The management rule applied to Storage level (all containers)*/
  defaultManagementRules?: Array<DefaultManagementRules>;

  containers?: Array<ContainerProps>;
  queues?: Array<string>;
  fileShares?: Array<string>;

  appInsight?: AppInsightInfo;

  featureFlags?: {
    allowSharedKeyAccess?: boolean;
    /** Enable this storage as static website. */
    enableStaticWebsite?: boolean;
    /**Only available when static site using CDN*/
    includesDefaultResponseHeaders?: boolean;

    /** The CDN is automatic enabled when the customDomain is provided. However, turn this on to force enable CDN regardless to customDomain. */
    forceUseCdn?: boolean;
    /** This option only able to enabled once Account is created and the Principal added to the Key Vault Read Permission Group */
    enableAccountLevelEncryption?: boolean;
  };

  policies?: {
    keyExpirationPeriodInDays?: number;
    isBlobVersioningEnabled?: boolean;
    blobSoftDeleteDays?: number;
    allowBlobPublicAccess?: boolean;
    containerSoftDeleteDays?: number;
    fileShareSoftDeleteDays?: number;
  };

  network?: { subnetId?: Input<string>; ipAddresses?: Array<string> };

  onKeysLoaded?: (
    keys: Array<{ name: string; key: string; connectionString: string }>,
    storageName: Output<string>
  ) => Promise<void>;
  lock?: boolean;
}

/** Storage Creator */
export default ({
  name,
  group,
  customDomain,
  allowsCors,
  vaultInfo,
  encryptionKeyUrl,
  defaultManagementRules,
  containers = [],
  queues = [],
  fileShares = [],
  appInsight,
  network,
  featureFlags = {},
  policies = { keyExpirationPeriodInDays: 365 },
  onKeysLoaded,
  lock = true,
}: StorageProps) => {
  name = getStorageName(name);

  const primaryKeyName = getKeyName(name, 'primary');
  const secondaryKeyName = getKeyName(name, 'secondary');
  const primaryConnectionKeyName = getConnectionName(name, 'primary');
  const secondConnectionKeyName = getConnectionName(name, 'secondary');

  const keyInfo = encryptionKeyUrl
    ? typeof encryptionKeyUrl === 'string'
      ? parseKeyUrl(encryptionKeyUrl)
      : encryptionKeyUrl.apply(parseKeyUrl)
    : undefined;

  //To fix identity issue then using this approach https://github.com/pulumi/pulumi-azure-native/blob/master/examples/keyvault/index.ts
  const stg = new storage.StorageAccount(name, {
    accountName: name,
    ...group,

    kind: storage.Kind.StorageV2,
    sku: {
      name: isPrd
        ? storage.SkuName.Standard_ZRS //Zone redundant in PRD
        : storage.SkuName.Standard_LRS,
    },
    accessTier: 'Hot',

    isHnsEnabled: true,
    enableHttpsTrafficOnly: true,
    allowBlobPublicAccess: policies?.allowBlobPublicAccess,
    allowSharedKeyAccess: featureFlags.allowSharedKeyAccess,
    identity: { type: 'SystemAssigned' },
    minimumTlsVersion: 'TLS1_2',

    //1 Year Months
    keyPolicy: {
      keyExpirationPeriodInDays: policies.keyExpirationPeriodInDays || 365,
    },

    encryption:
      keyInfo && featureFlags.enableAccountLevelEncryption
        ? {
            keySource: 'Microsoft.Keyvault',
            keyVaultProperties: {
              keyName: keyInfo.name,
              keyVaultUri: keyInfo.vaultUrl,
              keyVersion: keyInfo.version,
            },
          }
        : undefined,

    sasPolicy: {
      expirationAction: storage.ExpirationAction.Log,
      sasExpirationPeriod: '00.00:30:00',
    },

    customDomain:
      customDomain && !featureFlags.enableStaticWebsite
        ? { name: customDomain, useSubDomainName: true }
        : undefined,

    // routingPreference: {
    //   routingChoice: enableStaticWebsite
    //     ? native.storage.RoutingChoice.InternetRouting
    //     : native.storage.RoutingChoice.MicrosoftRouting,
    //   publishInternetEndpoints: false,
    //   publishMicrosoftEndpoints: false,
    // },

    networkRuleSet: network
      ? {
          bypass: 'Logging, Metrics',
          defaultAction: 'Allow',

          virtualNetworkRules: network.subnetId
            ? [{ virtualNetworkResourceId: network.subnetId }]
            : undefined,

          ipRules: network.ipAddresses
            ? network.ipAddresses.map((i) => ({
                iPAddressOrRange: i,
                action: 'Allow',
              }))
            : undefined,
        }
      : { defaultAction: 'Allow' },

    tags: defaultTags,
  });

  //Soft Delete
  if (policies) {
    // new storage.BlobServiceProperties(
    //   `${name}-Blob-Props`,
    //   {
    //     accountName: stg.name,
    //     ...group,
    //
    //     deleteRetentionPolicy: policies.blobSoftDeleteDays
    //       ? {
    //           enabled: policies.blobSoftDeleteDays > 0,
    //           days: policies.blobSoftDeleteDays,
    //         }
    //       : undefined,
    //     isVersioningEnabled: policies.isBlobVersioningEnabled,
    //   },
    //   { dependsOn: stg }
    // );
    //
    // new storage.FileServiceProperties(
    //   `${name}-File-Props`,
    //   {
    //     accountName: stg.name,
    //     ...group,
    //
    //     shareDeleteRetentionPolicy: policies.fileShareSoftDeleteDays
    //       ? {
    //           enabled: policies.fileShareSoftDeleteDays > 0,
    //           days: policies.fileShareSoftDeleteDays,
    //         }
    //       : undefined,
    //   },
    //   { dependsOn: stg }
    // );
  }

  //Life Cycle Management
  if (defaultManagementRules) {
    createManagementRules({
      name,
      storageAccount: stg,
      group,
      rules: defaultManagementRules,
    });
  }

  if (lock) {
    Locker({ name, resourceId: stg.id, dependsOn: stg });
  }

  //Enable Static Website for SPA
  if (featureFlags.enableStaticWebsite) {
    new storage.StorageAccountStaticWebsite(
      name,
      {
        accountName: stg.name,
        ...group,
        indexDocument: 'index.html',
        error404Document: 'index.html',
      },
      { dependsOn: stg }
    );

    if (appInsight && customDomain) {
      addInsightMonitor({ name, appInsight, url: customDomain });
    }
  } else if (isPrd) createThreatProtection({ name, targetResourceId: stg.id });

  //Create Azure CDN if customDomain provided
  if (
    (featureFlags.enableStaticWebsite && customDomain) ||
    featureFlags.forceUseCdn
  ) {
    const origin = stg.name.apply((n) => `${n}.z23.web.core.windows.net`);
    cdnCreator({
      name,
      domainName: customDomain!,
      origin,
      cors: allowsCors,
      httpsEnabled: true,
      includesDefaultResponseHeaders:
        featureFlags.includesDefaultResponseHeaders,
    });
  }

  //Create Containers
  containers.map((c) => {
    const container = new storage.BlobContainer(c.name, {
      containerName: c.name.toLowerCase(),
      ...group,
      accountName: stg.name,
      defaultEncryptionScope: featureFlags.enableAccountLevelEncryption
        ? 'AccountScope'
        : undefined,
      //denyEncryptionScopeOverride: true,
      publicAccess: c.public ? 'Blob' : 'None',
    });

    if (c.managementRules) {
      createManagementRules({
        name,
        storageAccount: stg,
        group,
        containerNames: [container.name],
        rules: c.managementRules,
      });
    }
    return container;
  });

  //Create Queues
  queues.map((q) => {
    new storage.Queue(q, {
      queueName: q.toLowerCase(),
      accountName: stg.name,
      ...group,
    });
  });

  //File Share
  fileShares.map((s) => {
    new storage.FileShare(s, {
      shareName: s.toLowerCase(),
      accountName: stg.name,
      ...group,
    });
  });

  //Add Key to
  stg.id.apply(async (id) => {
    if (!id) return;

    const keys = (
      await storage.listStorageAccountKeys({
        accountName: name,
        resourceGroupName: group.resourceGroupName,
      })
    ).keys.map((k) => ({
      name: k.keyName,
      key: k.value,
      connectionString: `DefaultEndpointsProtocol=https;AccountName=${name};AccountKey=${k.value};EndpointSuffix=core.windows.net`,
    }));

    if (onKeysLoaded) await onKeysLoaded(keys, stg.name);

    if (vaultInfo) {
      //Keys
      addCustomSecret({
        name: primaryKeyName,
        value: keys[0].key,
        vaultInfo,
        contentType: 'Storage',
        formattedName: true,
      });

      addCustomSecret({
        name: secondaryKeyName,
        value: keys[0].connectionString,
        vaultInfo,
        contentType: 'Storage',
        formattedName: true,
      });

      //Connection String. The custom Secret will auto restore the deleted secret
      addCustomSecret({
        name: primaryConnectionKeyName,
        value: keys[0].connectionString,
        vaultInfo,
        contentType: 'Storage',
        formattedName: true,
      });

      addCustomSecret({
        name: secondConnectionKeyName,
        value: keys[0].connectionString,
        vaultInfo,
        contentType: 'Storage',
        formattedName: true,
      });
    }
  });

  return {
    storage: stg,
    vaultNames: {
      primaryKeyName,
      secondaryKeyName,
      primaryConnectionKeyName,
      secondConnectionKeyName,
    },
    getConnectionString: (name: string = primaryConnectionKeyName) =>
      getSecret({ name, vaultInfo }),
  };
};
