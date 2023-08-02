import { Output } from '@pulumi/pulumi';
import * as native from '@pulumi/azure-native';
import CdnHttpsEnable from './CdnHttpsEnable';
import {
  getDefaultResponseHeadersRule,
  enforceHttpsRule,
  indexFileCacheRule,
} from './CdnRules';
import { cdnProfileInfo } from '../Common/GlobalEnv';
import { replaceAll } from '../Common/Helpers';
import { getCdnEndpointName } from '../Common/Naming';
import { BasicArgs } from '../types';

interface Props extends BasicArgs {
  name: string;
  origin: Output<string>;
  domainName: string;
  httpsEnabled?: boolean;
  includesDefaultResponseHeaders?: boolean;
}

export default ({
  name,
  domainName,
  origin,
  httpsEnabled,
  includesDefaultResponseHeaders,
  dependsOn,
}: Props) => {
  name = getCdnEndpointName(name);

  const rules = [enforceHttpsRule, indexFileCacheRule];
  if (includesDefaultResponseHeaders) {
    rules.push(getDefaultResponseHeadersRule(domainName));
  }

  console.log('CDN Endpoint: Link to', cdnProfileInfo);

  const endpoint = new native.cdn.Endpoint(
    name,
    {
      endpointName: name,
      ...cdnProfileInfo,

      origins: [{ name, hostName: origin }],
      originHostHeader: origin,

      optimizationType: 'GeneralWebDelivery',
      queryStringCachingBehavior: 'IgnoreQueryString',

      deliveryPolicy: {
        rules,
        description: 'Static Website Rules',
      },

      isCompressionEnabled: true,
      contentTypesToCompress: [
        'text/plain',
        'text/html',
        'text/xml',
        'text/css',
        'application/xml',
        'application/xhtml+xml',
        'application/rss+xml',
        'application/javascript',
        'application/x-javascript',
      ],

      isHttpAllowed: true,
      isHttpsAllowed: true,
    },
    { dependsOn }
  );

  if (domainName) {
    const customDomain = new native.cdn.CustomDomain(
      name,
      {
        endpointName: endpoint.name,
        ...cdnProfileInfo,
        customDomainName: replaceAll(domainName, '.', '-'),
        hostName: domainName,
      },
      { dependsOn: endpoint }
    );

    if (httpsEnabled) {
      new CdnHttpsEnable(
        name,
        {
          customDomainId: customDomain.id,
        },
        { dependsOn: customDomain }
      );
    }
  }

  return endpoint;
};
