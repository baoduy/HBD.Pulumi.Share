import { getGraphPermissions } from '../AzAd/GraphDefinition';
import identityCreator from '../AzAd/Identity';
import { KeyVaultInfo } from '../types';
import { roleAssignment } from '../AzAd/RoleAssignment';
import { defaultScope } from '../Common/AzureEnv';

interface Props {
  name: string;
  vaultInfo: KeyVaultInfo;
}

//** The AzAD app Identity for Azure Kubernetes for RBAC */
export default ({ name, vaultInfo }: Props) => {
  //AKS need this permission for AAD integration
  const graphAccess = getGraphPermissions(
    { name: 'User.Read', type: 'Scope' },
    { name: 'Group.Read.All', type: 'Scope' },
    //{ name: 'Directory.Read.All', type: 'Scope' },
    { name: 'Directory.Read.All', type: 'Role' }
  );

  const serverIdentity = identityCreator({
    name,
    createClientSecret: true,
    createPrincipal: true,
    requiredResourceAccesses: [graphAccess],
    publicClient: false,
    appType: 'api',
    vaultInfo,
  });

  roleAssignment({
    name: `${name}-aks-identity-acr-pull`,
    principalId: serverIdentity.principalId!,
    principalType: 'ServicePrincipal',
    roleName: 'AcrPull',
    scope: defaultScope,
  });

  serverIdentity.clientId.apply((i) => console.log(i));
  return serverIdentity;
};
