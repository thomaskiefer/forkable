'use server';

import { revalidatePath } from 'next/cache';
import { requireAuthenticatedSession } from '@/lib/auth-state';
import { archiveNotification, markNotificationRead } from '@/lib/queries';

export async function markNotificationReadAction(id: string) {
  const { accessToken: token } = await requireAuthenticatedSession();
  if (!id) return null;

  const notification = await markNotificationRead(id, token);
  revalidatePath('/notifications');
  return notification;
}

export async function archiveNotificationAction(id: string) {
  const { accessToken: token } = await requireAuthenticatedSession();
  if (!id) return null;

  const notification = await archiveNotification(id, token);
  revalidatePath('/notifications');
  return notification;
}
