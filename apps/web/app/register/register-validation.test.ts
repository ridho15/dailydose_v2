import { describe, expect, it } from 'vitest';
import {
  normalizeRegistrationPhone,
  registrationRequestErrorMessage,
  type RegisterValues,
  validateRegistration,
} from './register-validation';

const validValues = (overrides: Partial<RegisterValues> = {}): RegisterValues => ({
  displayName: 'Nadia Putri',
  phone: '0812 3456 7890',
  email: 'nadia@example.com',
  password: 'aman-sekali',
  consent: true,
  ...overrides,
});

describe('registration validation', () => {
  it('normalizes supported Indonesian and E.164 phone formatting', () => {
    expect(normalizeRegistrationPhone('0812 3456-7890')).toBe('+6281234567890');
    expect(normalizeRegistrationPhone('+62 (812) 3456.7890')).toBe('+6281234567890');
  });

  it('accepts values that match the backend contract', () => {
    expect(validateRegistration(validValues())).toEqual({});
  });

  it('returns field errors for invalid identity values', () => {
    expect(
      validateRegistration(
        validValues({
          displayName: ' ',
          phone: 'bukan-nomor',
          email: 'email-salah',
          password: 'pendek',
          consent: false,
        }),
      ),
    ).toMatchObject({
      displayName: 'Please enter your full name.',
      phone: 'Please enter a valid Indonesian WhatsApp number starting with 08 or +62, for example 0812 3456 7890.',
      email: 'Please enter a valid email address.',
      password: 'Your password needs at least 8 characters.',
      consent: 'Please agree to the Terms & Conditions and Privacy Policy to continue.',
    });
  });

  it('rejects a WhatsApp number in the wrong format and names the correct format', () => {
    for (const phone of ['12345', '0212345678', '+1 415 555 0100', 'bukan-nomor']) {
      expect(validateRegistration(validValues({ phone })).phone).toBe(
        'Please enter a valid Indonesian WhatsApp number starting with 08 or +62, for example 0812 3456 7890.',
      );
    }
    for (const phone of ['08123456789', '0812 3456 7890', '+6281234567890', '6281234567890']) {
      expect(validateRegistration(validValues({ phone })).phone).toBeUndefined();
    }
  });

  it('no longer validates identity photos or a password confirmation at registration', () => {
    const errors = validateRegistration(validValues());
    expect(Object.keys(errors)).toEqual([]);
    expect(Object.keys(validValues())).not.toContain('selfie');
    expect(Object.keys(validValues())).not.toContain('ktp');
    expect(Object.keys(validValues())).not.toContain('confirmation');
  });

  it('maps conflict, validation and dependency failures to safe customer messages', () => {
    expect(registrationRequestErrorMessage(409)).toBe('This email or WhatsApp number is already in use.');
    expect(registrationRequestErrorMessage(422)).toBe('Please check your details and try again.');
    expect(registrationRequestErrorMessage(503)).toBe(
      "We couldn't create your account just now. Please try again.",
    );
  });
});
