import Link from 'next/link';
import { ArrowLeft } from 'lucide-react';
import { AuthShowcase } from '@/components/auth-showcase';
import { ResetPasswordForm } from '@/components/reset-password-form';

export default function ResetPasswordPage() {
  return (
    <div className="min-h-dvh bg-background">
      <div className="mx-auto grid min-h-dvh max-w-7xl gap-6 p-4 sm:p-6 lg:grid-cols-[1.05fr_0.95fr]">
        <section className="hidden min-h-[640px] lg:flex">
          <AuthShowcase
            quote="Back to your sales workspace."
            description="Reset access to Forkable and return to your pipeline, reviews, and account-specific workflows."
          />
        </section>

        <section className="flex items-center justify-center px-2 py-10 sm:px-6">
          <div className="w-full max-w-sm space-y-8">
            <ResetPasswordForm />

            <p className="text-center text-sm text-muted-foreground">
              <Link
                href="/auth/sign-in"
                className="inline-flex items-center gap-1 text-foreground underline-offset-4 transition-colors hover:text-primary hover:underline"
              >
                <ArrowLeft className="h-3.5 w-3.5" /> Back to sign in
              </Link>
            </p>
          </div>
        </section>
      </div>
    </div>
  );
}
