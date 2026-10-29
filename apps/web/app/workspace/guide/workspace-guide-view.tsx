'use client';

import { useState } from 'react';
import Link from 'next/link';
import {
  ArrowRight,
  BookOpen,
  CalendarCheck,
  CheckCircle2,
  ChevronRight,
  ClipboardList,
  CreditCard,
  FileCheck2,
  HelpCircle,
  KeyRound,
  LayoutDashboard,
  QrCode,
  Receipt,
  RotateCcw,
  Search,
  ShieldCheck,
  Sparkles,
  Ticket,
  UserCheck,
  Users,
} from 'lucide-react';
import { useSessionContext } from '../../session-context';
import { isCustomerOnlySession } from '../../lib/session-audience';

type StaffRoleKey = 'frontdesk' | 'finance' | 'owner';

interface GuideSection {
  id: string;
  title: string;
  badge: string;
  description: string;
  steps: {
    number: number;
    title: string;
    description: string;
    tips?: string;
  }[];
  mockup: {
    type: string;
    title: string;
    items: { label: string; value: string; tone?: 'success' | 'warning' | 'info' }[];
    statusBadge?: { text: string; tone: 'success' | 'warning' | 'info' };
  };
  actionHref?: string;
  actionLabel?: string;
}

const staffGuides: Record<
  StaffRoleKey,
  {
    roleName: string;
    tagline: string;
    icon: typeof ClipboardList;
    sections: GuideSection[];
  }
