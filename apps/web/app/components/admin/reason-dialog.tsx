'use client';

import { useEffect, useState } from 'react';
import { Button } from '../actions';
import { Modal } from '../app-feedback';
import { Textarea } from '../forms';

/**
 * Dialog konfirmasi dengan alasan (wajib, atau opsional bila `optional`) untuk aksi staf yang tercatat (batalkan booking, bekukan paket, …).
 * Alasan dibersihkan spasinya dan dibatasi panjangnya; tombol konfirmasi aktif setelah `minLength` terpenuhi.
 */
export function ReasonDialog({
  open,
  title,
  description,
  label = 'Alasan',
  confirmLabel,
  tone = 'primary',
  minLength = 3,
  maxLength = 200,
  optional = false,
  busy = false,
  error,
  onCancel,
  onConfirm,
  confirmDisabled = false,
  children,
}: {
  open: boolean;
  title: string;
  description?: string;
  label?: string;
  confirmLabel: string;
  tone?: 'primary' | 'danger';
  minLength?: number;
  maxLength?: number;
  /** Alasan boleh dikosongkan; bila diisi tetap minimal `minLength` karakter. */
  optional?: boolean;
  busy?: boolean;
  error?: string;
  onCancel(): void;
  onConfirm(reason: string): void;
  /** Mematikan tombol konfirmasi, mis. saat aksinya terbukti tidak aman. */
  confirmDisabled?: boolean;
  /** Isian tambahan di atas alasan (mis. jumlah hari perpanjangan). */
  children?: React.ReactNode;
}) {
  const [reason, setReason] = useState('');
  useEffect(() => {
    if (open) setReason('');
  }, [open]);
  const trimmed = reason.trim();
  const valid = optional && trimmed.length === 0
    ? true
    : trimmed.length >= minLength && trimmed.length <= maxLength;

  return (
    <Modal
      open={open}
      title={title}
      description={description}
      busy={busy}
      onClose={onCancel}
      footer={
        <div className="flex justify-end gap-2">
          <Button type="button" variant="secondary" onClick={onCancel} disabled={busy}>
            Batal
          </Button>
          <Button
            type="button"
            variant={tone === 'danger' ? 'danger' : 'primary'}
            disabled={!valid || busy || confirmDisabled}
            loading={busy}
            onClick={() => onConfirm(trimmed)}
          >
            {confirmLabel}
          </Button>
        </div>
      }
    >
      <div className="grid gap-4">
        {children}
        <Textarea
          label={optional ? `${label} (opsional)` : label}
          value={reason}
          maxLength={maxLength}
          placeholder={optional ? `Boleh dikosongkan; bila diisi minimal ${minLength} karakter` : `Minimal ${minLength} karakter`}
          onChange={(event) => setReason(event.target.value)}
          description={`${trimmed.length}/${maxLength} karakter. Alasan tersimpan pada catatan.`}
        />
        {error && (
          <p role="alert" className="text-sm text-dd-danger">
            {error}
          </p>
        )}
      </div>
    </Modal>
  );
}
