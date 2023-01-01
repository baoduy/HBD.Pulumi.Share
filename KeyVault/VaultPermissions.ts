import * as vault from '@pulumi/azure/keyvault';
import * as pulumi from '@pulumi/pulumi';

import { roleAssignment } from '../AzAd/RoleAssignment';
import { tenantId } from '../Common/AzureEnv';
import { KeyVaultInfo } from '../types';

export interface PermissionProps {
  /** The object ID of a user, service principal or security group in the Azure Active Directory tenant for the vault. The object ID must be unique for the list of access policies. */
  objectId: pulumi.Input<string>;
  /** Application ID of the client making request on behalf of a principal */
  applicationId?: pulumi.Input<string>;
  permission: 'ReadOnly' | 'ReadWrite';
}

export const grantVaultRbacPermission = async ({
  name,
  objectId,
  permission,
  scope,
}: PermissionProps & {
  name: string;
  scope: pulumi.Input<string>;
}) => {
  const vn = `${name}-${permission}`.toLowerCase();

  const defaultProps = {
    principalId: objectId,
    scope,
  };

  //ReadOnly
  if (permission === 'ReadOnly') {
    await roleAssignment({
      ...defaultProps,
      name: `${vn}-encrypt`,
      roleName: 'Key Vault Crypto Service Encryption User',
    });
    await roleAssignment({
      ...defaultProps,
      name: `${vn}-crypto`,
      roleName: 'Key Vault Crypto User',
    });
    await roleAssignment({
      ...defaultProps,
      name: `${vn}-secret`,
      roleName: 'Key Vault Secrets User',
    });
    //Read and Write
  } else {
    await roleAssignment({
      ...defaultProps,
      name: `${vn}-cert`,
      roleName: 'Key Vault Certificates Officer',
    });
    await roleAssignment({
      ...defaultProps,
      name: `${vn}-crypto`,
      roleName: 'Key Vault Crypto Officer',
    });
    await roleAssignment({
      ...defaultProps,
      name: `${vn}-secret`,
      roleName: 'Key Vault Secrets Officer',
    });
  }
};

export const KeyVaultAdminPolicy = {
  certificates: [
    'Backup',
    'Create',
    'Delete',
    'DeleteIssuers',
    'Get',
    'GetIssuers',
    'Import',
    'List',
    'ManageContacts',
    'ManageIssuers',
    'Purge',
    'Recover',
    'Restore',
    'SetIssuers',
    'Update',
  ],
  keys: [
    'Backup',
    'Create',
    'Decrypt',
    'Delete',
    'Encrypt',
    'Get',
    'Import',
    'List',
    'Purge',
    'Recover',
    'Restore',
    'Sign',
    'UnwrapKey',
    'Update',
    'Verify',
    'WrapKey',
  ],
  secrets: [
    'Backup',
    'Delete',
    'Get',
    'List',
    'Purge',
    'Recover',
    'Restore',
    'Set',
  ],
  storage: [
    'Backup',
    'Delete',
    'DeleteSAS',
    'Get',
    'GetSAS',
    'List',
    'ListSAS',
    'Purge',
    'Recover',
    'Regeneratekey',
    'Restore',
    'Set',
    'SetSAS',
    'Update',
  ],
};

export const KeyVaultReadOnlyPolicy = {
  certificates: ['Get', 'List'],
  keys: [
    'Get',
    'List',
    'Decrypt',
    'Encrypt',
    'Sign',
    'UnwrapKey',
    'Verify',
    'WrapKey',
  ],
  secrets: ['Get', 'List'],
  storage: ['Get', 'List'],
};

export const grantVaultAccessPolicy = ({
  name,
  objectId,
  permission,
  vaultInfo,
}: PermissionProps & {
  name: string;
  vaultInfo: KeyVaultInfo;
}) =>
  new vault.AccessPolicy(name, {
    keyVaultId: vaultInfo.id,
    objectId,
    tenantId,
    certificatePermissions:
      permission === 'ReadOnly'
        ? KeyVaultReadOnlyPolicy.certificates
        : KeyVaultAdminPolicy.certificates,
    keyPermissions:
      permission === 'ReadOnly'
        ? KeyVaultReadOnlyPolicy.keys
        : KeyVaultAdminPolicy.keys,
    secretPermissions:
      permission === 'ReadOnly'
        ? KeyVaultReadOnlyPolicy.secrets
        : KeyVaultAdminPolicy.secrets,
    storagePermissions:
      permission === 'ReadOnly'
        ? KeyVaultReadOnlyPolicy.storage
        : KeyVaultAdminPolicy.storage,
  });
