import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { axe } from 'vitest-axe';
import { describe, expect, it, vi } from 'vitest';
import { verificationClient } from '@/api-clients/identity-verification-client';
import { RegisterView } from './register-view';

describe('customer self-registration', () => {
  it('requires the account fields, uses a safe POST fallback and has no axe violations', async () => {
    const view = render(<RegisterView />);
    expect(screen.getByRole('heading', { name: 'Buat akun Daily Dose' })).toBeVisible();
    expect(screen.getByRole('form', { name: 'Registrasi customer' })).toHaveAttribute(
      'method',
      'post',
    );
    expect(screen.getByLabelText('Nama lengkap')).toBeRequired();
    expect(screen.getByLabelText('Nama lengkap')).toHaveAttribute(
      'placeholder',
      'Contoh: Nadia Putri',
    );
    expect(screen.getByLabelText('Nomor WhatsApp')).toBeRequired();
    expect(screen.getByLabelText('Email')).toBeRequired();
    expect(screen.getByLabelText('Password')).toBeRequired();
    // Selfie wajib sejak pendaftaran (keputusan bersama); KTP tidak diminta.
    const unggahan = view.container.querySelectorAll('input[type="file"]');
    expect(unggahan).toHaveLength(1);
    expect(unggahan[0]).toHaveAttribute('name', 'selfie');
    expect(unggahan[0]).toHaveAttribute('capture', 'user');
    expect(screen.getByLabelText(/Saya menyetujui Syarat & Ketentuan Layanan/i)).not.toBeRequired();
    expect(screen.getByText(/Data pendaftaran Anda disimpan secara privat/i)).toBeVisible();
    expect(screen.getByRole('button', { name: 'Daftar dan masuk' })).toHaveClass(
      'min-h-12',
      'w-full',
      'bg-dd-forest',
      'text-white',
    );
    expect((await axe(view.container)).violations).toHaveLength(0);
  });

  it('numbers the form sections 1 to 3 in order and says no KTP is needed', () => {
    render(<RegisterView />);
    expect(screen.getByText(/1\. Data Diri/)).toBeVisible();
    expect(screen.getByText(/2\. Keamanan Akun/)).toBeVisible();
    expect(screen.getByText(/3\. Foto selfie/)).toBeVisible();
    expect(screen.queryByText(/Dokumen Identitas/)).toBeNull();
    expect(screen.getByText(/Tidak perlu KTP/)).toBeVisible();
  });

  it('refuses to submit without a selfie and says why', async () => {
    const user = userEvent.setup();
    const register = vi.spyOn(verificationClient, 'register');
    render(<RegisterView />);

    await user.type(screen.getByLabelText('Nama lengkap'), 'Nadia Putri');
    await user.type(screen.getByLabelText('Nomor WhatsApp'), '0812 3456 7890');
    await user.type(screen.getByLabelText('Email'), 'nadia@example.com');
    await user.type(screen.getByLabelText('Password'), 'password-aman');
    await user.click(screen.getByLabelText(/Saya menyetujui Syarat & Ketentuan Layanan/i));
    await user.click(screen.getByRole('button', { name: 'Daftar dan masuk' }));

    expect(register).not.toHaveBeenCalled();
    expect(screen.getByRole('alert')).toHaveTextContent(/Ambil foto selfie dulu/);
  });

  it('renders callout for existing studio members with direct link to sign in (Tiket T-09)', () => {
    render(<RegisterView />);
    expect(screen.getByText('Sudah pernah latihan di studio?')).toBeVisible();
    expect(
      screen.getByText(/Akun kamu mungkin sudah dibuatkan staf\. Masuk pakai nomor WhatsApp/i),
    ).toBeVisible();
    const waLoginLinks = screen.getAllByRole('link', { name: /Masuk dengan nomor WhatsApp/i });
    expect(waLoginLinks.length).toBeGreaterThanOrEqual(1);
    expect(waLoginLinks[0]).toBeVisible();
    expect(waLoginLinks[0]).toHaveAttribute('href', '/sign-in');
  });

  it('has one password field that can be revealed and no repeat-password field', async () => {
    const user = userEvent.setup();
    render(<RegisterView />);

    const password = screen.getByLabelText('Password');
    expect(screen.queryByLabelText('Ulangi password')).toBeNull();
    expect(password).toHaveAttribute('type', 'password');

    await user.click(screen.getByRole('button', { name: 'Tampilkan password' }));
    expect(password).toHaveAttribute('type', 'text');
    expect(screen.getByRole('button', { name: 'Sembunyikan password' })).toHaveAttribute(
      'aria-pressed',
      'true',
    );
  });

  it('does not promise a password-free login the sign-in page does not offer', () => {
    render(<RegisterView />);
    expect(screen.queryByText(/Tidak ingin mengingat password/)).toBeNull();
  });

  it('shows Indonesian inline errors, focuses the first invalid field and clears corrected input', async () => {
    const user = userEvent.setup();
    render(<RegisterView />);

    await user.click(screen.getByRole('button', { name: 'Daftar dan masuk' }));
    const displayName = screen.getByLabelText('Nama lengkap');
    expect(displayName).toHaveFocus();
    expect(displayName).toHaveAttribute('aria-invalid', 'true');
    expect(screen.getByText('Nama lengkap wajib diisi.')).toHaveAttribute(
      'id',
      'register-displayName-error',
    );

    await user.type(displayName, 'Nadia Putri');
    expect(screen.queryByText('Nama lengkap wajib diisi.')).not.toBeInTheDocument();

    const phone = screen.getByLabelText('Nomor WhatsApp');
    await user.type(phone, 'bukan-nomor');
    await user.tab();
    expect(
      screen.getByText(
        'Masukkan nomor WhatsApp yang valid (awalan 08 atau +62), misalnya 0812 3456 7890.',
      ),
    ).toBeVisible();
  });

  it('sends one valid registration with the selfie and locks the form while loading', async () => {
    const user = userEvent.setup();
    const register = vi
      .spyOn(verificationClient, 'register')
      .mockImplementation(() => new Promise(() => undefined));
    render(<RegisterView />);

    await user.type(screen.getByLabelText('Nama lengkap'), ' Nadia Putri ');
    await user.type(screen.getByLabelText('Nomor WhatsApp'), '0812 3456 7890');
    await user.type(screen.getByLabelText('Email'), 'nadia@example.com');
    await user.type(screen.getByLabelText('Password'), 'password-aman');
    const foto = new File(['wajah'], 'selfie.jpg', { type: 'image/jpeg' });
    await user.upload(screen.getByLabelText(/Ambil foto sekarang/), foto);
    await user.click(screen.getByLabelText(/Saya menyetujui Syarat & Ketentuan Layanan/i));
    await user.click(screen.getByRole('button', { name: 'Daftar dan masuk' }));

    expect(register).toHaveBeenCalledTimes(1);
    expect(register).toHaveBeenCalledWith({
      displayName: 'Nadia Putri',
      phone: '0812 3456 7890',
      email: 'nadia@example.com',
      password: 'password-aman',
      consent: true,
      selfie: foto,
    });
    expect(screen.getByRole('button', { name: 'Membuat akun…' })).toBeDisabled();
    expect(screen.getByLabelText('Nama lengkap')).toBeDisabled();
  });

  it('requires consent to register and clears the error when checked', async () => {
    const user = userEvent.setup();
    render(<RegisterView />);

    await user.type(screen.getByLabelText('Nama lengkap'), 'Nadia Putri');
    await user.type(screen.getByLabelText('Nomor WhatsApp'), '0812 3456 7890');
    await user.type(screen.getByLabelText('Email'), 'nadia@example.com');
    await user.type(screen.getByLabelText('Password'), 'password-aman');

    await user.click(screen.getByRole('button', { name: 'Daftar dan masuk' }));
    expect(
      screen.getByText(
        'Anda wajib menyetujui Syarat & Ketentuan serta Kebijakan Privasi Daily Dose.',
      ),
    ).toBeVisible();

    await user.click(screen.getByLabelText(/Saya menyetujui Syarat & Ketentuan Layanan/i));
    expect(
      screen.queryByText(
        'Anda wajib menyetujui Syarat & Ketentuan serta Kebijakan Privasi Daily Dose.',
      ),
    ).not.toBeInTheDocument();
  });
  it('keeps the booking destination on the links back to sign in', async () => {
    window.history.replaceState({}, '', '/register?returnTo=%2Fbookings%2Fnew%3Fslot%3Dslot-1');
    render(<RegisterView />);
    const expected = '/sign-in?returnTo=%2Fbookings%2Fnew%3Fslot%3Dslot-1';
    await waitFor(() =>
      expect(
        screen.getAllByRole('link', { name: /Masuk/i }).map((a) => a.getAttribute('href')),
      ).toContain(expected),
    );
    for (const link of screen.getAllByRole('link', { name: /^Masuk/i })) {
      expect(link.getAttribute('href')).toBe(expected);
    }
    window.history.replaceState({}, '', '/');
  });
  it("surfaces specific error when phone is already registered (PHONE_ALREADY_REGISTERED)", async () => {
    const user = userEvent.setup();
    vi.spyOn(verificationClient, "register").mockRejectedValue({
      response: {
        status: 409,
        data: { code: "PHONE_ALREADY_REGISTERED" },
      },
    });
    render(<RegisterView />);

    await user.type(screen.getByLabelText("Nama lengkap"), "Nadia Putri");
    await user.type(screen.getByLabelText("Nomor WhatsApp"), "0812 3456 7890");
    await user.type(screen.getByLabelText("Email"), "nadia@example.com");
    await user.type(screen.getByLabelText("Password"), "password-aman");
    const foto = new File(["wajah"], "selfie.jpg", { type: "image/jpeg" });
    await user.upload(screen.getByLabelText(/Ambil foto sekarang/), foto);
    await user.click(screen.getByLabelText(/Saya menyetujui Syarat & Ketentuan Layanan/i));
    await user.click(screen.getByRole("button", { name: "Daftar dan masuk" }));

    expect(
      await screen.findByText(/Nomor WhatsApp ini sudah terdaftar\. Akun Anda mungkin sudah dibuatkan oleh staf studio/i),
    ).toBeVisible();
    expect(screen.getByText("Nomor WhatsApp ini sudah terdaftar.")).toBeVisible();
  });

  it("surfaces specific error when email is already registered (EMAIL_ALREADY_REGISTERED)", async () => {
    const user = userEvent.setup();
    vi.spyOn(verificationClient, "register").mockRejectedValue({
      response: {
        status: 409,
        data: { code: "EMAIL_ALREADY_REGISTERED" },
      },
    });
    render(<RegisterView />);

    await user.type(screen.getByLabelText("Nama lengkap"), "Nadia Putri");
    await user.type(screen.getByLabelText("Nomor WhatsApp"), "0812 3456 7890");
    await user.type(screen.getByLabelText("Email"), "nadia@example.com");
    await user.type(screen.getByLabelText("Password"), "password-aman");
    const foto = new File(["wajah"], "selfie.jpg", { type: "image/jpeg" });
    await user.upload(screen.getByLabelText(/Ambil foto sekarang/), foto);
    await user.click(screen.getByLabelText(/Saya menyetujui Syarat & Ketentuan Layanan/i));
    await user.click(screen.getByRole("button", { name: "Daftar dan masuk" }));

    expect(
      await screen.findByText(/Alamat email ini sudah terdaftar\. Silakan gunakan email lain atau masuk ke akun Anda/i),
    ).toBeVisible();
    expect(screen.getByText("Alamat email ini sudah terdaftar.")).toBeVisible();
  });
});
