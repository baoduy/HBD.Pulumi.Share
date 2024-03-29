import { currentEnv } from '../Common/AzureEnv';
import Role, { getRoleName, RoleNameType } from './Role';
import { getAdoIdentity } from './Identities/AzDevOps';
import { addUserToGroup } from './Group';

const envRoleConfig = {
  readOnly: {
    env: currentEnv,
    roleName: 'Readonly',
    appName: 'Azure',
  } as RoleNameType,
  contributor: {
    env: currentEnv,
    roleName: 'Contributor',
    appName: 'Azure',
  } as RoleNameType,
  admin: {
    env: currentEnv,
    roleName: 'Admin',
    appName: 'Azure',
  } as RoleNameType,
};

export type EnvRoleNamesType = { [k in keyof typeof envRoleConfig]: string };

export const getEnvRoleNames = (
): EnvRoleNamesType => ({
  readOnly: getRoleName({ ...envRoleConfig.readOnly,  }),
  contributor: getRoleName({
    ...envRoleConfig.contributor
  }),
  admin: getRoleName({ ...envRoleConfig.admin,  }),
});

export default () => {
  //Admin
  const adminGroup =  Role({
    ...envRoleConfig.admin,
    //permissions: [{ roleName: 'Reader', scope: defaultScope }],
  });

  //Contributor
 const contributor= Role({
    ...envRoleConfig.contributor,
    //permissions: [{ roleName: 'Reader', scope: defaultScope }],
    members:[adminGroup.objectId],
  });

  //ReadOnly
   Role({
    ...envRoleConfig.readOnly,
    //permissions: [{ roleName: 'Reader', scope: defaultScope }],
     members:[contributor.objectId],
  });

  //Add Global ADO Identity as Admin
  const ado = getAdoIdentity();
  addUserToGroup({
    name: 'ado-admin-role',
    groupObjectId: adminGroup.objectId,
    objectId: ado.principal.objectId,
  });

  return getEnvRoleNames();
};
