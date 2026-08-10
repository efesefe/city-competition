import { cookies } from "next/headers";
import { getRequestConfig } from "next-intl/server";
import {
  defaultLocale,
  isLocale,
  localeCookieName,
  type Locale,
} from "./config";

export default getRequestConfig(async () => {
  const store = await cookies();
  const raw = store.get(localeCookieName)?.value;
  const locale: Locale = isLocale(raw) ? raw : defaultLocale;

  return {
    locale,
    messages: (await import(`./messages/${locale}.json`)).default,
  };
});
