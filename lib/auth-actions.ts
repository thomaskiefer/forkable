'use server';

import type { UserSchema } from '@insforge/sdk';
import { redirect } from 'next/navigation';
import { getAppUrl } from '@/lib/app-url';
import { clearAuthCookies, consumePkceVerifier, setAuthCookies, setPkceVerifier } from '@/lib/auth-cookies';
import { createInsforgeServerClient, getInsforgeServerClient } from '@/lib/insforge';

type AuthResult = { success: true } | { success: false; error: string };
type CompanyEnsureResult = { success: true } | { success: false; error: string };

const PERSONAL_EMAIL_DOMAINS = new Set([
  'aol.com',
  'icloud.com',
  'gmail.com',
  'hotmail.com',
  'live.com',
  'me.com',
  'msn.com',
  'outlook.com',
  'proton.me',
  'protonmail.com',
  'yahoo.com',
]);

function getDatabaseErrorMessage(error: unknown, fallback: string) {
  if (
    error &&
    typeof error === 'object' &&
    'message' in error &&
    typeof error.message === 'string'
  ) {
    return error.message;
  }

  return fallback;
}

function slugifyCompanyName(value: string) {
  const slug = value
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 48)
    .replace(/-+$/g, '');

  return slug || 'company';
}

function titleizeDomainLabel(label: string) {
  return label
    .split(/[-_]+/)
    .filter(Boolean)
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1).toLowerCase())
    .join(' ');
}

function inferCompanyName(user: UserSchema) {
  const email = user.email.trim().toLowerCase();
  const domain = email.split('@')[1] ?? '';
  const domainLabel = domain.split('.')[0] ?? '';

  if (domain && !PERSONAL_EMAIL_DOMAINS.has(domain) && domainLabel) {
    return `${titleizeDomainLabel(domainLabel)} Company`;
  }

  const profileName = user.profile?.name?.trim();
  if (profileName) {
    return `${profileName} Company`;
  }

  const emailName = email.split('@')[0]?.replace(/[._-]+/g, ' ').trim();
  if (emailName) {
    return `${titleizeDomainLabel(emailName)} Company`;
  }

  return 'My Company';
}

async function ensureUserCompanyAccount(
  user: UserSchema | null | undefined,
  accessToken: string | null | undefined,
): Promise<CompanyEnsureResult> {
  const userId = user?.id;
  const email = user?.email?.trim().toLowerCase();

  if (!userId || !email || !accessToken) {
    return { success: false, error: 'Unable to create your company workspace.' };
  }

  const insforge = createInsforgeServerClient({ accessToken });
  const { data: existingMembers, error: existingMemberError } = await insforge.database
    .from('company_account_members')
    .select('company_account_id')
    .eq('user_id', userId)
    .eq('email', email)
    .range(0, 0);

  if (existingMemberError) {
    return {
      success: false,
      error: getDatabaseErrorMessage(existingMemberError, 'Unable to load company membership.'),
    };
  }

  if (Array.isArray(existingMembers) && existingMembers[0]?.company_account_id) {
    return { success: true };
  }

  const companyName = inferCompanyName(user);
  const companySlug = slugifyCompanyName(companyName);
  const emailDomain = email.split('@')[1] || null;
  const fullName = user.profile?.name?.trim() || email.split('@')[0] || 'Workspace member';

  const { data: existingAccounts, error: existingAccountError } = await insforge.database
    .from('company_accounts')
    .select('*')
    .eq('user_id', userId)
    .eq('slug', companySlug)
    .range(0, 0);

  if (existingAccountError) {
    return {
      success: false,
      error: getDatabaseErrorMessage(existingAccountError, 'Unable to load company workspace.'),
    };
  }

  let companyAccount = Array.isArray(existingAccounts) ? existingAccounts[0] : null;

  if (!companyAccount) {
    const { data: createdAccounts, error: createAccountError } = await insforge.database
      .from('company_accounts')
      .insert([{
        name: companyName,
        slug: companySlug,
        domain: emailDomain,
        user_id: userId,
      }])
      .select('*');

    if (createAccountError) {
      return {
        success: false,
        error: getDatabaseErrorMessage(createAccountError, 'Unable to create company workspace.'),
      };
    }

    companyAccount = Array.isArray(createdAccounts) ? createdAccounts[0] : null;
  }

  if (!companyAccount?.id) {
    return { success: false, error: 'Unable to create company workspace.' };
  }

  const { error: createMemberError } = await insforge.database
    .from('company_account_members')
    .insert([{
      company_account_id: companyAccount.id,
      email,
      full_name: fullName,
      account_role: 'Owner',
      user_id: userId,
    }]);

  if (createMemberError) {
    const { data: restoredMembers, error: restoredMemberError } = await insforge.database
      .from('company_account_members')
      .select('company_account_id')
      .eq('user_id', userId)
      .eq('email', email)
      .range(0, 0);

    if (!restoredMemberError && Array.isArray(restoredMembers) && restoredMembers[0]?.company_account_id) {
      return { success: true };
    }

    return {
      success: false,
      error: getDatabaseErrorMessage(createMemberError, 'Unable to create company membership.'),
    };
  }

  return { success: true };
}

