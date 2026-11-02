import { createHash } from 'node:crypto';
import { digest } from '../identity/security';
import { PaymentProofService } from './bukti-pembayaran.service';
import { ConfigGatedMalwareScanProvider } from './proof-providers';

const principal = {
  userId: 'customer-1',
  roles: [{ role: 'CUSTOMER', branchId: null }],
  branchIds: [],
  capabilities: ['customer:self', 'package:read'],
} as never;

const png = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 1, 2, 3, 4, 5]);
const sha256 = createHash('sha256').update(png).digest('hex');
const proof = {
  id: 'proof-0001',
  userId: 'customer-1',
  branchId: 'branch-1',
  packageId: 'package-1',
  objectKey: 'payment-proofs/proof-0001',
  checksum: digest(sha256),
  fileName: 'proof.png',
  mimeType: 'image/png',
  sizeBytes: png.length,
  uploadStatus: 'ISSUED',
  scanStatus: 'PENDING',
};

describe('PaymentProofService upload lifecycle', () => {
  it('stores the private file in storage and marks status uploaded', async () => {
    const storage = {
      storePrivateObject: jest.fn().mockResolvedValue(undefined),
      deletePrivateObject: jest.fn().mockResolvedValue(undefined),
      readPrivateObject: jest.fn().mockResolvedValue(Buffer.from('customer-1')),
    };
    const service = new PaymentProofService(
      {} as never,
      { catalog: jest.fn() } as never,
      { value: { paymentProof: { maxBytes: 10_000_000 } } } as never,
      {} as never,
      storage as never,
    );

    await expect(service.uploadContent(principal, proof.id, png)).resolves.toMatchObject({
      id: proof.id,
      uploadStatus: 'UPLOADED',
      scanStatus: 'CLEAN',
    });
    expect(storage.storePrivateObject).toHaveBeenCalledWith(proof.objectKey, png);
  });

  it('rejects content from someone other than the uploader, and files that are not images or PDF', async () => {
    const storage = {
      storePrivateObject: jest.fn().mockResolvedValue(undefined),
      readPrivateObject: jest.fn().mockResolvedValue(Buffer.from('someone-else')),
    };
    const service = new PaymentProofService(
      {} as never,
      { catalog: jest.fn() } as never,
      {} as never,
      {} as never,
      storage as never,
    );
    await expect(service.uploadContent(principal, proof.id, png)).rejects.toMatchObject({
      code: 'RESOURCE_NOT_FOUND',
    });
    storage.readPrivateObject.mockResolvedValue(Buffer.from('customer-1'));
    await expect(
      service.uploadContent(principal, proof.id, Buffer.from('<html><script>x</script></html>')),
    ).rejects.toMatchObject({ code: 'PAYMENT_PROOF_MIME_MISMATCH' });
    await expect(service.uploadContent(principal, '../../.env', png)).rejects.toMatchObject({
      code: 'RESOURCE_NOT_FOUND',
    });
    expect(storage.storePrivateObject).not.toHaveBeenCalled();
  });

  it('rejects empty content before storage', async () => {
    const storage = {
      storePrivateObject: jest.fn().mockResolvedValue(undefined),
    };
    const service = new PaymentProofService(
      {} as never,
      { catalog: jest.fn() } as never,
      { value: { paymentProof: { maxBytes: 10_000_000 } } } as never,
      {} as never,
      storage as never,
    );

    await expect(service.uploadContent(principal, proof.id, Buffer.alloc(0))).rejects.toMatchObject({
      code: 'VALIDATION_ERROR',
    });
    expect(storage.storePrivateObject).not.toHaveBeenCalled();
  });
});

describe('payment-proof scanner startup guard', () => {
  it('accepts the explicit development synthetic scanner', async () => {
    const scanner = new ConfigGatedMalwareScanProvider(undefined, {
      value: { paymentProof: { scanDriver: 'synthetic' } },
    } as never);
    await expect(scanner.onModuleInit()).resolves.toBeUndefined();
  });

  it('fails startup when configured ClamAV cannot be reached', async () => {
    const scanner = new ConfigGatedMalwareScanProvider(undefined, {
      value: {
        paymentProof: {
          scanDriver: 'clamav',
          clamAvHost: '127.0.0.1',
          clamAvPort: 1,
          scanTimeoutMs: 50,
        },
      },
    } as never);
    await expect(scanner.onModuleInit()).rejects.toThrow('PAYMENT_PROOF_SCANNER_UNAVAILABLE');
  });
});
