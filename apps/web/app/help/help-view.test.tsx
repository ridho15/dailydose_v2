import { fireEvent, render, screen } from '@testing-library/react';
import { axe } from 'vitest-axe';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { HelpView } from './help-view';

let mockSession: any = null;
let mockActiveBranch: any = null;
let mockPreferredStudio: any = null;
let mockConfigBranches: any[] = [];

vi.mock('../session-context', () => ({
  useSessionContext: () => ({
    session: mockSession,
    activeBranch: mockActiveBranch,
  }),
}));

vi.mock('../components/public/public-experience', () => ({
  useStudioPreference: () => ({
    preferred: mockPreferredStudio,
    config: {
      branches: mockConfigBranches,
      fallbackWhatsappE164: '+62895329736127',
    },
    whatsappStudios: mockConfigBranches,
  }),
}));

vi.mock('next/navigation', () => ({
  useSearchParams: () => new URLSearchParams(),
  usePathname: () => '/help',
  useRouter: () => ({
    push: vi.fn(),
    replace: vi.fn(),
  }),
}));

describe('HelpView Component (Tahap 1)', () => {
  beforeEach(() => {
    mockSession = null;
    mockActiveBranch = null;
    mockPreferredStudio = null;
    mockConfigBranches = [
      {
        id: 'b-1',
        name: 'Cabang Jakarta Barat',
        supportWhatsappE164: '+6281211112222',
        supportEmail: 'barat@ddose.com',
      },
      {
        id: 'b-2',
        name: 'Cabang Surabaya',
        supportWhatsappE164: '+6281233334444',
        supportEmail: null,
      },
    ];
  });

  it('merender judul panduan terpusat dan 3 tab audiens resmi', () => {
    render(<HelpView />);

    expect(screen.getByRole('heading', { level: 1 })).toHaveTextContent(
      'Panduan Resmi Aplikasi & Penanganan Kendala',
    );
    expect(screen.getByRole('tab', { name: /Pelanggan \/ Member/i })).toBeVisible();
    expect(screen.getByRole('tab', { name: /Admin & Operasional Cabang/i })).toBeVisible();
    expect(screen.getByRole('tab', { name: /Super Admin & Pemilik/i })).toBeVisible();
  });

  it('berpindah tab ke Admin & Operasional saat tab diklik dan merender lengkap 7 alur operasional', () => {
    render(<HelpView />);

    const adminTab = screen.getByRole('tab', { name: /Admin & Operasional Cabang/i });
    fireEvent.click(adminTab);

    // Memastikan ke-7 alur Admin ter-render dengan benar
    expect(
      screen.getAllByText(/1\. Booking Bantuan \(Assisted Booking\) & Antrean Reschedule/i).length,
    ).toBeGreaterThan(0);
    expect(
      screen.getAllByText(/2\. Timetable Kelas Studio & Pengelolaan Kuota/i).length,
    ).toBeGreaterThan(0);
    expect(screen.getAllByText(/3\. Pemeriksaan Pembayaran & Pemisahan/i).length).toBeGreaterThan(
      0,
    );
    expect(
      screen.getAllByText(/4\. Scanner Check-in Meja & Validasi Foto Selfie/i).length,
    ).toBeGreaterThan(0);
    expect(
      screen.getAllByText(/5\. Ledger Paket & Pengajuan Penyesuaian Sesi/i).length,
    ).toBeGreaterThan(0);
    expect(screen.getAllByText(/6\. Manajemen Pengguna Cabang Terscope/i).length).toBeGreaterThan(
      0,
    );
    expect(
      screen.getAllByText(/7\. Kasus Support, Reminder & Workspace Operasional Cabang/i).length,
    ).toBeGreaterThan(0);

    // Memastikan screenshot live capture terpasang untuk alur Admin
    const mobileButtons = screen.getAllByRole('button', { name: /mobile/i });
    expect(mobileButtons.length).toBeGreaterThan(0);
    fireEvent.click(mobileButtons[0]!);

    const mobileImg = screen.getByAltText(/Layar Assisted Booking & Pemesanan Walk-in \(mobile\)/i);
    expect(mobileImg).toBeVisible();
    expect(mobileImg).toHaveAttribute('src', '/images/help/admin/a01-assisted-bookings-mobile.png');

    // Uji klik secondary screenshot antrean reschedule
    const secondaryRescheduleBtn = screen.getByRole('button', {
      name: /2\. Antrean Pengajuan Reschedule Member/i,
    });
    fireEvent.click(secondaryRescheduleBtn);
    const secondaryImg = screen.getByAltText(/Antrean Pengajuan Reschedule Member \(mobile\)/i);
    expect(secondaryImg).toBeVisible();
    expect(secondaryImg).toHaveAttribute(
      'src',
      '/images/help/admin/a01-reschedule-queue-mobile.png',
    );
  });

  it('berpindah tab ke Super Admin saat tab diklik dan merender lengkap 8 alur tata kelola sistem', () => {
    render(<HelpView />);

    const superAdminTab = screen.getByRole('tab', { name: /Super Admin & Pemilik/i });
    fireEvent.click(superAdminTab);

    // Memastikan ke-8 alur Super Admin ter-render dengan benar
    expect(
      screen.getAllByText(/1\. Manajemen Pengguna, Staf & Matriks Hak Akses \(RBAC\)/i).length,
    ).toBeGreaterThan(0);
    expect(
      screen.getAllByText(
        /2\. Antrean Peninjauan Cepat Identitas Nasional \(Fast Review KTP\/Selfie\)/i,
      ).length,
    ).toBeGreaterThan(0);
    expect(
      screen.getAllByText(/3\. Manajemen Master Cabang, Rekening Bank & Kontak Cabang/i).length,
    ).toBeGreaterThan(0);
    expect(
      screen.getAllByText(/4\. Log Jejak Audit Sistem Immutable & Pelacakan Korelasi/i).length,
    ).toBeGreaterThan(0);
    expect(
      screen.getAllByText(/5\. Pengaturan Konten Publik, Banner Hero Carousel & FAQ/i).length,
    ).toBeGreaterThan(0);
    expect(
      screen.getAllByText(/6\. Manajemen Template Notifikasi WhatsApp & Email Massal/i).length,
    ).toBeGreaterThan(0);
    expect(
      screen.getAllByText(/7\. Diagnostik Kesehatan Sistem, Probe Dependensi & Evaluasi H-24/i)
        .length,
    ).toBeGreaterThan(0);
    expect(
      screen.getAllByText(/8\. Rekonsiliasi Migrasi V1 & Pembetulan Saldo Historis/i).length,
    ).toBeGreaterThan(0);

    // Memastikan screenshot live capture terpasang untuk alur Super Admin
    const mobileButtons = screen.getAllByRole('button', { name: /mobile/i });
    expect(mobileButtons.length).toBeGreaterThan(0);
    fireEvent.click(mobileButtons[0]!);

    const mobileImg = screen.getByAltText(/Layar Matriks Hak Akses & Kapabilitas RBAC \(mobile\)/i);
    expect(mobileImg).toBeVisible();
    expect(mobileImg).toHaveAttribute(
      'src',
      '/images/help/super-admin/s01-roles-permissions-matrix-mobile.png',
    );

    // Uji klik secondary screenshot untuk alur rekonsiliasi migrasi
    const secondaryHealthBtn = screen.getByRole('button', {
      name: /2\. Status Dependensi & Kesiapan Server/i,
    });
    fireEvent.click(secondaryHealthBtn);
    const secondaryImg = screen.getByAltText(/Status Dependensi & Kesiapan Server \(desktop\)/i);
    expect(secondaryImg).toBeVisible();
    expect(secondaryImg).toHaveAttribute(
      'src',
      '/images/help/super-admin/s07-system-health-desktop.png',
    );
  });

  it('memfilter alur saat teks diketikkan pada kotak pencarian cepat', () => {
    render(<HelpView />);

    const searchInput = screen.getByPlaceholderText(/Cari solusi kendala/i);
    fireEvent.change(searchInput, { target: { value: 'cutoff' } });

    expect(screen.getAllByText(/7. Booking Kelas & Ketentuan Reschedule/i).length).toBeGreaterThan(
      0,
    );
    expect(screen.queryByText(/1. Pendaftaran & Aktivasi Akun/i)).not.toBeInTheDocument();
  });

  it('kartu eskalasi menampilkan kontak email resmi pusat sebagai fallback', () => {
    mockPreferredStudio = null;
    mockActiveBranch = null;
    render(<HelpView />);

    const emailButtons = screen.getAllByRole('link', { name: /Kirim Email Dukungan/i });
    expect(emailButtons.length).toBeGreaterThan(0);
    expect(emailButtons[0]).toHaveAttribute('href', expect.stringContaining('mailto:'));
  });

  it('merender glosarium istilah dan tabel kode error', () => {
    render(<HelpView />);

    expect(screen.getByText('Glosarium Istilah Resmi Daily Dose')).toBeVisible();
    expect(screen.getByText('Tabel Lengkap Kode Error & Respons Sistem')).toBeVisible();
    expect(screen.getByText('IDENTITY_VERIFICATION_REQUIRED')).toBeVisible();
  });

  it('merender lengkap 10 alur panduan customer beserta toggle screenshot desktop dan mobile', () => {
    render(<HelpView />);

    // Memastikan ke-10 alur customer hadir di dokumen
    expect(screen.getAllByText(/1\. Pendaftaran & Aktivasi Akun/i).length).toBeGreaterThan(0);
    expect(screen.getAllByText(/2\. Login & Autentikasi Pengguna/i).length).toBeGreaterThan(0);
    expect(screen.getAllByText(/3\. Lupa & Reset Kata Sandi/i).length).toBeGreaterThan(0);
    expect(
      screen.getAllByText(/4\. Verifikasi Identitas \(Foto Selfie Wajah\)/i).length,
    ).toBeGreaterThan(0);
    expect(screen.getAllByText(/5\. Memilih Studio & Cabang Favorit/i).length).toBeGreaterThan(0);
    expect(screen.getAllByText(/6\. Pembelian Paket & Unggah Bukti Bayar/i).length).toBeGreaterThan(
      0,
    );
    expect(screen.getAllByText(/7\. Booking Kelas & Ketentuan Reschedule/i).length).toBeGreaterThan(
      0,
    );
    expect(
      screen.getAllByText(/8\. Presensi Masuk \(QR Pass Digital & Geofence\)/i).length,
    ).toBeGreaterThan(0);
    expect(screen.getAllByText(/9\. Sisa Sesi & Riwayat Kehadiran Paket/i).length).toBeGreaterThan(
      0,
    );
    expect(screen.getAllByText(/10\. Pengaturan Profil & Keamanan Akun/i).length).toBeGreaterThan(
      0,
    );

    // Memastikan kontrol toggle screenshot Desktop / Mobile berfungsi
    const desktopButtons = screen.getAllByRole('button', { name: /desktop/i });
    const mobileButtons = screen.getAllByRole('button', { name: /mobile/i });
    expect(desktopButtons.length).toBeGreaterThan(0);
    expect(mobileButtons.length).toBeGreaterThan(0);

    // Uji klik tombol Mobile pada alur pertama
    fireEvent.click(mobileButtons[0]!);
    const mobileImage = screen.getByAltText(/Formulir Pendaftaran Member Baru \(mobile\)/i);
    expect(mobileImage).toBeVisible();
    expect(mobileImage).toHaveAttribute(
      'src',
      '/images/help/customer/c01-register-form-mobile.png',
    );

    // Uji klik tombol Layar Lanjutan (secondary variant)
    const secondaryButtons = screen.getAllByRole('button', {
      name: /2\. Halaman Konfirmasi Aktivasi Akun Terkirim/i,
    });
    expect(secondaryButtons.length).toBeGreaterThan(0);
    fireEvent.click(secondaryButtons[0]!);
    const secondaryImage = screen.getByAltText(
      /Halaman Konfirmasi Aktivasi Akun Terkirim \(mobile\)/i,
    );
    expect(secondaryImage).toBeVisible();
    expect(secondaryImage).toHaveAttribute(
      'src',
      '/images/help/customer/c01-activate-account-mobile.png',
    );
  });

  it('lulus uji aksesibilitas (a11y) axe dengan 0 violations', async () => {
    const view = render(<HelpView />);
    const results = await axe(view.container);
    if (results.violations.length > 0) {
      console.log(
        'AXE VIOLATIONS:',
        JSON.stringify(
          results.violations.map((v) => ({
            id: v.id,
            description: v.description,
            target: v.nodes.map((n) => n.target),
          })),
          null,
          2,
        ),
      );
    }
    expect(results.violations).toHaveLength(0);
  });
});