> = {
  frontdesk: {
    roleName: 'Front Desk & Operasional Cabang',
    tagline: 'Panduan absensi kehadiran QR, pengaturan slot kelas harian, dan assisted booking',
    icon: ClipboardList,
    sections: [
      {
        id: 'ops-scanner',
        title: '1. Scanner QR Code Kehadiran Member',
        badge: 'Check-In',
        description:
          'Pindai QR member dan instruktur dengan barcode scanner di halaman Check-in.',
        actionHref: '/workspace/check-in',
        actionLabel: 'Buka Check-in',
        steps: [
          {
            number: 1,
            title: 'Buka Halaman Check-in',
            description:
              'Pilih menu "Check-in" dan pastikan cabang di bilah atas sudah benar. Kolom pindai langsung siap.',
          },
          {
            number: 2,
            title: 'Pindai QR Member atau Instruktur',
            description:
              'Arahkan barcode scanner ke QR di ponsel member atau instruktur (atau tekan "Pakai kamera"). Foto selfie member tampil untuk dicocokkan.',
          },
          {
            number: 3,
            title: 'Validasi Tiket Otomatis',
            description:
              'Sistem akan memverifikasi kecocokan jadwal kelas dan nama member secara real-time. Layar akan menampilkan konfirmasi hijau jika valid.',
          },
        ],
        mockup: {
          type: 'card',
          title: 'Hasil Scan Absensi Kehadiran',
          items: [
            { label: 'Status Scan', value: 'VALID - BERHASIL', tone: 'success' },
            { label: 'Nama Member', value: 'Jessica Tan' },
            { label: 'Kelas', value: 'Reformer Intermediate (10:00)' },
            { label: 'Nomor Reformer', value: 'Unit #02' },
          ],
          statusBadge: { text: 'Check-in Sukses', tone: 'success' },
        },
      },
      {
        id: 'ops-classes',
        title: '2. Manajemen Slot & Assisted Booking',
        badge: 'Jadwal & Kuota',
        description:
          'Membantu member walk-in memesan sesi dan mengatur instruktur pengganti jika berhalangan.',
        actionHref: '/workspace/classes',
        actionLabel: 'Buka Jadwal Kelas',
        steps: [
          {
            number: 1,
            title: 'Kelola Slot Kelas Cabang',
            description:
              'Buka menu "Kelas" di workspace. Anda dapat memantau okupansi kursi per sesi dan daftar tunggu (waitlist).',
          },
          {
            number: 2,
            title: 'Lakukan Assisted Booking',
            description:
              'Jika ada member yang datang langsung ke meja resepsionis, cari nama member lalu masukkan ke slot kelas yang masih tersedia.',
          },
          {
            number: 3,
            title: 'Ganti Instruktur (Substitute)',
            description:
              'Jika instruktur utama berhalangan hadir, staf cabang dapat memilih instruktur pengganti dan member terdaftar otomatis menerima pemberitahuan.',
          },
        ],
        mockup: {
          type: 'card',
          title: 'Panel Slot Kelas Studio',
          items: [
            { label: 'Okupansi Kelas', value: '4 / 4 Kursi Penuh', tone: 'warning' },
            { label: 'Instruktur Aktif', value: 'Coach Amanda' },
            { label: 'Status Evaluasi H-24', value: 'CONFIRMED (Ready)', tone: 'success' },
            { label: 'Daftar Hadir', value: '4 Member Terdaftar' },
          ],
          statusBadge: { text: 'Slot Ready', tone: 'info' },
        },
      },
    ],
  },
  finance: {
    roleName: 'Finance & Accounting',
    tagline: 'Panduan verifikasi pembayaran, buku besar saldo (Ledger), dan rekonsiliasi arus kas',
    icon: Receipt,
    sections: [
      {
        id: 'fin-approval',
        title: '1. Verifikasi & Approval Pembayaran',
        badge: 'Arus Kas Masuk',
        description:
          'Memvalidasi bukti transfer masuk dari member sebelum sesi ditambahkan ke kuota akun.',
        actionHref: '/workspace/payments',
        actionLabel: 'Buka Pembayaran',
        steps: [
          {
            number: 1,
            title: 'Buka Antrean Pembayaran',
            description:
              'Buka menu "Pembayaran" (/workspace/payments) untuk melihat daftar pesanan pending dengan bukti transfer baru.',
          },
          {
            number: 2,
            title: 'Cek Mutasi Rekening Bank',
            description:
              'Buka pratinjau bukti transfer member dan cocokkan nominal serta nomor rekening tujuan dengan mutasi bank studio.',
          },
          {
            number: 3,
            title: 'Klik "Setujui Pembayaran"',
            description:
              'Jika dana sudah masuk, klik tombol "Setujui". Sistem secara otomatis membuat entri Ledger dan mengisi saldo sesi member.',
            tips: 'Jika bukti transfer palsu atau tidak sesuai nominal, klik "Tolak" dengan menyertakan alasan jelas.',
          },
        ],
        mockup: {
          type: 'card',
          title: 'Rincian Verifikasi Pembayaran Transfer',
          items: [
            { label: 'ID Transaksi', value: 'ORD-202608-0188' },
            { label: 'Nominal Transfer', value: 'Rp 3.500.000 (Sesuai)', tone: 'success' },
            { label: 'Rekening Tujuan', value: 'BCA - Daily Dose Indonesia' },
            { label: 'Keputusan Verifikasi', value: 'DISETUJUI & PAKET AKTIF', tone: 'success' },
          ],
          statusBadge: { text: 'Disetujui', tone: 'success' },
        },
      },
      {
        id: 'fin-ledger',
        title: '2. Kuota Sesi Member & Penyesuaian',
        badge: 'Kuota & Sesi',
        description:
          'Setiap pemakaian, pembelian, kedaluwarsa, atau kompensasi sesi tercatat otomatis dan aman di riwayat sesi member.',
        actionHref: '/ledger',
        actionLabel: 'Buka Sesi Pelanggan',
        steps: [
          {
            number: 1,
            title: 'Pantau Kuota & Sesi Member',
            description:
              'Buka menu "Sesi Pelanggan" (/ledger) untuk melihat riwayat pemakaian dan sisa kuota sesi per member.',
          },
          {
            number: 2,
            title: 'Ajukan Penyesuaian Sesi',
            description:
              'Jika terjadi kompensasi kendala teknis (misal: penambahan 1 sesi pengganti), ajukan penyesuaian di menu Penyesuaian Sesi dengan alasan tertulis.',
          },
          {
            number: 3,
            title: 'Pemeriksaan Silang (Persetujuan Manajer)',
            description:
              'Setiap penyesuaian sesi memerlukan persetujuan manajer sebelum kuota sesi efektif berubah di akun member.',
          },
        ],
        mockup: {
          type: 'card',
          title: 'Riwayat Pemakaian Sesi',
          items: [
            { label: 'Tipe Aktivitas', value: 'Pemakaian Kelas (Presensi Hadir)' },
            { label: 'Jumlah', value: '-1 Sesi' },
            { label: 'Referensi Booking', value: 'BKG-202608-0042' },
            { label: 'Sisa Kuota', value: '9 Sesi Tersedia', tone: 'info' },
          ],
          statusBadge: { text: 'Tervalidasi', tone: 'info' },
        },
      },
    ],
  },
  owner: {
    roleName: 'Super Owner & Manajemen Eksekutif',
    tagline:
      'Panduan kontrol multi-cabang, perizinan RBAC, audit log keamanan, dan laporan laba rugi',
    icon: LayoutDashboard,
    sections: [
      {
        id: 'own-dashboard',
        title: '1. Executive Multi-Branch Command Center',
        badge: 'Pengawasan Bisnis',
        description:
          'Melihat metrik performa seluruh cabang studio (Jakarta, Tangerang & Surabaya) dalam satu tampilan komprehensif.',
        actionHref: '/workspace',
        actionLabel: 'Buka Dashboard',
        steps: [
          {
            number: 1,
            title: 'Buka Workspace Dashboard',
            description:
              'Masuk sebagai Super Owner untuk mengakses metrik Penjualan Kotor, Pendapatan Bersih, Okupansi Kursi, dan Anomali.',
          },
          {
            number: 2,
            title: 'Filter Performa Cabang',
            description:
              'Gunakan filter cabang di bagian atas untuk membandingkan pertumbuhan antar cabang studio.',
          },
          {
            number: 3,
            title: 'Deteksi Anomali Keuangan',
            description:
              'Sistem secara otomatis mendeteksi anomali (diskon voucher tidak wajar, refund tertunda) untuk ditindaklanjuti segera.',
          },
        ],
        mockup: {
          type: 'card',
          title: 'Ringkasan Eksekutif Multi-Cabang',
          items: [
            { label: 'Total Penjualan Kotor', value: 'Rp 148.500.000', tone: 'success' },
            { label: 'Rata-rata Okupansi', value: '91.4% (Tinggi)', tone: 'success' },
            { label: 'Cabang Terbaik', value: 'Daily Dose Muara Karang' },
            { label: 'Antrean Keputusan', value: '0 Pending', tone: 'info' },
          ],
          statusBadge: { text: 'Sehat & Optimal', tone: 'success' },
        },
      },
      {
        id: 'own-rbac',
        title: '2. Dynamic RBAC & Audit Trail Keamanan',
        badge: 'Tata Kelola & Keamanan',
        description:
          'Mengelola hak akses karyawan dan menelusuri seluruh riwayat aktivitas sensitif sistem.',
        actionHref: '/audit',
        actionLabel: 'Buka Audit Trail',
        steps: [
          {
            number: 1,
            title: 'Kelola Hak Akses Pengguna (/users)',
            description:
              'Tentukan peran staf (SUPER_OWNER, FINANCE, BRANCH_OPERATIONS, INSTRUCTOR). Batasi hak akses cabang sesuai penugasan.',
          },
          {
            number: 2,
            title: 'Buka Audit Trail Log (/audit)',
            description:
              'Setiap aktivitas approval, perubahan status kelas, pembatalan booking, dan modifikasi harga tercatat dengan IP Address dan Timestamp lengkap.',
          },
          {
            number: 3,
            title: 'Pantau Evaluasi Kuota Otomatis H-24',
            description:
              'Penjadwal otomatis mengevaluasi seluruh kelas 24 jam sebelum mulai. Jika kuota minimum tidak terpenuhi, sistem otomatis membatalkan kelas dan mengembalikan saldo member.',
          },
        ],
        mockup: {
          type: 'card',
          title: 'Log Audit Keamanan Terpusat',
          items: [
            { label: 'Total User Staf', value: '8 Pengguna Terotorisasi' },
            { label: 'Evaluasi H-24 Auto-Job', value: 'RUNNING (Sehat)', tone: 'success' },
            {
              label: 'Audit Log Integrity',
              value: '100% Immutable (Tervalidasi)',
              tone: 'success',
            },
          ],
          statusBadge: { text: 'Secure & Compliant', tone: 'success' },
        },
      },
    ],
  },
};

