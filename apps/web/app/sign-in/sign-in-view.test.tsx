import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { axe } from 'vitest-axe';
import { describe, expect, it, vi } from 'vitest';
import { SignInView } from './sign-in-view';
import type { IdentityClient } from '@/api-clients/identity-client';

function createMockClient(): IdentityClient {
  return {
    signIn: vi.fn(),
    signInWithPassword: vi.fn(),
    signInWithGoogleToken: vi.fn(),
    activatePassword: vi.fn(),
    requestPasswordReset: vi.fn(),
    resetPassword: vi.fn(),
    securityStatus: vi.fn(),
    changePassword: vi.fn(),
    listUsers: vi.fn(),
    getUser: vi.fn(),
    createInternalUser: vi.fn(),
    updateUserProfile: vi.fn(),
    updateUserRoles: vi.fn(),
    suspendUser: vi.fn(),
    reactivateUser: vi.fn(),
    deactivateUser: vi.fn(),
    generateActivationLink: vi.fn(),
    generatePasswordResetLink: vi.fn(),
    listRoleCatalog: vi.fn(),
    listAuditTrail: vi.fn(),
  } as unknown as IdentityClient;
}

describe('SignInView (Poin 15)', () => {
  it('renders login form with clean labels, single register link, and passes axe', async () => {
    const client = createMockClient();
    const view = render(<SignInView client={client} />);

    expect(screen.getByRole('heading', { name: 'Sign in to Daily Dose' })).toBeVisible();
    expect(screen.getByLabelText(/Email, username, or WhatsApp/i)).toBeRequired();
    expect(screen.getByLabelText(/Email, username, or WhatsApp/i)).toHaveAttribute(
      'placeholder',
      'you@email.com or 0812…',
    );
    expect(screen.getByLabelText('Password')).toBeRequired();

    // Verify single clear registration link
    const registerLinks = screen.getAllByRole('link', { name: /Create an account/i });
    expect(registerLinks).toHaveLength(1);
    expect(registerLinks[0]).toHaveAttribute('href', '/register');

    // Verify WhatsApp support link
    const waLink = screen.getByRole('link', { name: /Message the studio on WhatsApp/i });
    expect(waLink).toHaveAttribute('href', expect.stringContaining('https://wa.me/'));

    // Verify accessibility
    expect((await axe(view.container)).violations).toHaveLength(0);
  });

  it('allows password visibility to be toggled', async () => {
    const user = userEvent.setup();
    const client = createMockClient();
    render(<SignInView client={client} />);

    const passwordInput = screen.getByLabelText('Password');
    const toggleButton = screen.getByRole('button', { name: /Show/i });

    expect(passwordInput).toHaveAttribute('type', 'password');
    await user.click(toggleButton);

    expect(passwordInput).toHaveAttribute('type', 'text');
    expect(screen.getByRole('button', { name: /Hide/i })).toBeVisible();

    await user.click(screen.getByRole('button', { name: /Hide/i }));
    expect(passwordInput).toHaveAttribute('type', 'password');
  });

  it('shows error message when login fails', async () => {
    const user = userEvent.setup();
    const client = createMockClient();
    (client.signInWithPassword as any).mockRejectedValue({
      response: { status: 401 },
    });

    render(<SignInView client={client} />);

    await user.type(screen.getByLabelText(/Email, username, or WhatsApp/i), 'user@test.com');
    await user.type(screen.getByLabelText('Password'), 'wrongpassword');
    await user.click(screen.getByRole('button', { name: /^Sign in$/i }));

    await waitFor(() => {
      expect(screen.getByText("That email, username, or WhatsApp number and password don't match. Please try again.")).toBeVisible();
    });
  });
  it('keeps the booking destination when a new member goes to register', async () => {
    window.history.replaceState({}, '', '/sign-in?returnTo=%2Fbookings%2Fnew%3Fslot%3Dslot-1');
    render(<SignInView client={createMockClient()} />);
    await waitFor(() =>
      expect(screen.getByRole('link', { name: /Create an account/i })).toHaveAttribute(
        'href',
        '/register?returnTo=%2Fbookings%2Fnew%3Fslot%3Dslot-1',
      ),
    );
    window.history.replaceState({}, '', '/');
  });

  it('does not forward an external or protocol-relative destination to register', async () => {
    window.history.replaceState({}, '', '/sign-in?returnTo=https%3A%2F%2Fevil.example%2F');
    const { unmount } = render(<SignInView client={createMockClient()} />);
    expect(screen.getByRole('link', { name: /Create an account/i })).toHaveAttribute('href', '/register');
    unmount();
    window.history.replaceState({}, '', '/sign-in?returnTo=%2F%2Fevil.example');
    render(<SignInView client={createMockClient()} />);
    expect(screen.getByRole('link', { name: /Create an account/i })).toHaveAttribute('href', '/register');
    window.history.replaceState({}, '', '/');
  });
  it('hides the HR Group button unless the server enables it', () => {
    render(<SignInView client={createMockClient()} />);
    expect(screen.queryByRole('link', { name: 'Sign in with HR Group' })).toBeNull();
  });

  it('shows the HR Group button pointing at the API start route with the safe destination', async () => {
    window.history.replaceState({}, '', '/sign-in?returnTo=%2Faccount');
    const view = render(<SignInView client={createMockClient()} hrGroupEnabled />);
    await waitFor(() =>
      expect(screen.getByRole('link', { name: 'Sign in with HR Group' })).toHaveAttribute(
        'href',
        '/api/v1/auth/hr-group/start?returnTo=%2Faccount',
      ),
    );
    expect((await axe(view.container)).violations).toHaveLength(0);
    window.history.replaceState({}, '', '/');
  });

  it('explains an HR Group callback error code in plain language', async () => {
    window.history.replaceState({}, '', '/sign-in?hrg_error=ambiguous');
    render(<SignInView client={createMockClient()} hrGroupEnabled />);
    await waitFor(() => expect(screen.getByText(/matches more than one Daily Dose account/)).toBeVisible());
    window.history.replaceState({}, '', '/');
  });
});
