import { Input, output, Resource, Config } from "@pulumi/pulumi";
import { getSecretName } from "../Common/Naming";
import { VaultSecretResource } from "../CustomProviders/VaultSecret";
import { KeyVaultInfo } from "../types";

interface Props {
  name: string;
  value?: Input<string>;
  config?: Config;
  vaultInfo: KeyVaultInfo;
}

/**Add key vault secret from a value or from pulumi configuration secret. */
export const addVaultSecretFrom = async ({
  name,
  value,
  config,
  vaultInfo,
}: Props) => {
  if (config && !value) value = config.getSecret(name);
  if (!value) throw new Error(`The value of "${name}" is not defined.`);

  addCustomSecret({
    name,
    value,
    vaultInfo,
    contentType: "config variables",
  });
};

type SecretProps = {
  name: string;
  /**Use the name directly without applying naming format*/
  formattedName?: boolean;
  value: Input<string>;
  vaultInfo: KeyVaultInfo;
  contentType?: Input<string>;
  tags?: Input<{
    [key: string]: string;
  }>;
  dependsOn?: Input<Resource> | Input<Input<Resource>[]>;
};

// export const addKey = ({
//   name,
//   vaultInfo,
//   tags,
//   dependsOn,
// }: Omit<SecretProps, 'value' | 'contentType'>) => {
//   const n = getSecretName(name);
//   return new azure.keyvault.Key(
//     name,
//     {
//       name: n,
//       keyType: 'RSA',
//       keySize: 2048,
//       keyVaultId: vaultInfo.id,
//       keyOpts: ['decrypt', 'encrypt', 'sign', 'verify', 'wrapKey', 'unwrapKey'],
//       tags,
//     },
//     { dependsOn }
//   );
// };

/** Add variable to Key Vault. This will auto recover the deleted item and update with a new value if existed. */
export const addCustomSecret = ({
  name,
  formattedName,
  vaultInfo,
  value,
  contentType,
  tags,
  dependsOn,
}: SecretProps) => {
  const n = formattedName ? name : getSecretName(name);
  //This KeyVault Secret is not auto recovery the deleted one.
  return new VaultSecretResource(
    name,
    {
      name: n,
      value: value ? output(value).apply((v) => v || "") : "",
      vaultInfo,
      contentType: contentType || name,
      tags,
    },
    { dependsOn }
  );
};
