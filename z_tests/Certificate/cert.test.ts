import * as certs from '../../Certificate';
import path from 'path';
import { expect } from 'chai';
import { organization } from '../../Common/StackEnv';

describe('Certificate tests', () => {
  it('Create Self-Sign Certificate', async () => {
    const cert = certs.createSelfSignCert({
      dnsName: 'hbd.test',
      commonName: 'hbd',
      organization,
    });

    expect(cert.cert).not.undefined;
    expect(cert.privateKey).not.undefined;
  });

  it('Load P12 File Certificate', async () => {
    const cert = await certs.convertPfxFileToPem({
      certPath: path.resolve(`./z_tests/Certificate/local.p12`),
      password: '123456',
    });

    expect(cert.cert).not.undefined;
    expect(cert.privateKey).not.undefined;
  });

  it('Load P12 Azure Key Vault File Certificate', async () => {
    const cert = await certs.convertPfxFileToPem({
      certPath: path.resolve(`./z_tests/Certificate/dev-root-vault-dev.pfx`),
    });

    expect(cert.cert).not.undefined;
    expect(cert.privateKey).not.undefined;
  });

  it('Load P12 Base64 Certificate', async () => {
    const cert = certs.convertPfxToPem({
      base64Cert:
        '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',
    });

    expect(cert.cert).not.undefined;
    expect(cert.privateKey).not.undefined;
  });
});
