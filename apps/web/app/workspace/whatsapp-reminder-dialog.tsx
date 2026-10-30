'use client';

import { useEffect, useState } from 'react';
import { Copy, Check, MessageSquare, ExternalLink } from 'lucide-react';
import { Button } from '../components/actions';
import { Modal, useAppFeedback } from '../components/app-feedback';
import {
  WHATSAPP_REMINDER_PRESETS,
  buildWhatsAppLink,
  cleanWhatsAppPhone,
  type WhatsAppReminderContext,
  type WhatsAppPreset,
} from './whatsapp-reminder-presets';

export interface WhatsAppReminderDialogProps {
  open: boolean;
  onClose(): void;
  context: WhatsAppReminderContext | null;
  defaultPresetId?: WhatsAppPreset['id'];
}

export function WhatsAppReminderDialog({
  open,
  onClose,
  context,
  defaultPresetId = 'class_reminder',
}: WhatsAppReminderDialogProps) {
  const feedback = useAppFeedback();
  const [selectedPresetId, setSelectedPresetId] = useState<WhatsAppPreset['id']>(defaultPresetId);
  const [customText, setCustomText] = useState('');
  const [inputPhone, setInputPhone] = useState('');
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    if (open && context) {
      setSelectedPresetId(defaultPresetId);
      setInputPhone(context.phone ?? '');
      const preset =
        WHATSAPP_REMINDER_PRESETS.find((p) => p.id === defaultPresetId) ??
        WHATSAPP_REMINDER_PRESETS[0]!;
      setCustomText(preset.generateText(context));
      setCopied(false);
    }
  }, [open, context, defaultPresetId]);

  const handleSelectPreset = (presetId: WhatsAppPreset['id']) => {
    if (!context) return;
    setSelectedPresetId(presetId);
    const preset =
      WHATSAPP_REMINDER_PRESETS.find((p) => p.id === presetId) ?? WHATSAPP_REMINDER_PRESETS[0]!;
    setCustomText(preset.generateText(context));
  };

  const effectivePhone = inputPhone.trim() || context?.phone || '';
  const waLink = buildWhatsAppLink(effectivePhone, customText);

  const handleCopy = async () => {
    try {
      await navigator.clipboard.writeText(customText);
      setCopied(true);
      feedback.showToast({
        tone: 'success',
        title: 'Teks Disalin',
        message: 'Pesan pengingat WhatsApp berhasil disalin ke clipboard.',
      });
      setTimeout(() => setCopied(false), 2500);
    } catch {
      feedback.showToast({
        tone: 'danger',
        title: 'Gagal Menyalin',
        message: 'Silakan salin teks secara manual dari kotak pesan.',
      });
    }
  };

  const handleOpenWhatsApp = () => {
    if (!waLink) {
      feedback.showToast({
        tone: 'warning',
        title: 'Nomor WhatsApp Diperlukan',
        message: 'Silakan masukkan nomor WhatsApp pelanggan terlebih dahulu.',
      });
      return;
    }
    window.open(waLink, '_blank', 'noopener,noreferrer');
    onClose();
  };

  if (!context) return null;

  return (
    <Modal
      open={open}
      onClose={onClose}
      title={`Kirim Pesan WhatsApp: ${context.customerName}`}
      description="Pilih salah satu template pesan operasional di bawah ini. Pesan dapat diedit sebelum dikirim."
      className="max-w-lg"
      footer={
        <div className="flex flex-wrap items-center justify-between gap-2.5 w-full">
          <Button
            type="button"
            variant="secondary"
            onClick={handleCopy}
            className="flex items-center gap-1.5 text-xs font-semibold"
          >
            {copied ? (
              <>
                <Check className="size-3.5 text-dd-forest" />
                <span>Tersalin!</span>
              </>
            ) : (
              <>
                <Copy className="size-3.5 text-dd-muted" />
                <span>Salin Teks</span>
              </>
            )}
          </Button>
          <div className="flex items-center gap-2">
            <Button type="button" variant="ghost" onClick={onClose}>
              Batal
            </Button>
            <Button
              type="button"
              onClick={handleOpenWhatsApp}
              className="flex items-center gap-1.5 bg-[#25D366] text-white hover:bg-[#1EBE5D] border-0"
            >
              <MessageSquare className="size-4" />
              <span>Buka WhatsApp</span>
              <ExternalLink className="size-3 opacity-80" />
            </Button>
          </div>
        </div>
      }
    >
      <div className="space-y-4 font-sans text-dd-ink">
        {/* Pilihan Preset Pesan */}
        <div className="space-y-1.5">
          <label className="block text-xs font-bold text-dd-muted uppercase tracking-wider">
            Pilih Template Pesan
          </label>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
            {WHATSAPP_REMINDER_PRESETS.map((preset) => {
              const active = preset.id === selectedPresetId;
              return (
                <button
                  key={preset.id}
                  type="button"
                  onClick={() => handleSelectPreset(preset.id)}
                  className={`flex flex-col text-left p-2.5 rounded-dd-md border transition-colors cursor-pointer ${
                    active
                      ? 'border-dd-forest bg-dd-success-soft text-dd-forest ring-1 ring-dd-forest/40'
                      : 'border-dd-line bg-white hover:border-dd-forest/60 text-dd-ink'
                  }`}
                >
                  <span className="text-xs font-bold">{preset.badge}</span>
                  <span className="text-[13px] font-medium leading-tight mt-0.5 line-clamp-1">
                    {preset.label}
                  </span>
                </button>
              );
            })}
          </div>
        </div>

        {/* Nomor WhatsApp Pelanggan */}
        <div className="space-y-1">
          <label htmlFor="wa-target-phone" className="block text-xs font-bold text-dd-muted uppercase tracking-wider">
            Nomor WhatsApp Pelanggan
          </label>
          <input
            id="wa-target-phone"
            type="tel"
            placeholder="Contoh: 08123456789 atau +628..."
            value={inputPhone}
            onChange={(e) => setInputPhone(e.target.value)}
            className="w-full min-h-10 rounded-dd-md border border-dd-border-ui bg-white px-3 py-1.5 text-sm text-dd-ink focus:border-dd-forest focus:outline-none"
          />
          {!cleanWhatsAppPhone(effectivePhone) && (
            <p className="text-[12px] text-dd-warning">
              Nomor belum valid untuk tautan otomatis. Anda tetap dapat menyalin teks di atas.
            </p>
          )}
        </div>

        {/* Tinjauan & Edit Isi Pesan */}
        <div className="space-y-1">
          <label htmlFor="wa-message-text" className="block text-xs font-bold text-dd-muted uppercase tracking-wider">
            Teks Pesan (Dapat Disesuaikan)
          </label>
          <textarea
            id="wa-message-text"
            rows={5}
            value={customText}
            onChange={(e) => setCustomText(e.target.value)}
            className="w-full rounded-dd-md border border-dd-border-ui bg-dd-surface p-3 text-sm text-dd-ink leading-relaxed focus:border-dd-forest focus:bg-white focus:outline-none"
          />
        </div>
      </div>
    </Modal>
  );
}