export async function getAuthConfig() {
  const baseUrl = process.env.NEXT_PUBLIC_INSFORGE_URL!;
  const response = await fetch(`${baseUrl}/api/auth/public-config`, { cache: 'no-store' });

  if (!response.ok) {
    return { oAuthProviders: [] as string[], requireEmailVerification: false, passwordMinLength: 8, verifyEmailMethod: 'otp' as const, resetPasswordMethod: 'otp' as const };
  }

  return response.json() as Promise<{
    requireEmailVerification: boolean;
    passwordMinLength: number;
    verifyEmailMethod: string;
    resetPasswordMethod: string;
    oAuthProviders: string[];
  }>;
}

export async function signIn(email: string, password: string): Promise<AuthResult> {
  const insforge = getInsforgeServerClient();
  const { data, error } = await insforge.auth.signInWithPassword({ email, password });

  if (error) {
    if (error.statusCode === 403) {
      return { success: false, error: 'Email not verified. Please verify your email first.' };
    }
    return { success: false, error: error.message ?? 'Sign in failed.' };
  }

  if (!data?.accessToken || !data?.refreshToken) {
    return { success: false, error: 'Sign in failed.' };
  }

  const companyResult = await ensureUserCompanyAccount(data.user, data.accessToken);
  if (!companyResult.success) {
    return { success: false, error: companyResult.error };
  }

  await setAuthCookies(data.accessToken, data.refreshToken);
  return { success: true };
}

export async function signUp(
  email: string,
  password: string,
  name: string,
): Promise<{ success: true; requireVerification: boolean } | { success: false; error: string }> {
  const insforge = getInsforgeServerClient();
  const { data, error } = await insforge.auth.signUp({ email, password, name });

  if (error) {
    return { success: false, error: error.message ?? 'Sign up failed.' };
  }

  if (data?.requireEmailVerification) {
    return { success: true, requireVerification: true };
  }

  if (data?.accessToken && data?.refreshToken) {
    const companyResult = await ensureUserCompanyAccount(data.user, data.accessToken);
    if (!companyResult.success) {
      return { success: false, error: companyResult.error };
    }

    await setAuthCookies(data.accessToken, data.refreshToken);
    return { success: true, requireVerification: false };
  }

  return { success: false, error: 'Sign up failed.' };
}

export async function verifyEmail(email: string, otp: string): Promise<AuthResult> {
  const insforge = getInsforgeServerClient();
  const { data, error } = await insforge.auth.verifyEmail({ email, otp });

  if (error) {
    return { success: false, error: error.message ?? 'Verification failed.' };
  }

  if (data?.accessToken && data?.refreshToken) {
    const companyResult = await ensureUserCompanyAccount(data.user, data.accessToken);
    if (!companyResult.success) {
      return { success: false, error: companyResult.error };
    }

    await setAuthCookies(data.accessToken, data.refreshToken);
  }

  return { success: true };
}

export async function resendVerification(email: string): Promise<AuthResult> {
  const insforge = getInsforgeServerClient();

  try {
    await insforge.auth.resendVerificationEmail({ email });
    return { success: true };
  } catch {
    return { success: false, error: 'Failed to resend verification code.' };
  }
}

export async function sendResetEmail(email: string): Promise<AuthResult> {
  const insforge = getInsforgeServerClient();

  try {
    await insforge.auth.sendResetPasswordEmail({ email });
    return { success: true };
  } catch {
    return { success: false, error: 'Failed to send reset email.' };
  }
}

export async function exchangeResetCode(
  email: string,
  code: string,
): Promise<{ success: true; token: string } | { success: false; error: string }> {
  const insforge = getInsforgeServerClient();
  const { data, error } = await insforge.auth.exchangeResetPasswordToken({ email, code });

  if (error || !data?.token) {
    return { success: false, error: error?.message ?? 'Invalid or expired code.' };
  }

  return { success: true, token: data.token };
}

export async function resetPassword(newPassword: string, otp: string): Promise<AuthResult> {
  const insforge = getInsforgeServerClient();
  const { error } = await insforge.auth.resetPassword({ newPassword, otp });

  if (error) {
    return { success: false, error: error.message ?? 'Password reset failed.' };
  }

  return { success: true };
}

export async function getOAuthUrl(provider: string): Promise<{ url: string } | { error: string }> {
  const insforge = getInsforgeServerClient();

  type OAuthProvider = Parameters<typeof insforge.auth.signInWithOAuth>[0]['provider'];

  const { data, error } = await insforge.auth.signInWithOAuth({
    provider: provider as OAuthProvider,
    redirectTo: getAppUrl('/auth/callback').toString(),
    skipBrowserRedirect: true,
  });

  if (error || !data?.url) {
    return { error: error?.message ?? 'OAuth failed.' };
  }

  if (data.codeVerifier) {
    await setPkceVerifier(data.codeVerifier);
  }

  return { url: data.url };
}

export async function exchangeAuthCode(code: string): Promise<AuthResult> {
  const insforge = getInsforgeServerClient();
  const codeVerifier = await consumePkceVerifier();
  const { data, error } = await insforge.auth.exchangeOAuthCode(code, codeVerifier ?? undefined);

  if (error || !data?.accessToken) {
    return { success: false, error: error?.message ?? 'Code exchange failed.' };
  }

  if (data.refreshToken) {
    const companyResult = await ensureUserCompanyAccount(data.user, data.accessToken);
    if (!companyResult.success) {
      return { success: false, error: companyResult.error };
    }

    await setAuthCookies(data.accessToken, data.refreshToken);
  }

  return { success: true };
}

export async function signOut() {
  const insforge = getInsforgeServerClient();

  try {
    await insforge.auth.signOut();
  } catch {
    // sign out even if server call fails
  }

  await clearAuthCookies();
  redirect('/auth/sign-in');
}
