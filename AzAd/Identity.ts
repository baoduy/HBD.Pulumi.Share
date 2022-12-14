import * as azureAD from '@pulumi/azuread';
import * as pulumi from '@pulumi/pulumi';
import { getIdentityName } from '../Common/Naming';
import {
  ApplicationAppRole,
  ApplicationRequiredResourceAccess,
  ApplicationApiOauth2PermissionScope,
} from '@pulumi/azuread/types/input';

import { KeyVaultInfo } from '../types';
import { Input, Output } from '@pulumi/pulumi';
import { ServicePrincipal } from '@pulumi/azuread';
import { randomPassword } from '../Core/Random';
import { roleAssignment } from './RoleAssignment';
import { defaultScope } from '../Common/AzureEnv';
import { addCustomSecret } from '../KeyVault/CustomHelper';

type PreAuthApplicationProps = {
  appId: string;
  oauth2PermissionNames: string[];
};

type IdentityProps = {
  name: string;
  owners?: pulumi.Input<pulumi.Input<string>[]>;
  createClientSecret?: boolean;
  /** if UI app set public client is true */
  homepage?: pulumi.Input<string>;
  publicClient?: boolean;
  createPrincipal?: boolean;
  replyUrls?: pulumi.Input<pulumi.Input<string>[]>;
  allowImplicit?: boolean;
  allowMultiOrg?: boolean;
  appRoles?: pulumi.Input<pulumi.Input<ApplicationAppRole>[]>;
  oauth2Permissions?: pulumi.Input<
    pulumi.Input<ApplicationApiOauth2PermissionScope>[]
  >;
  appRoleAssignmentRequired?: boolean;
  preAuthApplications?: PreAuthApplicationProps[];
  requiredResourceAccesses?: pulumi.Input<
    pulumi.Input<ApplicationRequiredResourceAccess>[]
  >;
  /**The Role Assignment of principal. If scope is not defined the default scope will be at subscription level*/
  principalRoles?: Array<{
    roleName: string;
    scope?: Input<string>;
  }>;
  vaultInfo?: KeyVaultInfo;
};

export type IdentityResult = {
  name: string;
  objectId: Output<string>;
  clientId: Output<string>;
  clientSecret: Output<string> | undefined;
  principalId: Output<string> | undefined;
  principalSecret: Output<string> | undefined;
  resource: azureAD.Application;
};

export default async ({
  name,
  owners,
  createClientSecret = false,
  createPrincipal = false,
  homepage,
  replyUrls,
  allowImplicit = false,
  allowMultiOrg = false,
  appRoles,
  appRoleAssignmentRequired,
  requiredResourceAccesses = [],
  oauth2Permissions,
  publicClient = false,
  principalRoles,
  vaultInfo,
}: IdentityProps): Promise<
  IdentityResult & {
    vaultNames: {
      clientIdKeyName: string;
      clientSecretKeyName: string;
      principalIdKeyName: string;
      principalSecretKeyName: string;
    };
  }
> => {
  // Azure AD Application no need suffix
  name = getIdentityName(name);

  const clientIdKeyName = `${name}-client-id`;
  const clientSecretKeyName = `${name}-client-secret`;
  const principalIdKeyName = `${name}-principal-id`;
  const principalSecretKeyName = `${name}-principal-secret`;

  const identifierUris = publicClient
    ? undefined
    : [`api://${name.toLowerCase()}`];

  const app = new azureAD.Application(name, {
    displayName: name,

    owners,
    appRoles,
    signInAudience: allowMultiOrg ? 'AzureADMultipleOrgs' : 'AzureADMyOrg',
    groupMembershipClaims: ['SecurityGroup'],
    identifierUris,

    publicClient: publicClient ? { redirectUris: replyUrls } : undefined,

    // singlePageApplication: allowImplicit
    //   ? { redirectUris: replyUrls }
    //   : undefined,
    singlePageApplication: allowImplicit
      ? {
          //homepageUrl: homepage,
          //implicitGrant: { accessTokenIssuanceEnabled: true },
          redirectUris: replyUrls,
        }
      : undefined,

    //web: {},

    api: !allowImplicit
      ? { oauth2PermissionScopes: oauth2Permissions }
      : undefined,

    requiredResourceAccesses: requiredResourceAccesses
      ? pulumi.output(requiredResourceAccesses).apply((r) => [...r])
      : undefined,
  });

  if (vaultInfo)
    addCustomSecret({
      name: clientIdKeyName,
      value: app.applicationId,
      vaultInfo,
      contentType: 'Identity',
    });

  let clientSecret: Output<string> | undefined = undefined;
  if (createClientSecret) {
    clientSecret = new azureAD.ApplicationPassword(name, {
      displayName: name,
      applicationObjectId: app.objectId,
      endDateRelative: '43800h',
      //value: randomPassword({ name: `${name}-clientSecret` }).result,
    }).value;

    if (vaultInfo)
      addCustomSecret({
        name: clientSecretKeyName,
        value: clientSecret,
        vaultInfo,
        contentType: 'Identity',
      });
  }

  let principal: ServicePrincipal | undefined;
  let principalSecret: Output<string> | undefined = undefined;

  if (createPrincipal || appRoleAssignmentRequired) {
    principal = new azureAD.ServicePrincipal(name, {
      //Allow to access to application as the permission is manage by Group assignment.
      appRoleAssignmentRequired,
      applicationId: app.applicationId,
    });

    principalSecret = new azureAD.ServicePrincipalPassword(name, {
      displayName: name,
      servicePrincipalId: principal.objectId,
      endDateRelative: '43800h',
      //value: randomPassword({ name: `${name}-principalSecret` }).result,
    }).value;

    if (principalRoles) {
      await Promise.all(
        principalRoles.map((r) =>
          roleAssignment({
            name,
            roleName: r.roleName,
            principalId: principal!.id,
            principalType: 'ServicePrincipal',
            scope: r.scope || defaultScope,
          })
        )
      );
    }

    if (vaultInfo) {
      addCustomSecret({
        name: principalIdKeyName,
        value: principal.objectId,
        vaultInfo,
        contentType: 'Identity',
      });

      addCustomSecret({
        name: principalSecretKeyName,
        value: principalSecret,
        vaultInfo,
        contentType: 'Identity',
      });
    }
  }

  return {
    name,
    objectId: app.objectId,
    clientId: app.applicationId,
    clientSecret,
    principalId: principal?.objectId,
    principalSecret,
    resource: app,
    vaultNames: {
      clientIdKeyName,
      clientSecretKeyName,
      principalIdKeyName,
      principalSecretKeyName,
    },
  };
};
