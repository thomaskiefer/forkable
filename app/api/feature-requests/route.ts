import { NextResponse } from 'next/server';
import { getAuthenticatedSession } from '@/lib/auth-state';
import { createChangeRequest, getCompanyAccountForEmail } from '@/lib/queries';

function readRequiredString(value: unknown) {
  return typeof value === 'string' ? value.trim() : '';
}

export async function POST(request: Request) {
  const { viewer, accessToken } = await getAuthenticatedSession();
  if (!viewer.isAuthenticated || !viewer.id) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const body = (await request.json().catch(() => ({}))) as Record<string, unknown>;
  const title = readRequiredString(body.title);
  const description = readRequiredString(body.description);
  const requesterEmail = viewer.email?.trim().toLowerCase() ?? '';

  if (!title || !description) {
    return NextResponse.json({ error: 'All fields are required.' }, { status: 400 });
  }

  if (!requesterEmail) {
    return NextResponse.json(
      { error: 'Your account needs an email before it can create requests.' },
      { status: 400 },
    );
  }

  const company = await getCompanyAccountForEmail(requesterEmail, accessToken);
  if (!company) {
    return NextResponse.json(
      { error: 'Your login is not mapped to a company account yet.' },
      { status: 400 },
    );
  }

  const changeRequest = await createChangeRequest(
    {
      title,
      company,
      requesterEmail,
      description,
      userId: viewer.id,
    },
    accessToken,
  );

  if (!changeRequest) {
    return NextResponse.json({ error: 'Feature request was not created.' }, { status: 500 });
  }

  return NextResponse.json({ request: changeRequest }, { status: 201 });
}
