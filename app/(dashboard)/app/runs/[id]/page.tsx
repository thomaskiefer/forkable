import { redirect } from 'next/navigation';

export default async function LegacyRunRedirect({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  redirect(`/feature-runs/${id}`);
}
