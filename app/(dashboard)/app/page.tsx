import { redirect } from 'next/navigation';

export default function LegacyAppRedirect() {
  redirect('/feature-requests');
}
