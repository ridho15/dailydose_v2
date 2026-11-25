import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { axe } from 'vitest-axe';
import { describe, expect, it, vi } from 'vitest';
import { verificationClient } from '@/api-clients/identity-verification-client';
import { RegisterView } from './register-view';

describe('customer self-registration', () => {
  it('requires the account fields, uses a safe POST fallback and has no axe violations', async () => {
    const view = render(<RegisterView />);
    expect(screen.getByRole('heading', { name: 'Create your Daily Dose account' })).toBeVisible();
    expect(screen.getByRole('form', { name: 'Create an account' })).toHaveAttribute(
      'method',
      'post',
    );
    expect(screen.getByLabelText('Full name')).toBeRequired();
    expect(screen.getByLabelText('Full name')).toHaveAttribute(
      'placeholder',
      'e.g. Nadia Putri',
    );
    expect(screen.getByLabelText('WhatsApp number')).toBeRequired();
    expect(screen.getByLabelText('Email')).toBeRequired();
    expect(screen.getByLabelText('Password')).toBeRequired();
    // Selfie wajib sejak pendaftaran (keputusan bersama); KTP tidak diminta.
    const unggahan = view.container.querySelectorAll('input[type="file"]');
    expect(unggahan).toHaveLength(1);
    expect(unggahan[0]).toHaveAttribute('name', 'selfie');
    expect(unggahan[0]).toHaveAttribute('capture', 'user');
    expect(screen.getByLabelText(/I have read and agree to the/i)).not.toBeRequired();
    expect(screen.getByText(/Your details stay private/i)).toBeVisible();
    expect(screen.getByRole('button', { name: 'Create account' })).toHaveClass(
      'min-h-12',
      'w-full',
      'bg-dd-forest',
      'text-white',
    );
    expect((await axe(view.container)).violations).toHaveLength(0);
  });

  it('numbers the form sections 1 to 3 in order and says no KTP is needed', () => {
    render(<RegisterView />);
    expect(screen.getByText(/1\. About you/)).toBeVisible();
    expect(screen.getByText(/2\. Password/)).toBeVisible();
    expect(screen.getByText(/3\. Selfie/)).toBeVisible();
    expect(screen.queryByText(/Dokumen Identitas/)).toBeNull();
    expect(screen.getByText(/no ID card needed/)).toBeVisible();
  });

  it('refuses to submit without a selfie and says why', async () => {
    const user = userEvent.setup();
    const register = vi.spyOn(verificationClient, 'register');
    render(<RegisterView />);

    await user.type(screen.getByLabelText('Full name'), 'Nadia Putri');
    await user.type(screen.getByLabelText('WhatsApp number'), '0812 3456 7890');
    await user.type(screen.getByLabelText('Email'), 'nadia@example.com');
    await user.type(screen.getByLabelText('Password'), 'password-aman');
    await user.click(screen.getByLabelText(/I have read and agree to the/i));
    await user.click(screen.getByRole('button', { name: 'Create account' }));

    expect(register).not.toHaveBeenCalled();
    expect(screen.getByRole('alert')).toHaveTextContent(/Please take a selfie first/);
  });

  it('renders callout for existing studio members with direct link to sign in (Tiket T-09)', () => {
    render(<RegisterView />);
    expect(screen.getByText('Already trained with us?')).toBeVisible();
    expect(
      screen.getByText(/The studio may have set up your account already\. Sign in with the WhatsApp number/i),
    ).toBeVisible();
    const waLoginLinks = screen.getAllByRole('link', { name: /Sign in with WhatsApp number/i });
    expect(waLoginLinks.length).toBeGreaterThanOrEqual(1);
    expect(waLoginLinks[0]).toBeVisible();
    expect(waLoginLinks[0]).toHaveAttribute('href', '/sign-in');
  });

  it('has one password field that can be revealed and no repeat-password field', async () => {
    const user = userEvent.setup();
    render(<RegisterView />);

    const password = screen.getByLabelText('Password');
    expect(screen.queryByLabelText('Confirm password')).toBeNull();
    expect(password).toHaveAttribute('type', 'password');

    await user.click(screen.getByRole('button', { name: 'Show password' }));
    expect(password).toHaveAttribute('type', 'text');
    expect(screen.getByRole('button', { name: 'Hide password' })).toHaveAttribute(
      'aria-pressed',
      'true',
    );
  });

  it('does not promise a password-free login the sign-in page does not offer', () => {
    render(<RegisterView />);
    expect(screen.queryByText(/Tidak ingin mengingat password/)).toBeNull();
  });

  it('shows inline errors, focuses the first invalid field and clears corrected input', async () => {
    const user = userEvent.setup();
    render(<RegisterView />);

    await user.click(screen.getByRole('button', { name: 'Create account' }));
    const displayName = screen.getByLabelText('Full name');
    expect(displayName).toHaveFocus();
    expect(displayName).toHaveAttribute('aria-invalid', 'true');
    expect(screen.getByText('Please enter your full name.')).toHaveAttribute(
      'id',
      'register-displayName-error',
    );

    await user.type(displayName, 'Nadia Putri');
    expect(screen.queryByText('Please enter your full name.')).not.toBeInTheDocument();

    const phone = screen.getByLabelText('WhatsApp number');
    await user.type(phone, 'bukan-nomor');
    await user.tab();
    expect(
      screen.getByText(
        'Please enter a valid Indonesian WhatsApp number starting with 08 or +62, for example 0812 3456 7890.',
      ),
    ).toBeVisible();
  });

  it('sends one valid registration with the selfie and locks the form while loading', async () => {
    const user = userEvent.setup();
    const register = vi
      .spyOn(verificationClient, 'register')
      .mockImplementation(() => new Promise(() => undefined));
    render(<RegisterView />);

    await user.type(screen.getByLabelText('Full name'), ' Nadia Putri ');
    await user.type(screen.getByLabelText('WhatsApp number'), '0812 3456 7890');
    await user.type(screen.getByLabelText('Email'), 'nadia@example.com');
    await user.type(screen.getByLabelText('Password'), 'password-aman');
    const foto = new File(['wajah'], 'selfie.jpg', { type: 'image/jpeg' });
    await user.upload(screen.getByLabelText(/Take a selfie/), foto);
    await user.click(screen.getByLabelText(/I have read and agree to the/i));
    await user.click(screen.getByRole('button', { name: 'Create account' }));

    expect(register).toHaveBeenCalledTimes(1);
    expect(register).toHaveBeenCalledWith({
      displayName: 'Nadia Putri',
      phone: '0812 3456 7890',
      email: 'nadia@example.com',
      password: 'password-aman',
      consent: true,
      selfie: foto,
    });
    expect(screen.getByRole('button', { name: 'Creating your account…' })).toBeDisabled();
    expect(screen.getByLabelText('Full name')).toBeDisabled();
  });

  it('requires consent to register and clears the error when checked', async () => {
    const user = userEvent.setup();
    render(<RegisterView />);

    await user.type(screen.getByLabelText('Full name'), 'Nadia Putri');
    await user.type(screen.getByLabelText('WhatsApp number'), '0812 3456 7890');
    await user.type(screen.getByLabelText('Email'), 'nadia@example.com');
    await user.type(screen.getByLabelText('Password'), 'password-aman');

    await user.click(screen.getByRole('button', { name: 'Create account' }));
    expect(
      screen.getByText(
        'Please agree to the Terms & Conditions and Privacy Policy to continue.',
      ),
    ).toBeVisible();

    await user.click(screen.getByLabelText(/I have read and agree to the/i));
    expect(
      screen.queryByText(
        'Please agree to the Terms & Conditions and Privacy Policy to continue.',
      ),
    ).not.toBeInTheDocument();
  });
  it('keeps the booking destination on the links back to sign in', async () => {
    window.history.replaceState({}, '', '/register?returnTo=%2Fbookings%2Fnew%3Fslot%3Dslot-1');
    render(<RegisterView />);
    const expected = '/sign-in?returnTo=%2Fbookings%2Fnew%3Fslot%3Dslot-1';
    await waitFor(() =>
      expect(
        screen.getAllByRole('link', { name: /Sign in/i }).map((a) => a.getAttribute('href')),
      ).toContain(expected),
    );
    for (const link of screen.getAllByRole('link', { name: /^Sign in/i })) {
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

    await user.type(screen.getByLabelText('Full name'), "Nadia Putri");
    await user.type(screen.getByLabelText('WhatsApp number'), "0812 3456 7890");
    await user.type(screen.getByLabelText("Email"), "nadia@example.com");
    await user.type(screen.getByLabelText("Password"), "password-aman");
    const foto = new File(["wajah"], "selfie.jpg", { type: "image/jpeg" });
    await user.upload(screen.getByLabelText(/Take a selfie/), foto);
    await user.click(screen.getByLabelText(/I have read and agree to the/i));
    await user.click(screen.getByRole("button", { name: "Create account" }));

    expect(
      await screen.findByText(/This WhatsApp number is already registered\. The studio may have created your account/i),
    ).toBeVisible();
    expect(screen.getByText("This WhatsApp number is already registered.")).toBeVisible();
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

    await user.type(screen.getByLabelText('Full name'), "Nadia Putri");
    await user.type(screen.getByLabelText('WhatsApp number'), "0812 3456 7890");
    await user.type(screen.getByLabelText("Email"), "nadia@example.com");
    await user.type(screen.getByLabelText("Password"), "password-aman");
    const foto = new File(["wajah"], "selfie.jpg", { type: "image/jpeg" });
    await user.upload(screen.getByLabelText(/Take a selfie/), foto);
    await user.click(screen.getByLabelText(/I have read and agree to the/i));
    await user.click(screen.getByRole("button", { name: "Create account" }));

    expect(
      await screen.findByText(/This email is already registered\. Sign in instead, or use a different email/i),
    ).toBeVisible();
    expect(screen.getByText("This email is already registered.")).toBeVisible();
  });
});
