'use client';

import { Loader2 } from 'lucide-react';
import { useState } from 'react';
import { toast } from 'sonner';
import { OAuthProviderButtons } from '@/components/oauth-provider-buttons';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { signIn } from '@/lib/auth-actions';
import { DEFAULT_LANDING_ROUTE } from '@/lib/constants';

export function SignInForm({ providers }: { providers: string[] }) {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [isLoading, setIsLoading] = useState(false);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setIsLoading(true);

    const result = await signIn(email.trim(), password);

    if (result.success) {
      window.location.href = DEFAULT_LANDING_ROUTE;
      return;
    } else {
      toast.error(result.error);
    }

    setIsLoading(false);
  }

  return (
    <div className="space-y-5">
      <form className="space-y-4" onSubmit={handleSubmit}>
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
          <div className="flex items-center justify-between">
            <Label htmlFor="password">Password</Label>
            <a
              href="/auth/reset-password"
              className="text-xs text-muted-foreground transition-colors hover:text-primary"
            >
              Forgot password?
            </a>
          </div>
          <Input
            id="password"
            type="password"
            required
            autoComplete="current-password"
            className="h-11 rounded-[0.65rem] border-white/12 bg-white/[0.08] text-white shadow-none placeholder:text-white/35 focus-visible:ring-primary/70"
            placeholder="Enter your password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
          />
        </div>
        <Button className="h-11 w-full rounded-[0.65rem] shadow-none" size="lg" type="submit" disabled={isLoading}>
          {isLoading ? <Loader2 className="size-4 animate-spin" /> : 'Sign in'}
        </Button>
      </form>

      <OAuthProviderButtons providers={providers} />
    </div>
  );
}
