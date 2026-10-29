import { HttpStatus, Injectable } from '@nestjs/common';
import { OAuth2Client } from 'google-auth-library';
import { ApiProblem, configurationRequired, digest, safeEqual } from './security';

/**
 * Client ID OAuth Google milik studio (publik, sama dengan yang dipakai tombol login web). Token Google
 * hanya diterima bila ditujukan ke Client ID ini; `GOOGLE_CLIENT_ID` di env tetap didahulukan.
 */
export const GOOGLE_CLIENT_ID_BAWAAN =
  '223751724199-nhdfh02bnie3fjfm61ss0emknabqrbqf.apps.googleusercontent.com';

export interface VerifiedIdentity {
  provider: 'GOOGLE' | 'WHATSAPP_PHONE';
  subjectHash: string;
  emailHash?: string;
  email?: string;
  displayName?: string;
}

export interface GoogleIdentityProvider {
  verify(idToken: string, nonce: string): Promise<VerifiedIdentity>;
}

const syntheticEnabled = (): boolean =>
  process.env.NODE_ENV !== 'production' && process.env.AUTH_SYNTHETIC_ENABLED === 'true';

const isJwt = (token: string): boolean => {
  const parts = token.trim().split('.');
  return parts.length === 3 && (parts[0]?.startsWith('eyJ') ?? false);
};

@Injectable()
export class ConfigGatedGoogleProvider implements GoogleIdentityProvider {
  async verify(idToken: string, nonce: string): Promise<VerifiedIdentity> {
    if (!idToken || !nonce) return configurationRequired();
    const token = idToken.trim();

    if (isJwt(token)) {
      const clientId = process.env.GOOGLE_CLIENT_ID?.trim() || GOOGLE_CLIENT_ID_BAWAAN;
      if (!clientId) return configurationRequired();
      try {
        const ticket = await new OAuth2Client(clientId).verifyIdToken({
          idToken: token,
          audience: clientId,
        });
        const payload = ticket.getPayload();
        if (!payload?.sub || !payload.email || payload.email_verified !== true) {
          throw new ApiProblem('AUTHENTICATION_REQUIRED', HttpStatus.UNAUTHORIZED);
        }
        if (payload.nonce && nonce && payload.nonce !== nonce) {
          throw new ApiProblem('AUTHENTICATION_REQUIRED', HttpStatus.UNAUTHORIZED);
        }
        const subject = payload.sub;
        const email = payload.email.trim().toLowerCase();
        const displayName = payload.name?.trim() || email.split('@')[0];
        return {
          provider: 'GOOGLE',
          subjectHash: digest(`google:${subject}`),
          emailHash: digest(`email:${email}`),
          email,
          displayName,
        };
      } catch (error) {
        if (error instanceof ApiProblem) throw error;
        throw new ApiProblem('AUTHENTICATION_REQUIRED', HttpStatus.UNAUTHORIZED);
      }
    }

    if (syntheticEnabled()) {
      const email = token.toLowerCase();
      return {
        provider: 'GOOGLE',
        subjectHash: digest(`google:${email}`),
        emailHash: digest(`email:${email}`),
        email,
        displayName: email.split('@')[0],
      };
    }

    return configurationRequired();
  }
}
