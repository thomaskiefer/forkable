import { redirect } from 'next/navigation';

export default async function LegacyRequestRedirect({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  redirect(`/feature-requests?request=${id}`);
}
