import * as network from "@pulumi/azure-native/network";
import { Input, output } from "@pulumi/pulumi";
import { BasicResourceArgs, PrivateLinkProps } from "../types";
import { getVnetIdFromSubnetId } from "./Helper";
import PrivateZone, { linkVnetToPrivateDns, addARecord } from "./PrivateDns";
import { getResourceInfoFromId } from "../Common/AzureEnv";

interface Props extends BasicResourceArgs, PrivateLinkProps {
  resourceId: Input<string>;
  privateDnsZoneName: string;
  linkServiceGroupIds: string[];
}

export default ({
  name,
  group,
  resourceId,
  subnetId,
  privateDnsZoneName,
  useGlobalDnsZone,
  linkServiceGroupIds,
}: Props) => {
  const endpoint = new network.PrivateEndpoint(name, {
    privateEndpointName: name,
    ...group,

    subnet: { id: subnetId },
    privateLinkServiceConnections: [
      {
        groupIds: linkServiceGroupIds,
        name: `${name}-conn`,
        privateLinkServiceId: resourceId,
      },
    ],
  });

  //Get IpAddress in
  const ipAddresses = endpoint.customDnsConfigs.apply((c) =>
    c!.flatMap((i) => i.ipAddresses!)
  );

  output(resourceId).apply((id) => {
    const resourceInfo = getResourceInfoFromId(id);

    if (useGlobalDnsZone) {
      //Add A Record
      addARecord({
        ipAddresses,
        recordName: resourceInfo?.name || "",
        zoneName: privateDnsZoneName,
      });

      //Link to Vnet
      output(subnetId).apply((sId) => {
        const vnetId = getVnetIdFromSubnetId(sId);
        linkVnetToPrivateDns({
          zoneName: privateDnsZoneName,
          vnetId,
        });
      });
    } else {
      //Create Zone
      const zone = PrivateZone({
        name: `${resourceInfo?.name}.${privateDnsZoneName}`,
        group,
      });

      //Add Root Record
      addARecord({
        ipAddresses,
        recordName: "@",
        zoneName: privateDnsZoneName,
        dependsOn: zone,
      });
      //Link to Vnet
      output(subnetId).apply((sId) => {
        const vnetId = getVnetIdFromSubnetId(sId);
        linkVnetToPrivateDns({
          zoneName: privateDnsZoneName,
          vnetId,
          group,
          dependsOn: zone,
        });
      });
    }
  });
  //TODO: Create private DNS Zone in the same resource group and link to VNet
  return endpoint;
};
