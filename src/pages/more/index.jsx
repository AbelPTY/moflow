import React from 'react';
import { useNavigate } from 'react-router-dom';
import PrimaryNavBar from '../../components/navigation/PrimaryNavBar';
import Icon from '../../components/AppIcon';
import LanguageSwitcher from '../../components/LanguageSwitcher';
import { useI18n } from '../../i18n';

// More tab: a real page (not a bottom sheet) that gathers the secondary tools
// pulled out of the primary navigation. Each card links to an existing route;
// this is information architecture only. Labels/descriptions are translated.
const MORE_ITEMS = [
  { key: 'accounts', path: '/accounts', icon: 'Landmark' },
  { key: 'actionPlan', path: '/action-plan', icon: 'ListChecks' },
  { key: 'budget', path: '/budget-tracking', icon: 'Wallet' },
  { key: 'spending', path: '/spending-analytics', icon: 'TrendingUp' },
  { key: 'goals', path: '/goals-progress', icon: 'Target' },
];

const More = () => {
  const navigate = useNavigate();
  const { t } = useI18n();

  return (
    <div className="min-h-screen bg-background text-foreground">
      <PrimaryNavBar />

      <div className="max-w-4xl mx-auto px-4 sm:px-6 lg:px-8 py-8 pb-28 md:pb-8">
        <div className="mb-8">
          <h1 className="text-3xl font-bold">{t('more.title')}</h1>
          <p className="text-sm text-muted-foreground font-medium mt-1">{t('more.subtitle')}</p>
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
          {MORE_ITEMS.map((item) => (
            <button
              key={item.path}
              onClick={() => navigate(item.path)}
              className="flex items-start gap-4 text-left bg-card p-5 rounded-xl border border-border shadow-sm hover:border-primary hover:shadow-md transition-all"
            >
              <div className="bg-primary/10 p-3 rounded-lg shrink-0">
                <Icon name={item.icon} size={24} className="text-primary" />
              </div>
              <div className="min-w-0">
                <p className="font-bold text-foreground">{t(`more.${item.key}`)}</p>
                <p className="text-sm text-muted-foreground mt-0.5">{t(`more.${item.key}Desc`)}</p>
              </div>
            </button>
          ))}
        </div>

        {/* Settings: language preference (persisted locally; no primary nav item). */}
        <div className="mt-8">
          <LanguageSwitcher />
        </div>
      </div>
    </div>
  );
};

export default More;
