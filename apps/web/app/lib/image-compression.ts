/**
 * Kompresi gambar client-side ringan berbasis HTML Canvas:
 * Mencegah error HTTP 413 (Payload Too Large) Nginx dengan mengompres foto kamera HP (>1MB)
 * menjadi file JPEG berkualitas tinggi (~400KB - 800KB) sebelum dikirim ke API.
 */
export async function compressImageIfNeeded(file: File, maxSizeBytes = 1_000_000): Promise<File> {
  // Hanya proses jika file adalah gambar dan ukurannya melebihi ambang batas
  if (!file.type.startsWith('image/') || file.size <= maxSizeBytes) {
    return file;
  }

  // File PDF tidak dikompresi canvas
  if (file.type === 'application/pdf') {
    return file;
  }

  return new Promise((resolve) => {
    const reader = new FileReader();
    reader.onload = (event) => {
      const img = new Image();
      img.onload = () => {
        let width = img.width;
        let height = img.height;
        const maxDim = 1920; // Resolusi standar HD yang sangat tajam untuk membaca struk transfer

        if (width > maxDim || height > maxDim) {
          if (width > height) {
            height = Math.round((height * maxDim) / width);
            width = maxDim;
          } else {
            width = Math.round((width * maxDim) / height);
            height = maxDim;
          }
        }

        const canvas = document.createElement('canvas');
        canvas.width = width;
        canvas.height = height;
        const ctx = canvas.getContext('2d');
        if (!ctx) return resolve(file);

        ctx.drawImage(img, 0, 0, width, height);

        canvas.toBlob(
          (blob) => {
            if (!blob || blob.size >= file.size) {
              return resolve(file);
            }
            const normalizedName = file.name.replace(/\.[^/.]+$/, '.jpg');
            const compressed = new File([blob], normalizedName, {
              type: 'image/jpeg',
              lastModified: Date.now(),
            });
            resolve(compressed);
          },
          'image/jpeg',
          0.82,
        );
      };
      img.onerror = () => resolve(file);
      img.src = event.target?.result as string;
    };
    reader.onerror = () => resolve(file);
    reader.readAsDataURL(file);
  });
}
