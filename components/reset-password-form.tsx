'use client';

import { Loader2 } from 'lucide-react';
import { useState } from 'react';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { exchangeResetCode, resetPassword, sendResetEmail } from '@/lib/auth-actions';

export function ResetPasswordForm() {
  const [email, setEmail] = useState('');
  const [code, setCode] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [token, setToken] = useState('');
  const [step, setStep] = useState<'email' | 'code' | 'password'>('email');
  const [isLoading, setIsLoading] = useState(false);

  async function handleSendEmail(e: React.FormEvent) {
    e.preventDefault();
    setIsLoading(true);

    const result = await sendResetEmail(email.trim());

    if (result.success) {
      setStep('code');
      toast.success('Check your email for a reset code.');
    } else {
      toast.error(result.error);
    }

    setIsLoading(false);
  }

  async function handleVerifyCode(e: React.FormEvent) {
    e.preventDefault();
    setIsLoading(true);

    const result = await exchangeResetCode(email.trim(), code.trim());

    if (result.success) {
      setToken(result.token);
      setStep('password');
    } else {
      toast.error(result.error);
    }

    setIsLoading(false);
  }

  async function handleResetPassword(e: React.FormEvent) {
    e.preventDefault();
    setIsLoading(true);

    const result = await resetPassword(newPassword, token);

    if (result.success) {
      toast.success('Password reset successfully. Please sign in.');
      window.location.href = '/auth/sign-in';
    } else {
      toast.error(result.error);
    }

    setIsLoading(false);
  }

  if (step === 'email') {
    return (
      <>
        <div className="space-y-2 text-center">
          <p className="eyebrow">Forgot your password?</p>
          <h1 className="font-display text-balance text-4xl font-medium leading-tight tracking-tight sm:text-5xl">
            Reset password
          </h1>
          <p className="text-sm text-muted-foreground">
            Enter your email and we&apos;ll send a reset code.
          </p>
        </div>
        <form className="space-y-5" onSubmit={handleSendEmail}>
          <div className="space-y-2">
            <Label htmlFor="email">Email</Label>
            <Input
              id="email"
              type="email"
              required
              autoComplete="email"
              placeholder="you@example.com"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
            />
          </div>
          <Button className="w-full" size="lg" type="submit" disabled={isLoading}>
            {isLoading ? <Loader2 className="size-4 animate-spin" /> : 'Send reset code'}
          </Button>
        </form>
      </>
    );
  }

  if (step === 'code') {
    return (
      <>
        <div className="space-y-2 text-center">
          <p className="eyebrow">Step 2 of 3</p>
          <h1 className="font-display text-balance text-4xl font-medium leading-tight tracking-tight sm:text-5xl">
            Enter reset code
          </h1>
          <p className="text-sm text-muted-foreground">
            We sent a 6-digit code to{' '}
            <span className="font-medium text-foreground">{email}</span>
          </p>
        </div>
        <form className="space-y-5" onSubmit={handleVerifyCode}>
          <div className="space-y-2">
            <Label htmlFor="code">Reset code</Label>
            <Input
              id="code"
              type="text"
              required
              inputMode="numeric"
              maxLength={6}
              autoComplete="one-time-code"
              className="h-12 text-center text-lg tracking-[0.5em] nums-tabular"
              placeholder="000000"
              value={code}
              onChange={(e) => setCode(e.target.value.replace(/\D/g, '').slice(0, 6))}
            />
          </div>
          <Button
            className="w-full"
            size="lg"
            type="submit"
            disabled={isLoading || code.length < 6}
          >
            {isLoading ? <Loader2 className="size-4 animate-spin" /> : 'Verify code'}
          </Button>
        </form>
      </>
    );
  }

  return (
    <>
      <div className="space-y-2 text-center">
        <p className="eyebrow">Almost there</p>
        <h1 className="font-display text-balance text-4xl font-medium leading-tight tracking-tight sm:text-5xl">
          Set new password
        </h1>
        <p className="text-sm text-muted-foreground">
          Choose a strong password to finish resetting your account.
        </p>
      </div>
      <form className="space-y-5" onSubmit={handleResetPassword}>
        <div className="space-y-2">
          <Label htmlFor="newPassword">New password</Label>
          <Input
            id="newPassword"
            type="password"
            required
            autoComplete="new-password"
            placeholder="Enter new password"
            value={newPassword}
            onChange={(e) => setNewPassword(e.target.value)}
          />
        </div>
        <Button className="w-full" size="lg" type="submit" disabled={isLoading}>
          {isLoading ? <Loader2 className="size-4 animate-spin" /> : 'Reset password'}
        </Button>
      </form>
    </>
  );
}
