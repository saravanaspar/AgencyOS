import "server-only";

interface ParsedUrlOptions {
  allowLocalhost?: boolean;
  allowedHosts?: readonly string[];
}

export interface NotificationDeliveryConfiguration {
  email: {
    configured: boolean;
    resendApiKey: string | null;
    from: string | null;
  };
  browserPush: {
    configured: boolean;
    encryptionKeyConfigured: boolean;
    publicKey: string | null;
    privateKey: string | null;
    subject: string | null;
  };
}

export interface PublicNotificationDeliveryConfiguration {
  emailConfigured: boolean;
  browserPushConfigured: boolean;
  browserPushPublicKey: string | null;
}

function stringValue(name: string): string | null {
  return process.env[name]?.trim() || null;
}

function parsedHttpsUrl(value: string | null, options: ParsedUrlOptions = {}): string | null {
  if (!value) return null;
  try {
    const url = new URL(value);
    const local = url.hostname === "localhost" || url.hostname === "127.0.0.1";
    if (url.protocol !== "https:" && !(options.allowLocalhost && local)) return null;
    if (url.username || url.password) return null;
    if (options.allowedHosts && !options.allowedHosts.includes(url.hostname.toLowerCase())) {
      return null;
    }
    return url.toString();
  } catch {
    return null;
  }
}

function validEncryptionKey(value: string | null): string | null {
  if (!value) return null;
  try {
    const key = /^[a-f0-9]{64}$/i.test(value)
      ? Buffer.from(value, "hex")
      : Buffer.from(value, "base64");
    return key.length === 32 ? value : null;
  } catch {
    return null;
  }
}

function validResendApiKey(value: string | null): string | null {
  if (!value || !value.startsWith("re_") || value.length < 20 || value.length > 300) return null;
  if (/\s/.test(value)) return null;
  return value;
}

function validEmailFrom(value: string | null): string | null {
  if (!value || value.length > 320 || /[\r\n]/.test(value)) return null;
  const address = value.match(/<([^<>]+)>$/)?.[1] ?? value;
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(address.trim()) ? value : null;
}

function validVapidPublicKey(value: string | null): string | null {
  if (!value || !/^[A-Za-z0-9_-]{80,100}$/.test(value)) return null;
  return value;
}

function validVapidPrivateKey(value: string | null): string | null {
  if (!value || !/^[A-Za-z0-9_-]{40,60}$/.test(value)) return null;
  return value;
}

function validVapidSubject(value: string | null): string | null {
  if (!value) return null;
  if (value.startsWith("mailto:") && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value.slice(7))) {
    return value;
  }
  return parsedHttpsUrl(value);
}

export function getNotificationDeliveryConfiguration(): NotificationDeliveryConfiguration {
  const resendApiKey = validResendApiKey(stringValue("RESEND_API_KEY"));
  const emailFrom = validEmailFrom(stringValue("NOTIFICATION_EMAIL_FROM"));
  const encryptionKey = validEncryptionKey(stringValue("NOTIFICATION_DELIVERY_ENCRYPTION_KEY"));
  const vapidPublicKey = validVapidPublicKey(stringValue("NOTIFICATION_VAPID_PUBLIC_KEY"));
  const vapidPrivateKey = validVapidPrivateKey(stringValue("NOTIFICATION_VAPID_PRIVATE_KEY"));
  const vapidSubject = validVapidSubject(stringValue("NOTIFICATION_VAPID_SUBJECT"));

  return {
    email: {
      configured: Boolean(resendApiKey && emailFrom),
      resendApiKey,
      from: emailFrom,
    },
    browserPush: {
      configured: Boolean(encryptionKey && vapidPublicKey && vapidPrivateKey && vapidSubject),
      encryptionKeyConfigured: Boolean(encryptionKey),
      publicKey: vapidPublicKey,
      privateKey: vapidPrivateKey,
      subject: vapidSubject,
    },
  };
}

export function publicNotificationDeliveryConfiguration(): PublicNotificationDeliveryConfiguration {
  const configuration = getNotificationDeliveryConfiguration();
  return {
    emailConfigured: configuration.email.configured,
    browserPushConfigured: configuration.browserPush.configured,
    browserPushPublicKey: configuration.browserPush.configured
      ? configuration.browserPush.publicKey
      : null,
  };
}
