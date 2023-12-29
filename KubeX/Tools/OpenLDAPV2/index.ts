import * as k8s from '@pulumi/kubernetes';
import { randomPassword, randomLogin } from '../../../Core/Random';
import { DefaultK8sArgs } from '../../types';
import { KeyVaultInfo } from '../../../types';
import Namespace from '../../Core/Namespace';

export interface OpenLDAPProps extends Omit<DefaultK8sArgs, 'namespace'> {
  vaultInfo?: KeyVaultInfo;
  namespace?: string;
  replicas?: number;
  storageClassName: string;
  ldapDomain: string;
}

export default ({
  name = 'openldap',
  namespace = 'ldap',
  vaultInfo,
  resources,
  replicas = 1,
  ldapDomain,
  storageClassName,
  ...others
}: OpenLDAPProps) => {
  //Admin Pass
  const adminUser = `${name}Admin`;
  const adminPass = randomPassword({
    name: `${name}-admin`,
    vaultInfo,
    length: 25,
    options: { special: false },
    policy: false,
  });
  //Config Pass
  const configUser = `${name}Config`;
  const configPass = randomPassword({
    name: `${name}-config`,
    vaultInfo,
    length: 25,
    options: { special: false },
    policy: false,
  });
  const ns = Namespace({ name: namespace, ...others });

  //https://github.com/jp-gouin/helm-openldap/blob/master/values.yaml
  const openLDAP = new k8s.helm.v3.Chart(
    name,
    {
      namespace,
      chart: 'openldap-stack-ha',
      fetchOpts: { repo: 'https://jp-gouin.github.io/helm-openldap' },

      values: {
        users: 'demo',
        userPasswords: 'demo@stdynamo',

        global: {
          ldapDomain,
          adminUser,
          adminPassword: adminPass.result,
          configUserEnabled: true,
          configUser,
          configPassword: configPass.result,
        },
        replicaCount: replicas,
        initTLSSecret: {
          enabled: false,
          tls_enabled: false,
          secret: undefined,
        },
        phpldapadmin: {
          enabled: true,
          ingress: { enabled: false, ingressClassName: 'nginx' },
        },
        'ltb-passwd': {
          enabled: false,
          ingress: { enabled: false, ingressClassName: 'nginx' },
        },
        persistence: { storageClass: storageClassName },
        resources,
      },
    },
    { provider: others.provider, dependsOn: ns }
  );

  return openLDAP;
};
