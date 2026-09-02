import React from 'react';
import Icon from './AppIcon';
import { useI18n } from '../i18n';

// User-facing language selector for the More/settings surface. Changing the
// language updates the whole UI immediately and persists the choice locally
// (no DB, no migration in V1). Not a primary navigation item.
const OPTIONS = [
  { value: 'en-US', labelKey: 'language.english' },
  { value: 'es-PA', labelKey: 'language.spanish' },
];

export default function LanguageSwitcher() {
  const { locale, setLocale, t } = useI18n();

  return (
    <div className="bg-card p-5 rounded-xl border border-border shadow-sm">
      <div className="flex items-start gap-4">
        <div className="bg-primary/10 p-3 rounded-lg shrink-0">
          <Icon name="Languages" size={24} className="text-primary" />
        </div>
        <div className="min-w-0 flex-1">
          <p className="font-bold text-foreground">{t('more.language')}</p>
          <p className="text-sm text-muted-foreground mt-0.5 mb-3">{t('more.languageDesc')}</p>
          <div role="radiogroup" aria-label={t('more.language')} className="flex flex-wrap gap-2">
            {OPTIONS.map((opt) => {
              const active = locale === opt.value;
              return (
                <button
                  key={opt.value}
                  type="button"
                  role="radio"
                  aria-checked={active}
                  onClick={() => setLocale(opt.value)}
                  className={`px-4 py-2.5 min-h-[44px] rounded-lg text-sm font-semibold border transition-colors ${
                    active
                      ? 'bg-primary text-primary-foreground border-primary'
                      : 'bg-background text-foreground border-border hover:border-primary'
                  }`}
                >
                  {t(opt.labelKey)}
                </button>
              );
            })}
          </div>
        </div>
      </div>
    </div>
  );
}
