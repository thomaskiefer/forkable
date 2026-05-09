import Link from 'next/link';
import { AuthBackground } from '@/components/auth-background';
import { AuthShowcase } from '@/components/auth-showcase';
import { SignUpForm } from '@/components/sign-up-form';
import { Wordmark } from '@/components/logo';
import { getAuthConfig } from '@/lib/auth-actions';

export default async function SignUpPage() {
  const config = await getAuthConfig();

  return (
    <div className="dark min-h-dvh overflow-x-hidden bg-[#070706] text-white">
      <AuthBackground />
      <div className="relative mx-auto flex min-h-dvh w-full max-w-[92rem] flex-col px-6 py-7 sm:px-10 lg:px-14">
        <header className="fixed left-6 top-7 z-10 flex items-center sm:left-10 lg:left-14">
          <Link href="/" aria-label="Forkable">
            <Wordmark size="md" />
          </Link>
        </header>

        <main className="grid flex-1 items-center gap-x-16 gap-y-12 py-10 lg:grid-cols-[minmax(0,1fr)_27.75rem] lg:py-12 xl:gap-x-20">
          <section className="hidden lg:block">
            <AuthShowcase
              quote={
                <>
                  Tell us how your
                  <br />
                  CRM should work.
                </>
              }
              description="CRM software that adapts to the way your company sells."
            />
          </section>

          <section className="w-full max-w-[27.75rem] lg:justify-self-end">
            <div className="space-y-6 rounded-[1.35rem] border border-white/[0.12] bg-[#070707]/92 p-7 sm:p-8">
              <div className="space-y-2">
                <p className="text-[0.66rem] font-medium uppercase tracking-[0.28em] text-white/45">
                  Create account
                </p>
                <h2 className="font-display text-3xl font-medium leading-tight tracking-tight">
                  Get started
                </h2>
                <p className="text-sm leading-6 text-white/60">
                  Set up your personalized CRM.
                </p>
              </div>

              <SignUpForm
                providers={config.oAuthProviders ?? []}
                verifyEmailMethod={config.verifyEmailMethod}
              />

              <p className="border-t border-white/10 pt-5 text-sm text-white/60">
                Already have an account?{' '}
                <Link
                  href="/auth/sign-in"
                  className="font-medium text-white underline-offset-4 transition-colors hover:text-primary hover:underline"
                >
                  Sign in
                </Link>
              </p>
            </div>
          </section>
        </main>
      </div>
    </div>
  );
}
