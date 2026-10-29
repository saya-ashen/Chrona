import { resolveLocale, type Locale } from "./locale-core";

export { getPreferredLocale } from "./locale-core";

const apiMessages = {
  en: {
    unauthorized: "Unauthorized",
    notFound: "Not found",
    internalServerError: "Internal server error",
    malformedJson: "Malformed JSON request body",
  },
  zh: {
    unauthorized: "未授权",
    notFound: "未找到",
    internalServerError: "服务器内部错误",
    malformedJson: "请求体 JSON 格式错误",
  },
} as const;

type ApiMessages = (typeof apiMessages)[Locale];

export function getApiMessages(locale?: string | null): ApiMessages {
  return apiMessages[resolveLocale(locale)];
}
