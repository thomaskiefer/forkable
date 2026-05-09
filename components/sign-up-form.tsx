'use client';

import { Loader2 } from 'lucide-react';
import { useState } from 'react';
import { toast } from 'sonner';
import { OAuthProviderButtons } from '@/components/oauth-provider-buttons';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { resendVerification, signUp, verifyEmail } from '@/lib/auth-actions';
import { DEFAULT_LANDING_ROUTE } from '@/lib/constants';

export function SignUpForm({
  providers,
  verifyEmailMethod,
}: {
  providers: string[];
  verifyEmailMethod?: string;
}) {
  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [otp, setOtp] = useState('');
  const [step, setStep] = useState<'register' | 'verify'>('register');
  const [isLoading, setIsLoading] = useState(false);

  async function handleSignUp(e: React.FormEvent) {
    e.preventDefault();
    setIsLoading(true);

    const result = await signUp(email.trim(), password, name.trim());

    if (result.success) {
      if (result.requireVerification) {
        setStep('verify');
        toast.success('Check your email for a verification code.');
      } else {
        window.location.href = DEFAULT_LANDING_ROUTE;
      }
    } else {
      toast.error(result.error);
    }

    setIsLoading(false);
  }

  async function handleVerify(e: React.FormEvent) {
    e.preventDefault();
    setIsLoading(true);

    const result = await verifyEmail(email.trim(), otp.trim());

    if (result.success) {
      window.location.href = DEFAULT_LANDING_ROUTE;
    } else {
      toast.error(result.error);
    }

    setIsLoading(false);
  }

  async function handleResend() {
    const result = await resendVerification(email.trim());
    if (result.success) {
      toast.success('Verification code resent.');
    } else {
      toast.error(result.error);
    }
  }

  if (step === 'verify') {
    const method = (verifyEmailMethod ?? 'code').toLowerCase();

    if (method === 'link') {
      return (
        <>
          <div className="space-y-2 text-center">
            <h1 className="font-display text-3xl font-medium leading-tight tracking-tight">
              Verify your email
            </h1>
            <p className="text-sm text-muted-foreground">
              We sent a verification link to{' '}
              <span className="font-medium text-foreground">{email}</span>
            </p>
          </div>

          <div className="space-y-4">
            <Button
              className="w-full"
              size="lg"
              type="button"
              onClick={() => (window.location.href = '/auth/sign-in')}
            >
              Go to sign in
            </Button>

            <p className="text-center text-sm text-muted-foreground">
              Didn&apos;t receive the email?{' '}
              <button
                type="button"
                className="text-foreground underline-offset-4 hover:underline"
                onClick={handleResend}
              >
                Resend
              </button>
            </p>
          </div>
        </>
      );
    }

    return (
      <>
        <div className="space-y-2 text-center">
          <h1 className="font-display text-3xl font-medium leading-tight tracking-tight">
            Verify your email
          </h1>
          <p className="text-sm text-muted-foreground">
            We sent a 6-digit code to{' '}
            <span className="font-medium text-foreground">{email}</span>
          </p>
        </div>

        <form className="space-y-5" onSubmit={handleVerify}>
          <div className="space-y-2">
            <Label htmlFor="otp">Verification code</Label>
          <Input
            id="otp"
              type="text"
              required
              inputMode="numeric"
              maxLength={6}
              autoComplete="one-time-code"
            className="h-12 rounded-[0.65rem] border-white/12 bg-white/[0.08] text-center text-lg tracking-[0.5em] text-white shadow-none placeholder:text-white/35 focus-visible:ring-primary/70 nums-tabular"
              placeholder="000000"
              value={otp}
              onChange={(e) => setOtp(e.target.value.replace(/\D/g, '').slice(0, 6))}
            />
          </div>
          <Button
            className="w-full"
            size="lg"
            type="submit"
            disabled={isLoading || otp.length < 6}
          >
            {isLoading ? <Loader2 className="size-4 animate-spin" /> : 'Verify'}
          </Button>
        </form>

        <p className="text-center text-sm text-muted-foreground">
          Didn&apos;t receive the code?{' '}
          <button
            type="button"
            className="text-foreground underline-offset-4 hover:underline"
            onClick={handleResend}
          >
            Resend
          </button>
        </p>
      </>
    );
  }

  return (
    <div className="space-y-5">
      <form className="space-y-4" onSubmit={handleSignUp}>
        <div className="space-y-2">
          <Label htmlFor="name">Name</Label>
          <Input
            id="name"
            type="text"
            required
            autoComplete="name"
            className="h-11 rounded-[0.65rem] border-white/12 bg-white/[0.08] text-white shadow-none placeholder:text-white/35 focus-visible:ring-primary/70"
            placeholder="Your name"
            value={name}
            onChange={(e) => setName(e.target.value)}
          />
        </div>
        <div className="space-y-2">
          <Label htmlFor="email">Email</Label>
          <Input
            id="email"
            type="email"
            required
            autoComplete="email"
            className="h-11 rounded-[0.65rem] border-white/12 bg-white/[0.08] text-white shadow-none placeholder:text-white/35 focus-visible:ring-primary/70"
            placeholder="you@example.com"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
          />
        </div>
        <div className="space-y-2">
          <Label htmlFor="password">Password</Label>
          <Input
            id="password"
            type="password"
            required
            autoComplete="new-password"
            className="h-11 rounded-[0.65rem] border-white/12 bg-white/[0.08] text-white shadow-none placeholder:text-white/35 focus-visible:ring-primary/70"
            placeholder="Create a password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
          />
        </div>
        <Button className="h-11 w-full rounded-[0.65rem] shadow-none" size="lg" type="submit" disabled={isLoading}>
          {isLoading ? <Loader2 className="size-4 animate-spin" /> : 'Create account'}
        </Button>
      </form>

      <OAuthProviderButtons providers={providers} />
    </div>
  );
}
