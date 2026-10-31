import { describe, expect, it } from 'vitest';
import { compressImageIfNeeded } from './image-compression';

describe('compressImageIfNeeded', () => {
  it('returns original file if size is under 1MB', async () => {
    const smallFile = new File(['small dummy content'], 'struk.jpg', { type: 'image/jpeg' });
    const result = await compressImageIfNeeded(smallFile);
    expect(result).toBe(smallFile);
  });

  it('returns original file if file is PDF regardless of size', async () => {
    const pdfContent = new Uint8Array(2 * 1024 * 1024);
    const pdfFile = new File([pdfContent], 'struk.pdf', { type: 'application/pdf' });
    const result = await compressImageIfNeeded(pdfFile);
    expect(result).toBe(pdfFile);
  });
});
