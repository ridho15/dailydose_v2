/**
 * Unified Alert Manager with Anti-Double Alert Deduplication & Explicit Root-Cause Formatting
 * Principle: UI/UX ProMax + No Happy Path + Antislop
 */

export type AlertType = 'success' | 'error' | 'warning' | 'info';

export interface AlertPayload {
  id?: string;
  type: AlertType;
  actionContext: string;     // Contoh: "Gagal menyimpan data produk"
  rootCause?: string;        // Contoh: "Kode SKU 'PRD-01' sudah digunakan oleh produk lain"
  remedySuggestion?: string; // Contoh: "Gunakan kode SKU unik lainnya."
  durationMs?: number;
}

class DeduplicatedAlertManager {
  private activeAlertHashes = new Set<string>();
  private timeoutMap = new Map<string, ReturnType<typeof setTimeout>>();
  private listeners: Array<(alerts: Required<AlertPayload>[]) => void> = [];
  private alerts: Required<AlertPayload>[] = [];

  private generateSignature(payload: AlertPayload): string {
    return `${payload.type}:${payload.actionContext}:${payload.rootCause || ''}`
      .toLowerCase()
      .trim();
  }

  public notify(payload: AlertPayload): string | null {
    const signature = payload.id || this.generateSignature(payload);

    // Anti-Double Alert Lock: Abaikan jika alert dengan konteks & penyebab yang sama masih tampil
    if (this.activeAlertHashes.has(signature)) {
      return null;
    }

    const finalAlert: Required<AlertPayload> = {
      id: signature,
      type: payload.type,
      actionContext: payload.actionContext,
      rootCause:
        payload.rootCause ||
        (payload.type === 'error'
          ? 'Permintaan ditolak oleh server atau format data tidak sesuai.'
          : ''),
      remedySuggestion:
        payload.remedySuggestion ||
        (payload.type === 'error'
          ? 'Periksa kembali isian form Anda atau muat ulang halaman.'
          : ''),
      durationMs: payload.durationMs ?? 5000
    };

    this.activeAlertHashes.add(signature);
    this.alerts = [...this.alerts, finalAlert];
    this.emit();

    // Pastikan timeout tersimpan di map agar tidak tabrakan/zombie saat di-dismiss manual
    const timer = setTimeout(() => {
      this.dismiss(signature);
    }, finalAlert.durationMs);
    this.timeoutMap.set(signature, timer);

    return signature;
  }

  public dismiss(id: string): void {
    if (this.timeoutMap.has(id)) {
      clearTimeout(this.timeoutMap.get(id)!);
      this.timeoutMap.delete(id);
    }
    this.activeAlertHashes.delete(id);
    this.alerts = this.alerts.filter((item) => item.id !== id);
    this.emit();
  }

  public clearAll(): void {
    this.timeoutMap.forEach((timer) => clearTimeout(timer));
    this.timeoutMap.clear();
    this.activeAlertHashes.clear();
    this.alerts = [];
    this.emit();
  }

  public subscribe(listener: (alerts: Required<AlertPayload>[]) => void): () => void {
    this.listeners.push(listener);
    listener(this.alerts);
    return () => {
      this.listeners = this.listeners.filter((l) => l !== listener);
    };
  }

  private emit(): void {
    this.listeners.forEach((listener) => listener(this.alerts));
  }
}

export const alertManager = new DeduplicatedAlertManager();
