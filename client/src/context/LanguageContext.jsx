import { createContext, useContext, useState } from 'react';
import { useTranslation } from 'react-i18next';

const LanguageContext = createContext();

export function useLanguage() {
  return useContext(LanguageContext);
}

export function LanguageProvider({ children }) {
  const { i18n } = useTranslation();
  const [lang, setLang] = useState(i18n.language);

  function toggleLanguage() {
    const newLang = lang === 'he' ? 'en' : 'he';
    i18n.changeLanguage(newLang);
    localStorage.setItem('lang', newLang);
    setLang(newLang);
  }

  const isRTL = lang === 'he';

  return (
    <LanguageContext.Provider value={{ lang, isRTL, toggleLanguage }}>
      {children}
    </LanguageContext.Provider>
  );
}