export function WorkspaceGuideView() {
  const session = useSessionContext()?.session;
  const isStaff = Boolean(session && !isCustomerOnlySession(session));
  const [activeRole, setActiveRole] = useState<StaffRoleKey>('frontdesk');
  const [searchQuery, setSearchQuery] = useState('');

  const currentGuide = staffGuides[activeRole] ?? staffGuides.frontdesk;

  const filteredSections = currentGuide.sections.filter(
    (sec) =>
      sec.title.toLowerCase().includes(searchQuery.toLowerCase()) ||
      sec.description.toLowerCase().includes(searchQuery.toLowerCase()) ||
      sec.steps.some((st) => st.title.toLowerCase().includes(searchQuery.toLowerCase())),
  );

  const tabs: { key: StaffRoleKey; label: string; icon: typeof ClipboardList }[] = [
    { key: 'frontdesk', label: '1. Front Desk & Cabang', icon: ClipboardList },
    { key: 'finance', label: '2. Finance & Kasir', icon: Receipt },
    { key: 'owner', label: '3. Super Owner & Eksekutif', icon: LayoutDashboard },
  ];

  return (
    <div className="space-y-6">
      {/* Header Banner */}
      <div className="rounded-dd-lg border border-dd-line/80 bg-white p-6 sm:p-8">
        <div className="flex flex-wrap items-center justify-between gap-4">
          <span className="inline-flex items-center gap-2 rounded-full bg-dd-forest-dark/10 px-3.5 py-1 text-[13px] font-bold text-dd-forest">
            <BookOpen className="size-3.5" /> Panduan Operasional Internal
          </span>
          <Link
            href="/guide"
            className="inline-flex items-center gap-1.5 text-xs font-bold text-dd-forest no-underline hover:underline"
          >
            <span>Lihat Panduan Pelanggan Publik</span>
            <ArrowRight className="size-3.5" />
          </Link>
        </div>

        <h1 className="mt-4 font-sans text-2xl font-bold tracking-tight text-dd-ink sm:text-3xl">
          Standar Operasional Prosedur (SOP) Studio
        </h1>
        <p className="mt-2 max-w-3xl text-sm leading-relaxed text-dd-muted">
          Tata cara operasional lengkap langkah-demi-langkah beserta pratinjau antarmuka untuk Front Desk, Tim Finance, dan Super Owner dalam mengelola Daily Dose Pilates.
        </p>

        {/* Search Box */}
        <div className="mt-6 max-w-md">
          <div className="relative">
            <Search className="absolute top-3.5 left-4 size-4 text-dd-muted" />
            <input
              type="text"
              placeholder="Cari SOP (misal: scanner qr, approve payment, ledger)..."
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              className="w-full rounded-dd-md border border-dd-line bg-dd-cream/50 py-2.5 pr-4 pl-11 text-sm text-dd-ink outline-none transition focus:border-dd-forest focus:bg-white"
            />
          </div>
        </div>
      </div>

      {/* Role Switcher Tabs */}
      <div className="flex space-x-2 overflow-x-auto border-b border-dd-line/80 pb-3">
        {tabs.map((tab) => {
          const Icon = tab.icon;
          const active = activeRole === tab.key;
          return (
            <button
              key={tab.key}
              type="button"
              onClick={() => {
                setActiveRole(tab.key);
                setSearchQuery('');
              }}
              className={`flex shrink-0 items-center gap-2 rounded-dd-sm px-4 py-2.5 text-xs font-bold transition ${
                active
                  ? 'bg-dd-forest text-white shadow-dd-soft'
                  : 'bg-white border border-dd-line text-dd-muted hover:bg-dd-surface-muted hover:text-dd-ink'
              }`}
            >
              <Icon className="size-4" />
              {tab.label}
            </button>
          );
        })}
      </div>

      {/* Role Intro Banner */}
      <div className="rounded-dd-lg border border-dd-line bg-white p-6">
        <div className="flex items-start gap-4">
          <div className="grid size-12 shrink-0 place-items-center rounded-full bg-dd-success-soft text-dd-forest">
            <currentGuide.icon className="size-6" />
          </div>
          <div>
            <h2 className="text-xl font-bold text-dd-ink">{currentGuide.roleName}</h2>
            <p className="mt-1 text-sm text-dd-muted">{currentGuide.tagline}</p>
          </div>
        </div>
      </div>

      {/* Sections List */}
      {filteredSections.length === 0 ? (
        <div className="rounded-dd-lg border border-dashed border-dd-line bg-white p-12 text-center text-dd-muted">
          <HelpCircle className="mx-auto size-8 text-dd-muted" />
          <p className="mt-3 font-semibold">Tidak ada panduan yang cocok dengan pencarian Anda.</p>
          <button
            type="button"
            onClick={() => setSearchQuery('')}
            className="mt-2 text-xs font-bold text-dd-forest underline"
          >
            Reset Pencarian
          </button>
        </div>
      ) : (
        <div className="space-y-8">
          {filteredSections.map((section) => (
            <article
              key={section.id}
              id={section.id}
              className="overflow-hidden rounded-dd-lg border border-dd-line bg-white"
            >
              {/* Section Header */}
              <div className="border-b border-dd-line bg-dd-surface-muted/50 p-6">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <span className="rounded-full bg-dd-forest-dark/10 px-3 py-0.5 text-[13px] font-bold text-dd-forest">
                    {section.badge}
                  </span>
                  {section.actionHref && (
                    <Link
                      href={section.actionHref}
                      className="inline-flex items-center gap-1 rounded bg-dd-forest px-3 py-1 text-xs font-bold text-white no-underline transition hover:bg-dd-forest-dark"
                    >
                      <span>{section.actionLabel ?? 'Buka Fitur'}</span>
                      <ArrowRight className="size-3" />
                    </Link>
                  )}
                </div>
                <h3 className="mt-2 text-lg font-bold text-dd-ink">{section.title}</h3>
                <p className="mt-1 text-sm text-dd-muted">{section.description}</p>
              </div>

              {/* Grid: Steps & Visual Mockup */}
              <div className="grid gap-6 p-6 lg:grid-cols-12">
                {/* Left: Steps List */}
                <div className="space-y-4 lg:col-span-7">
                  <h4 className="text-[13px] font-bold text-dd-muted">
                    Langkah Kerja:
                  </h4>
                  <ol className="space-y-3 m-0 p-0 list-none">
                    {section.steps.map((st) => (
                      <li
                        key={st.number}
                        className="flex items-start gap-3.5 rounded-dd-md border border-dd-line/60 bg-dd-surface-muted/30 p-3.5 transition hover:bg-dd-surface-muted"
                      >
                        <span className="grid size-6 shrink-0 place-items-center rounded-full bg-dd-forest text-xs font-bold text-white">
                          {st.number}
                        </span>
                        <div className="flex-1">
                          <strong className="block text-sm font-semibold text-dd-ink">
                            {st.title}
                          </strong>
                          <p className="mt-1 text-xs leading-relaxed text-dd-muted">
                            {st.description}
                          </p>
                          {st.tips && (
                            <div className="mt-2 flex items-center gap-1.5 rounded-dd-sm bg-dd-brass-soft/50 px-2.5 py-1 text-[11px] font-medium text-dd-brass-dark">
                              <Sparkles className="size-3 shrink-0" />
                              <span>Tip: {st.tips}</span>
                            </div>
                          )}
                        </div>
                      </li>
                    ))}
                  </ol>
                </div>

                {/* Right: Interactive Visual Mockup */}
                <div className="lg:col-span-5">
                  <h4 className="mb-3 text-[13px] font-bold text-dd-muted">
                    Pratinjau Antarmuka:
                  </h4>
                  <div className="rounded-dd-lg border border-dd-line bg-dd-surface p-4">
                    <div className="flex items-center justify-between border-b border-dd-line pb-2.5">
                      <span className="text-xs font-bold text-dd-ink">{section.mockup.title}</span>
                      {section.mockup.statusBadge && (
                        <span
                          className={`rounded-full px-2.5 py-0.5 text-[10px] font-bold ${
                            section.mockup.statusBadge.tone === 'success'
                              ? 'bg-dd-success-soft text-dd-success'
                              : section.mockup.statusBadge.tone === 'warning'
                                ? 'bg-dd-warning-soft text-dd-warning'
                                : 'bg-dd-info-soft text-dd-info'
                          }`}
                        >
                          {section.mockup.statusBadge.text}
                        </span>
                      )}
                    </div>
                    <dl className="mt-3 space-y-2.5 m-0">
                      {section.mockup.items.map((item) => (
                        <div
                          key={item.label}
                          className="flex items-center justify-between gap-2 text-xs"
                        >
                          <dt className="text-dd-muted">{item.label}</dt>
                          <dd
                            className={`font-semibold ${
                              item.tone === 'success'
                                ? 'text-dd-success'
                                : item.tone === 'warning'
                                  ? 'text-dd-warning'
                                  : item.tone === 'info'
                                    ? 'text-dd-info'
                                    : 'text-dd-ink'
                            }`}
                          >
                            {item.value}
                          </dd>
                        </div>
                      ))}
                    </dl>
                    <div className="mt-4 flex items-center justify-center gap-1.5 rounded-dd-sm border border-dashed border-dd-line bg-white p-2.5 text-center text-[11px] text-dd-muted">
                      <CheckCircle2 className="size-3.5 text-dd-success shrink-0" />
                      <span>Terhubung langsung ke database pusat Daily Dose</span>
                    </div>
                  </div>
                </div>
              </div>
            </article>
          ))}
        </div>
      )}
    </div>
  );
}
