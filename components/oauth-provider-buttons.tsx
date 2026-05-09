'use client';

import { useState } from 'react';
import { Loader2 } from 'lucide-react';
import { toast } from 'sonner';
import { OAuthProviderIcon } from '@/components/oauth-provider-icon';
import { Button } from '@/components/ui/button';
import { getOAuthUrl } from '@/lib/auth-actions';
import { cn } from '@/lib/utils';

type OAuthProviderButtonsProps = {
  providers: string[];
};

function formatProviderLabel(provider: string) {
  if (provider.toLowerCase() === 'github') {
    return 'GitHub';
  }

  return provider.charAt(0).toUpperCase() + provider.slice(1);
}

export function OAuthProviderButtons({ providers }: OAuthProviderButtonsProps) {
  const [loadingProvider, setLoadingProvider] = useState<string | null>(null);

  if (providers.length === 0) {
    return null;
  }

  async function handleSelect(provider: string) {
    setLoadingProvider(provider);
    const result = await getOAuthUrl(provider);

    if ('error' in result) {
      toast.error(result.error);
      setLoadingProvider(null);
    } else {
      window.location.href = result.url;
    }
  }

  return (
    <div className="space-y-5">
      <div className="relative flex items-center gap-3">
        <span aria-hidden className="h-px flex-1 bg-white/12" />
        <span className="text-[0.64rem] font-medium uppercase tracking-[0.26em] text-white/45">
          Or continue with
        </span>
        <span aria-hidden className="h-px flex-1 bg-white/12" />
      </div>

      <div className={cn('grid gap-2', providers.length > 1 ? 'grid-cols-2' : 'grid-cols-1')}>
        {providers.map((provider) => (
          <Button
            key={provider}
            type="button"
            variant="outline"
            size="lg"
            className="h-11 rounded-[0.65rem] border-white/12 bg-white/[0.06] text-white shadow-none hover:bg-white/[0.09] hover:text-white"
            disabled={loadingProvider !== null}
            onClick={() => handleSelect(provider)}
          >
            {loadingProvider === provider ? (
              <Loader2 className="size-4 animate-spin" />
            ) : (
              <OAuthProviderIcon provider={provider} />
            )}
            {formatProviderLabel(provider)}
          </Button>
        ))}
      </div>
    </div>
  );
}
