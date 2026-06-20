const DEFAULT_GRAPH_API_VERSION = "v23.0";

export type WhatsAppServerConfig = {
  accessToken: string;
  appSecret: string;
  businessAccountId: string;
  graphApiVersion: string;
  phoneNumberId: string;
  verifyToken: string;
};

export function getWhatsAppServerConfig(): WhatsAppServerConfig {
  const configuredVersion = process.env.WHATSAPP_GRAPH_API_VERSION?.trim();

  return {
    accessToken: process.env.WHATSAPP_ACCESS_TOKEN?.trim() || "",
    appSecret: process.env.WHATSAPP_APP_SECRET?.trim() || "",
    businessAccountId: process.env.WHATSAPP_BUSINESS_ACCOUNT_ID?.trim() || "",
    graphApiVersion: configuredVersion && /^v\d+\.\d+$/.test(configuredVersion)
      ? configuredVersion
      : DEFAULT_GRAPH_API_VERSION,
    phoneNumberId: process.env.WHATSAPP_PHONE_NUMBER_ID?.trim() || "",
    verifyToken: process.env.WHATSAPP_WEBHOOK_VERIFY_TOKEN?.trim() || "",
  };
}

export function getWhatsAppConfigurationStatus(config = getWhatsAppServerConfig()) {
  const fields = {
    accessToken: Boolean(config.accessToken),
    appSecret: Boolean(config.appSecret),
    businessAccountId: Boolean(config.businessAccountId),
    phoneNumberId: Boolean(config.phoneNumberId),
    verifyToken: Boolean(config.verifyToken),
  };

  return {
    fields,
    graphApiVersion: config.graphApiVersion,
    isReady: Object.values(fields).every(Boolean),
    phoneNumberId: config.phoneNumberId,
    businessAccountId: config.businessAccountId,
  };
}

