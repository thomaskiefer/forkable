const LOCAL_APP_URL = 'http://localhost:3000';

export function getAppBaseUrl() {
  if (process.env.NODE_ENV === 'development') {
    return LOCAL_APP_URL;
  }

  return process.env.NEXT_PUBLIC_APP_URL ?? LOCAL_APP_URL;
}

export function getAppUrl(path = '/') {
  return new URL(path, getAppBaseUrl());
}
