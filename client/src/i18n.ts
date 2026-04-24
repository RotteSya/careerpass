import i18n from "i18next";
import { initReactI18next } from "react-i18next";

import zh from "./locales/zh.json";
import ja from "./locales/ja.json";
import en from "./locales/en.json";

const resources = {
  zh: { translation: zh },
  ja: { translation: ja },
  en: { translation: en },
};

i18n
  .use(initReactI18next)
  .init({
    resources,
    lng: "ja", // default language
    fallbackLng: "en",
    interpolation: {
      escapeValue: false, // react already safes from xss
    },
  });

export default i18n;
