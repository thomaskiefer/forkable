import type { ReactNode } from 'react';

export function AuthShowcase({
  quote,
  description,
}: {
  quote?: ReactNode;
  description?: string;
}) {
  const quoteLine = quote ?? 'Tell us how your CRM should work.';

  return (
    <div className="max-w-[56rem] space-y-6 text-white">
      <h1 className="font-display text-5xl font-medium leading-[0.96] tracking-tight sm:text-6xl xl:text-[4.7rem]">
        {quoteLine}
      </h1>
      {description ? (
        <p className="max-w-[36rem] text-pretty text-base leading-7 text-white/62 sm:text-lg">
          {description}
        </p>
      ) : null}
    </div>
  );
}
