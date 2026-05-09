import { redirect } from 'next/navigation';

export default async function LegacyReviewRedirect({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  redirect(`/feature-reviews/${id}`);
}
