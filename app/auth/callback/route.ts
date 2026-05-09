import { NextResponse } from 'next/server';
import { exchangeAuthCode } from '@/lib/auth-actions';
import { getAppUrl } from '@/lib/app-url';

export async function GET(request: Request) {
  const url = new URL(request.url);
  const code = url.searchParams.get('insforge_code');

  if (!code) {
    return NextResponse.redirect(getAppUrl('/auth/sign-in'));
  }

  const result = await exchangeAuthCode(code);

  if (result.success) {
    return NextResponse.redirect(getAppUrl('/'));
  }

  return NextResponse.redirect(getAppUrl('/auth/sign-in'));
}
